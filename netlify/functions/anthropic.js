// KUIU Field Kit v2.02 — gear-spec researcher (server-side).
// Reads ANTHROPIC_API_KEY from Netlify env vars so the key is NEVER in the client.
// Optional: CLAUDE_MODEL (model id), FK_ALLOWED_ORIGIN (origin gate, see lib/fk-common.js).
// v2.00: the old in-function advisor loop is gone (advisor.js / advisor-search.js own that);
// the research schema now returns the fields the warmth-budget engine needs.
// Served at the default path /.netlify/functions/anthropic (the client posts {name} or {ping}).

import { originAllowed, BODY_CAP } from "../lib/fk-common.js";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

const SYSTEM = [
  "You are a gear-spec researcher for a whitetail / upland / waterfowl hunting layering app that models warmth as insulation.",
  "Given a piece of apparel (usually KUIU, sometimes Sitka / First Lite / etc.), search the web for the product's real specs,",
  "then respond with ONLY a compact JSON object - no prose, no markdown, no code fences. Numbers must be real specs or clearly",
  "reasonable estimates; use null when unknown.",
  "Schema:",
  "{",
  '  "name": string (clean product name),',
  '  "category": one of "base","shirt","mid","insulation","softshell","shell","wader","pant","headwear","gloves","boots","accessory",',
  '  "slot": one of "torso","legs","head","neck","hands","feet","sock","vest","wader",',
  '  "pos": array; torso pieces from ["base","mid","insul","outer"] (a piece may list two, e.g. a 200 g/m2 merino zip-T is ["base","mid"]); legs from ["base","pant","overpant"]; others [],',
  '  "fit": one of "skin","mid","outer" (KUIU fit tier: next-to-skin base layer; mid-layer fit sized to go under a shell; outer-layer fit),',
  '  "fabric_gsm": number or null (shell/face fabric weight g/m2),',
  '  "insulation_type": one of "down","synthetic","fleece","merino","none",',
  '  "insulation_gsm": number or null (synthetic insulation g/m2, body panel),',
  '  "fill_oz": number or null (down fill weight in ounces, size L),',
  '  "membrane": boolean (true only for a waterproof membrane: Torain/Dermizax/Gore-style, waders, rubber boots),',
  '  "windproof": boolean (true for membranes and foam-laminated SynthaCell-style faces; wind-resistant woven = false),',
  '  "wind_resistant": boolean (DWR woven softshell faces etc.),',
  '  "quiet_1_10": number (10 = silent brushed knit for close-range whitetail, 4 = crinkly rain shell, 6 = ordinary woven),',
  '  "active": boolean (true if it breathes well enough to wear while walking hard; puffies = false),',
  '  "weight_oz": number or null (garment weight),',
  '  "tempMin": number (deg F, coldest air temp the piece is useful at in its intended role, static hunting),',
  '  "tempMax": number (deg F, warmest air temp it is useful at),',
  '  "disciplines": array, any of ["deer","upland","waterfowl"], where it fits best,',
  '  "pattern": string (camo pattern or color, e.g. "Valo", "Verde", "Blaze", "Solid"),',
  '  "note": short one-line placement tip (max ~15 words)',
  "}",
  "If you cannot find the exact item, infer sensibly from the name. Output JSON only."
].join("\n");

export default async (req) => {
  const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!originAllowed(req.headers.get("origin"), req.headers.get("referer"))) return json({ error: "Origin not allowed" }, 403);

  const key = process.env.ANTHROPIC_API_KEY;
  let raw = "";
  try { raw = await req.text(); } catch (e) {}
  if (raw.length > BODY_CAP) return json({ error: "Request too large" }, 413);
  let payload = {};
  try { payload = JSON.parse(raw || "{}"); } catch (e) {}

  // lightweight connection test - no API spend
  if (payload.ping) return json(key ? { ok: true, model: MODEL, version: "2.02" } : { error: "ANTHROPIC_API_KEY not set" });
  if (!key) return json({ error: "ANTHROPIC_API_KEY not set in Netlify" }, 500);

  const name = (payload.name || "").toString().slice(0, 120).trim();
  if (!name) return json({ error: "No item name provided" }, 400);

  const body = {
    model: MODEL,
    max_tokens: 1200,
    system: SYSTEM,
    messages: [{ role: "user", content: 'Research this hunting apparel item and return ONLY the JSON. Item: "' + name + '"' }],
    // one search keeps the call inside Netlify's limit (netlify.toml asks for 26 s; the default is 10 s)
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }]
  };

  let data;
  try {
    const ctl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => { try { ctl.abort(); } catch (e) {} }, 24000) : null;   // stay inside the function limit
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
      signal: ctl ? ctl.signal : undefined
    });
    if (timer) clearTimeout(timer);
    data = await resp.json();
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) || ("HTTP " + resp.status);
      return json({ error: msg }, 502);
    }
  } catch (e) {
    const aborted = e && e.name === "AbortError";
    return json({ error: aborted ? "Research timed out - try a more specific product name." : ("Upstream request failed: " + (e && e.message || e)) }, aborted ? 504 : 502);
  }

  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  let item = null;
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { item = JSON.parse(m[0]); } catch (e) {} }
  return json({ item, raw: text });
};
