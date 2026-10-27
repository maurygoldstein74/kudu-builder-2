// KUIU Field Kit v2.00 — gear advisor (STREAMING + kuiu.com WEB SEARCH).
// The "Pro" advisor: one streaming Anthropic call with web_search restricted to kuiu.com so the model
// can verify specs live. Web search adds latency, so this needs the 26 s function timeout (Netlify Pro,
// activated via support). On the default 10 s limit the client falls back to advisor.js automatically.
//
// Emits two kinds of lines so a search pause never looks frozen:
//   status lines:  ␟{"status":"searching"}\n   (unit-separator prefix, split out by the client)
//   plain text:    everything else is answer text, streamed as it arrives.

import { originAllowed, advisorSystem, BODY_CAP, OWNED_CAP, ASK_CAP } from "../lib/fk-common.js";

const PRIMARY_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";
const FALLBACK_MODEL = "claude-sonnet-4-6";
const US = "␟";

function searchSystem(owned) {
  return advisorSystem(owned) + "\n\nWEB SEARCH: it is restricted to kuiu.com. Use one or two focused searches to confirm a spec (fabric, weight, fill, condition tag, fit tier) and no more; if nothing useful comes back, answer from what you can confirm plus the user's kit rather than guessing numbers.";
}

export default async (req) => {
  const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!originAllowed(req.headers.get("origin"), req.headers.get("referer"))) return json({ error: "Origin not allowed" }, 403);

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: "ANTHROPIC_API_KEY not set in Netlify" }, 500);

  let raw = "";
  try { raw = await req.text(); } catch (e) {}
  if (raw.length > BODY_CAP) return json({ error: "Request too large" }, 413);
  let payload = {};
  try { payload = JSON.parse(raw || "{}"); } catch (e) {}
  const question = (payload.ask || "").toString().slice(0, ASK_CAP).trim();
  if (!question) return json({ error: "No question provided" }, 400);
  const owned = (payload.owned || "").toString().slice(0, OWNED_CAP);

  async function callModel(model) {
    return fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: model,
        max_tokens: 2048,
        stream: true,
        system: searchSystem(owned),
        messages: [{ role: "user", content: question }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3, allowed_domains: ["kuiu.com"] }]
      })
    });
  }
  async function errText(resp) {
    let msg = "HTTP " + resp.status;
    try { const d = await resp.json(); if (d && d.error && d.error.message) msg = d.error.message; } catch (e) {}
    return msg;
  }

  // primary -> fallback on any 400/404; each error body is read once and cached
  const ladder = [PRIMARY_MODEL].concat(FALLBACK_MODEL !== PRIMARY_MODEL ? [FALLBACK_MODEL] : []);
  let usedModel = PRIMARY_MODEL, upstream = null, lastErr = "";
  try {
    for (const m of ladder) {
      usedModel = m;
      upstream = await callModel(m);
      if (upstream.ok) break;
      lastErr = await errText(upstream);
      if (upstream.status !== 400 && upstream.status !== 404) break;
    }
  } catch (e) {
    return json({ error: "Upstream request failed: " + (e && e.message || e) }, 502);
  }
  if (!upstream || !upstream.ok) return json({ error: (lastErr || ("HTTP " + (upstream ? upstream.status : "?"))) + " (model: " + usedModel + ")" }, 502);

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
            if (evt.type === "content_block_delta" && evt.delta && evt.delta.type === "text_delta") {
              emittedText = true;
              send(evt.delta.text);
            } else if (evt.type === "content_block_start" && evt.content_block && evt.content_block.type === "server_tool_use") {
              const q = (evt.content_block.input && evt.content_block.input.query) || "";
              send(US + JSON.stringify({ status: "searching", query: q }) + "\n");
            } else if (evt.type === "content_block_start" && evt.content_block && evt.content_block.type === "web_search_tool_result") {
              send(US + JSON.stringify({ status: "reading" }) + "\n");
            } else if (evt.type === "error" || (evt.error && evt.error.message)) {
              send("[advisor error: " + ((evt.error && evt.error.message) || evt.message || "stream error") + "]");
              emittedText = true;
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
