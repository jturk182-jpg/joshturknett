// Talk finder: streams a Claude reply for the speaking-page assistant.
// The API key stays server-side in the ANTHROPIC_API_KEY env var (set in Netlify).
import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";
import { SYSTEM_PROMPT } from "./prompt.mjs";

const MODEL = process.env.TALK_FINDER_MODEL || "claude-sonnet-5-5";
const MAX_USER_TURNS = 10;
const MAX_MESSAGE_CHARS = 1500;
const MAX_TOTAL_CHARS = 30000;
const MAX_PER_IP_PER_DAY = Number(process.env.TALK_FINDER_IP_DAILY_LIMIT || 60);
const MAX_SITE_PER_DAY = Number(process.env.TALK_FINDER_DAILY_LIMIT || 2000);

// Requests must come from the site, a Netlify deploy, or local dev.
const ALLOWED_ORIGIN = /^https:\/\/((www\.)?joshturknett\.com|([a-z0-9-]+--)?joshturknett\.netlify\.app)$|^http:\/\/localhost(:\d+)?$/;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function validMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_USER_TURNS * 2) return false;
  let total = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const expectedRole = i % 2 === 0 ? "user" : "assistant";
    if (!m || m.role !== expectedRole || typeof m.content !== "string") return false;
    const text = m.content.trim();
    if (!text) return false;
    // Assistant turns carry the talk block, so they get more room than visitor turns.
    if (m.role === "user" && text.length > MAX_MESSAGE_CHARS) return false;
    total += text.length;
  }
  return messages[messages.length - 1].role === "user" && total <= MAX_TOTAL_CHARS;
}

// Daily counters in Netlify Blobs: one per visitor IP, one for the whole site.
// The per-minute limit is enforced by Netlify itself (config.rateLimit below).
async function overDailyLimit(ip) {
  try {
    const store = getStore("talk-finder-usage");
    const day = new Date().toISOString().slice(0, 10);
    const keys = [`${day}/site`, `${day}/ip/${ip}`];
    const [site, mine] = await Promise.all(keys.map((k) => store.get(k)));
    const siteCount = Number(site || 0);
    const ipCount = Number(mine || 0);
    if (siteCount >= MAX_SITE_PER_DAY || ipCount >= MAX_PER_IP_PER_DAY) return true;
    await Promise.all([store.set(keys[0], String(siteCount + 1)), store.set(keys[1], String(ipCount + 1))]);
    return false;
  } catch (err) {
    console.error("talk-finder usage store unavailable", err);
    return false;
  }
}

export default async (req, context) => {
  if (req.method !== "POST") return json(405, { error: "method" });

  const origin = req.headers.get("origin") || "";
  if (!ALLOWED_ORIGIN.test(origin)) return json(403, { error: "origin" });

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("talk-finder: ANTHROPIC_API_KEY is not set");
    return json(503, { error: "unavailable" });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_request" });
  }
  const messages = body?.messages;
  if (!validMessages(messages)) return json(400, { error: "too_long" });

  if (await overDailyLimit(context.ip || "unknown")) return json(429, { error: "limit" });

  const client = new Anthropic();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = client.beta.messages.stream({
          model: MODEL,
          max_tokens: 4000,
          output_config: { effort: "low" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
          messages: messages.map((m) => ({ role: m.role, content: m.content.trim() })),
        });
        for await (const event of response) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const final = await response.finalMessage();
        if (final.stop_reason === "refusal") controller.enqueue(encoder.encode("\n[[error]]"));
      } catch (err) {
        console.error("talk-finder: Claude request failed", err?.status, err?.message);
        controller.enqueue(encoder.encode("\n[[error]]"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
};

export const config = {
  path: "/api/talk-finder",
  rateLimit: { windowLimit: 12, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
