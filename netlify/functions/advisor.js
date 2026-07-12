// KUIU Field Kit — gear advisor (STREAMING).
// Separate from anthropic.js so the advisor can stream tokens as they arrive and stay
// under Netlify's 10s function limit. Uses a single streaming Anthropic call (no multi-turn
// search loop, which was what blew the timeout and returned 504s).
// Uses the modern fetchable-module signature so we can return a ReadableStream body.

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

function buildSystem(owned) {
  return [
    "You are the gear advisor built into a KUIU-focused hunting layering app. The app recommends a weather-driven clothing loadout for whitetail (stationary stand), upland (on foot), and waterfowl (blind) hunting, drawing only from gear the user actually owns - almost entirely KUIU. Your job is to help the user decide whether a piece of gear they are considering fits their kit, and to explain the app's layering logic.",
    "",
    "GROUNDING RULES:",
    "- The user's owned gear is listed at the end. Reason from THAT, not a generic wardrobe.",
    "- Default to KUIU. When the user names a product, assume KUIU unless they say otherwise. Use your knowledge of KUIU's lineup (Peloton base/grid-fleece line, Merino, Axis Hybrid, Guide DCS, Super Down, Kenai, Proximity, Gale Force, waders, etc.), their fabric weights and intended temperature ranges, and how the pieces layer (base / mid / outer). KUIU's own marketing understates real-world ranges, so lean on how hunters actually run these pieces.",
    "- If you are not sure of an exact spec, say so briefly rather than inventing a number.",
    "",
    "HOW TO ANSWER:",
    "- NEW piece: state plainly whether it fills a real gap or duplicates something owned, name the specific owned piece it overlaps, and give the temperature band + discipline where it would slot in. If it duplicates, say do not buy it.",
    "- Two-option question (X vs Y): pick one, say why, in terms of the gap it fills in THIS kit.",
    "- Logic question: explain the reasoning - quiet brushed/fleece faces for close-range whitetail, waterproof vs merely wind-resistant, outer-fit down never layered under a shell (it compresses), waders as the waterfowl waterproofing, activity raising/lowering the dressed-for temp.",
    "- Be direct and opinionated, buy-once-cry-once. Never pad. A few tight paragraphs, plain text (no markdown headers).",
    "",
    "USER'S OWNED GEAR:",
    owned
  ].join("\n");
}

export default async (req) => {
  const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: "ANTHROPIC_API_KEY not set in Netlify" }, 500);

  let payload = {};
  try { payload = await req.json(); } catch (e) {}

  const question = (payload.ask || "").toString().slice(0, 1500).trim();
  if (!question) return json({ error: "No question provided" }, 400);
  const owned = (payload.owned || "").toString().slice(0, 4000);

  let upstream;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        stream: true,
        system: buildSystem(owned),
        messages: [{ role: "user", content: question }]
      })
    });
  } catch (e) {
    return json({ error: "Upstream request failed: " + (e && e.message || e) }, 502);
  }

  if (!upstream.ok) {
    let msg = "HTTP " + upstream.status;
    try { const d = await upstream.json(); if (d && d.error && d.error.message) msg = d.error.message; } catch (e) {}
    return json({ error: msg }, 502);
  }

  // Transform Anthropic's SSE stream into a plain-text token stream for the client.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const s = line.trim();
            if (!s.startsWith("data:")) continue;
            const data = s.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const evt = JSON.parse(data);
              if (evt.type === "content_block_delta" && evt.delta && evt.delta.type === "text_delta") {
                controller.enqueue(encoder.encode(evt.delta.text));
              }
            } catch (e) { /* ignore keep-alives / partial */ }
          }
        }
      } catch (e) {
        controller.enqueue(encoder.encode("\n\n[stream interrupted - try again]"));
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" } });
};

export const config = { path: "/api/advisor" };
