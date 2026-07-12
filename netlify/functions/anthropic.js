// KUIU Field Kit — gear-spec researcher (server-side).
// Reads ANTHROPIC_API_KEY from Netlify env vars so the key is NEVER in the client.
// Optional: set CLAUDE_MODEL to choose a model (e.g. claude-sonnet-5, claude-haiku-4-5-20251001).

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

const SYSTEM = [
  "You are a gear-spec researcher for a whitetail / upland / waterfowl hunting layering app.",
  "Given a piece of apparel (usually KUIU, sometimes Sitka / First Lite / etc.), search the web for the",
  "product and its real specs, then respond with ONLY a compact JSON object — no prose, no markdown, no code fences.",
  "Schema:",
  "{",
  '  "name": string (clean product name),',
  '  "category": one of "base","mid","insulation","softshell","shell","wader","pant","headwear","gloves","boots","accessory",',
  '  "tempMin": number (deg F, low end of a realistic comfort range for its intended use, static hunting),',
  '  "tempMax": number (deg F, high end),',
  '  "quiet": boolean (soft/brushed face fit for close-range whitetail; true for fleece/wool/softshell/insulators, false for slick nylon rain shells),',
  '  "windproof": boolean,',
  '  "waterproof": boolean (true only for a hardshell/wader with a waterproof membrane),',
  '  "insulation": one of "down","synthetic","fleece","merino","none",',
  '  "disciplines": array, any of ["deer","upland","waterfowl"], where it fits best,',
  '  "note": short one-line placement tip (max ~15 words)',
  "}",
  "If you cannot find the exact item, infer sensibly from the name. Output JSON only."
].join("\n");

exports.handler = async (event) => {
  const headers = { "content-type": "application/json" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  const key = process.env.ANTHROPIC_API_KEY;
  let payload = {};
  try { payload = JSON.parse(event.body || "{}"); } catch (e) {}

  // lightweight connection test — no API spend
  if (payload.ping)
    return { statusCode: 200, headers, body: JSON.stringify(key ? { ok: true, model: MODEL } : { error: "ANTHROPIC_API_KEY not set" }) };

  if (!key)
    return { statusCode: 500, headers, body: JSON.stringify({ error: "ANTHROPIC_API_KEY not set in Netlify" }) };

  const name = (payload.name || "").toString().slice(0, 120).trim();
  if (!name)
    return { statusCode: 400, headers, body: JSON.stringify({ error: "No item name provided" }) };

  const body = {
    model: MODEL,
    max_tokens: 900,
    system: SYSTEM,
    messages: [{ role: "user", content: 'Research this hunting apparel item and return ONLY the JSON. Item: "' + name + '"' }],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }]
  };

  let data;
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body)
    });
    data = await resp.json();
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) || ("HTTP " + resp.status);
      return { statusCode: 502, headers, body: JSON.stringify({ error: msg }) };
    }
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Upstream request failed: " + (e && e.message || e) }) };
  }

  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  let item = null;
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { item = JSON.parse(m[0]); } catch (e) {} }
  return { statusCode: 200, headers, body: JSON.stringify({ item, raw: text }) };
};
