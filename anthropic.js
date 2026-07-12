// netlify/functions/anthropic.js
// Server-side proxy for the Base58 Consensus Detector.
// The Anthropic API key is read from the ANTHROPIC_API_KEY environment variable
// (set in Netlify → Site settings → Environment variables) and is NEVER sent to
// the browser. The frontend POSTs an Anthropic /v1/messages body to this function;
// this function adds the key + version headers and forwards it upstream.
//
// Requires Netlify's Node 18+ runtime (global fetch). This is the default on Netlify.

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, anthropic-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      statusCode: 500,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "ANTHROPIC_API_KEY is not set in the Netlify environment." }),
    };
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: event.body, // pass the client's model / messages / max_tokens / temperature straight through
    });

    const text = await upstream.text();
    const headers = { ...cors, "Content-Type": "application/json" };
    // Forward rate-limit backoff hint so the client's retry logic can honor it.
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) headers["retry-after"] = retryAfter;

    return { statusCode: upstream.status, headers, body: text };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Proxy failed to reach Anthropic: " + (e && e.message) }),
    };
  }
};
