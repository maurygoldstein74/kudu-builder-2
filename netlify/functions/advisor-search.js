// KUIU Field Kit — gear advisor (STREAMING + WEB SEARCH).
// This is the "Pro" advisor: single streaming Anthropic call WITH web_search enabled, so the
// model can verify KUIU specs live and still stream its answer. Web search adds latency, so this
// needs the 26s function timeout (Netlify Pro, activated via support) — on the default 10s limit
// use advisor.js (streaming, no search) instead.
//
// It emits two kinds of lines to the client so a search pause never looks frozen:
//   status lines:  \u241F{"status":"searching"}\n   (unit-separator prefix, easy to split out)
//   plain text:    everything else is answer text, streamed as it arrives.

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";
const US = "\u241F"; // unit separator: marks a control line, will never appear in prose

function buildSystem(owned) {
  return [
    "You are the gear advisor built into a KUIU-focused hunting layering app. The app recommends a weather-driven clothing loadout for whitetail (stationary stand), upland (on foot), and waterfowl (blind) hunting, drawing only from gear the user actually owns - almost entirely KUIU. Your job is to help the user decide whether a piece of gear they are considering fits their kit, and to explain the app's layering logic.",
    "",
    "GROUNDING RULES:",
    "- The user's owned gear is listed at the end. Reason from THAT, not a generic wardrobe.",
    "- Default to KUIU. When the user names a product, assume KUIU unless they say otherwise. Web search is restricted to kuiu.com, so search there for real product specs (fabric, weight, fill, temp intent, fit: base/mid/outer) from the product and collection pages. Search sparingly - one or two focused searches, not many. If a search returns nothing useful, answer from the specs you can confirm plus the user's owned kit rather than guessing numbers.",
    "- Verify a spec before judging it; do not invent numbers.",
    "",
    "HOW TO ANSWER:",
    "- NEW piece: state plainly whether it fills a real gap or duplicates something owned, name the specific owned piece it overlaps, and give the temperature band + discipline where it slots in. If it duplicates, say do not buy it.",
    "- Two-option question (X vs Y): pick one, say why, in terms of the gap it fills in THIS kit.",
    "- Logic question: explain the reasoning - quiet faces for close-range whitetail, waterproof vs wind-resistant, outer-fit down never under a shell, waders as waterfowl waterproofing, activity shifting the dressed-for temp.",
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
        max_tokens: 2048,
        stream: true,
        thinking: { type: "disabled" },
        system: buildSystem(owned),
        messages: [{ role: "user", content: question }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3, allowed_domains: ["kuiu.com"] }]
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

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let emittedText = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (t) => controller.enqueue(encoder.encode(t));
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
            if (!data || data === "[DONE]") continue;
            let evt; try { evt = JSON.parse(data); } catch (e) { continue; }
            // text tokens
            if (evt.type === "content_block_delta" && evt.delta && evt.delta.type === "text_delta") {
              emittedText = true;
              send(evt.delta.text);
            }
            // a web search is starting -> tell the client so the pause is explained
            else if (evt.type === "content_block_start" && evt.content_block && evt.content_block.type === "server_tool_use") {
              const q = (evt.content_block.input && evt.content_block.input.query) || "";
              send(US + JSON.stringify({ status: "searching", query: q }) + "\n");
            }
            // search finished -> clear the status
            else if (evt.type === "content_block_start" && evt.content_block && evt.content_block.type === "web_search_tool_result") {
              send(US + JSON.stringify({ status: "reading" }) + "\n");
            }
          }
        }
      } catch (e) {
        send("\n\n[stream interrupted - try again]");
      } finally {
        if (!emittedText) send(US + JSON.stringify({ status: "empty" }) + "\n");
        controller.close();
      }
    }
  });

  return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" } });
};

export const config = { path: "/api/advisor-search" };
