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
      "You are the gear advisor built into a KUIU-focused hunting layering app. The app recommends a weather-driven clothing loadout for whitetail (stationary stand), upland (on foot), and waterfowl (blind) hunting, drawing only from gear the user actually owns - almost entirely KUIU. Your job is to help the user decide whether a piece of gear they are considering fits their kit, and to explain the app's layering logic.",
      "",
      "GROUNDING RULES:",
      "- The user's owned gear is listed at the end. Reason from THAT, not a generic wardrobe.",
      "- Default to KUIU. When they name a product, assume KUIU unless they say otherwise, and use web search to pull real specs: search kuiu.com product and collection pages first for fabric, weight, fill, temp intent and fit (base / mid / outer). Then check hunting forums - rokslide.com, archerytalk.com, and reddit r/Hunting or r/bowhunting - for real-world temperature feedback and how pieces layer, since KUIU's own copy understates ranges.",
      "- Verify before judging. Do not guess a spec you can confirm with a quick search.",
      "",
      "HOW TO ANSWER:",
      "- NEW piece: state plainly whether it fills a real gap or duplicates something owned, name the specific owned piece it overlaps, and give the temperature band + discipline where it would slot in. If it duplicates, say do not buy it.",
      "- Two-option question (X or Y): pick one, say why, in terms of the gap it fills in THIS kit.",
      "- Logic question: explain the reasoning - quiet brushed/fleece faces for close-range whitetail, waterproof vs merely wind-resistant, outer-fit down never layered under a shell (it compresses), waders as the waterfowl waterproofing, activity raising/lowering the dressed-for temp.",
      "- Be direct and opinionated, buy-once-cry-once. Never pad. A few tight paragraphs, plain text (no markdown headers).",
      "",
      "USER'S OWNED GEAR:",
      owned
    ].join("\n");
    // Agentic loop: let the model search as many rounds as it needs, accumulating text,
    // until it stops for a real reason (end_turn) or we hit a hard iteration cap.
    const msgs = [{ role: "user", content: question }];
    const MAX_TURNS = 6;          // each turn may include up to 5 web searches
    const PER_TURN_TOKENS = 4096; // generous so a turn is never starved mid-answer
    let collected = [];
    let lastStop = null;
    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: PER_TURN_TOKENS,
            system: advSystem,
            messages: msgs,
            tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }]
          })
        });
        const dd = await resp.json();
        if (!resp.ok) {
          const msg = (dd && dd.error && dd.error.message) || ("HTTP " + resp.status);
          // if we already gathered some text over prior turns, return that rather than erroring
          if (collected.length) break;
          return { statusCode: 502, headers, body: JSON.stringify({ error: msg }) };
        }
        lastStop = dd.stop_reason;
        const txt = (dd.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
        if (txt) collected.push(txt);
        // Continue only if the model paused to use a tool (pause_turn) or ran tools this turn.
        const usedTool = (dd.content || []).some(b => b.type === "server_tool_use" || b.type === "web_search_tool_result");
        if (dd.stop_reason === "pause_turn" || (usedTool && dd.stop_reason !== "end_turn")) {
          msgs.push({ role: "assistant", content: dd.content });
          continue;
        }
        break; // end_turn, max_tokens with final text, or nothing more to do
      }
    } catch (e) {
      if (!collected.length) return { statusCode: 502, headers, body: JSON.stringify({ error: "Upstream request failed: " + (e && e.message || e) }) };
    }
    const answer = collected.join("\n\n").trim();
    if (!answer) {
      const note = lastStop === "max_tokens"
        ? "The research ran long and did not finish. Try asking about one specific piece (e.g. \"KUIU Peloton 240 Zip-T\")."
        : "No answer came back - try naming the exact product.";
      return { statusCode: 200, headers, body: JSON.stringify({ answer: "", note: note }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ answer: answer }) };
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
