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

  // ---- Advisor mode: free-form question about gear fit / logic ----
  if (payload.ask) {
    const question = payload.ask.toString().slice(0, 1500).trim();
    const owned = (payload.owned || "").toString().slice(0, 4000);
    const advSystem = [
      "You are a gear advisor for a whitetail / upland / waterfowl hunting layering app.",
      "The user owns the gear listed below. Answer their question grounded in what they own.",
      "When they ask about a NEW piece, say plainly whether it fills a real gap or duplicates something they already have, and at what temperature/discipline it would slot in.",
      "When they ask about the app's logic, explain the reasoning (layering physics, quiet fabrics for close range, waterproof vs wind-resistant, outer-fit insulation not going under a shell).",
      "Be direct and opinionated. Prefer buy-once-cry-once. Do not recommend buying gear that duplicates what they own. Keep answers tight — a few short paragraphs, no filler.",
      "You may use web search to verify specs of a specific product before judging fit.",
      "\nUSER'S OWNED GEAR:\n" + owned
    ].join("\n");
    const abody = {
      model: MODEL, max_tokens: 1024, system: advSystem,
      messages: [{ role: "user", content: question }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }]
    };
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(abody)
      });
      const d = await r.json();
      if (!r.ok) {
        const msg = (d && d.error && d.error.message) || ("HTTP " + r.status);
        return { statusCode: 502, headers, body: JSON.stringify({ error: msg }) };
      }
      const answer = (d.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
      return { statusCode: 200, headers, body: JSON.stringify({ answer }) };
    } catch (e) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Upstream request failed: " + (e && e.message || e) }) };
    }
  }

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
