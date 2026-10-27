// KUIU Field Kit v2.02 — gear advisor (STREAMING, no web search).
// Single streaming Anthropic call so tokens arrive as they are produced and the function stays
// under Netlify's default 10 s limit. Modern fetchable-module signature (returns a ReadableStream).
//
// Env: ANTHROPIC_API_KEY (required), CLAUDE_MODEL (optional), FK_ALLOWED_ORIGIN (optional, see lib),
//      ADVISOR_THINKING=off (optional) to send a plain request without extended-thinking params.

import { originAllowed, advisorSystem, BODY_CAP, OWNED_CAP, ASK_CAP } from "../lib/fk-common.js";

const PRIMARY_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";
const FALLBACK_MODEL = "claude-sonnet-4-6";   // broadly-available stable ID if primary is not provisioned
const US = "␟";                           // control-line marker (status), stripped by the client

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
  const useThinking = String(process.env.ADVISOR_THINKING || "on").toLowerCase() !== "off";

  function body(model, thinking) {
    const b = {
      model: model,
      max_tokens: thinking ? 8000 : 2048,
      stream: true,
      system: advisorSystem(owned),
      messages: [{ role: "user", content: question }]
    };
    if (thinking) { b.thinking = { type: "adaptive" }; b.output_config = { effort: "medium" }; }
    return b;
  }
  async function callModel(model, thinking) {
    return fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body(model, thinking))
    });
  }
  async function errText(resp) {
    let msg = "HTTP " + resp.status;
    try { const d = await resp.json(); if (d && d.error && d.error.message) msg = d.error.message; } catch (e) {}
    return msg;
  }

  // Attempt ladder, in order: primary+thinking -> primary plain -> fallback+thinking -> fallback plain.
  // Any 400/404 (model unknown OR a parameter rejected) just moves to the next rung; each response body is
  // read at most once (errText caches the message on the attempt record). Other statuses stop the ladder.
  const ladder = [];
  if (useThinking) ladder.push({ model: PRIMARY_MODEL, thinking: true });
  ladder.push({ model: PRIMARY_MODEL, thinking: false });
  if (FALLBACK_MODEL !== PRIMARY_MODEL) {
    if (useThinking) ladder.push({ model: FALLBACK_MODEL, thinking: true });
    ladder.push({ model: FALLBACK_MODEL, thinking: false });
  }
  let usedModel = PRIMARY_MODEL, upstream = null, lastErr = "";
  try {
    for (const rung of ladder) {
      usedModel = rung.model;
      upstream = await callModel(rung.model, rung.thinking);
      if (upstream.ok) break;
      lastErr = await errText(upstream);            // consumed exactly once, cached here
      if (upstream.status !== 400 && upstream.status !== 404) break;   // auth/rate/5xx: no point retrying variants
    }
  } catch (e) {
    return json({ error: "Upstream request failed: " + (e && e.message || e) }, 502);
  }

  if (!upstream || !upstream.ok) return json({ error: (lastErr || ("HTTP " + (upstream ? upstream.status : "?"))) + " (model: " + usedModel + ")" }, 502);

  // Transform Anthropic's SSE stream into a plain-text token stream for the client.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let gotText = false;

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
            let evt;
            try { evt = JSON.parse(data); } catch (e) { continue; }
            if (evt.type === "content_block_start" && evt.content_block && evt.content_block.type === "thinking") {
              send(US + JSON.stringify({ status: "thinking" }) + "\n");
            } else if (evt.type === "content_block_delta" && evt.delta && evt.delta.type === "text_delta") {
              gotText = true;
              send(evt.delta.text);
            } else if (evt.type === "error" || (evt.error && evt.error.message)) {
              const em = (evt.error && evt.error.message) || (evt.message) || "stream error";
              send("[advisor error: " + em + "]");
              gotText = true;
            }
          }
        }
      } catch (e) {
        send("[advisor error: " + (e && e.message || e) + "]");
      } finally {
        if (!gotText) send("[advisor: model '" + usedModel + "' returned no text - check ANTHROPIC_API_KEY / CLAUDE_MODEL env vars in Netlify]");
        controller.close();
      }
    }
  });

  return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" } });
};

export const config = { path: "/api/advisor" };
