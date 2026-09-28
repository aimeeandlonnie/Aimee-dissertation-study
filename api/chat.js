import { applyCors, authAndRateLimit, readJson, getOpenAIKey } from '../lib/auth.js';
import { CHATBOT_SYSTEM_PROMPT } from '../lib/chatbot-system-prompt.js';

const ALLOWED_MODELS = new Set(['gpt-5.4', 'gpt-4o-mini']);
const MAX_COMPLETION_TOKENS = 500;
const MAX_INPUT_CHARS = 32 * 1024;

export default async function handler(req, res) {
  if (!applyCors(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
  if (!authAndRateLimit(req, res)) return;

  let body;
  try { body = await readJson(req); }
  catch (e) { res.status(400).json({ error: e.message || 'bad_request' }); return; }

  const { model, messages, max_completion_tokens, temperature, stream } = body || {};
  if (!ALLOWED_MODELS.has(model)) { res.status(400).json({ error: 'model_not_allowed' }); return; }
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages_required' }); return;
  }
  const totalChars = JSON.stringify(messages).length;
  if (totalChars > MAX_INPUT_CHARS) { res.status(413).json({ error: 'input_too_large' }); return; }

  // The chatbot's system prompt (with the study's research-integrity rules)
  // lives server-side so it is not exposed in the client. The client sets
  // hplSystem:true and sends only the scope anchor + conversation; we prepend
  // the canonical system prompt here.
  const outMessages = (body && body.hplSystem === true)
    ? [{ role: 'system', content: CHATBOT_SYSTEM_PROMPT }, ...messages]
    : messages;

  const cap = Math.min(parseInt(max_completion_tokens, 10) || 350, MAX_COMPLETION_TOKENS);
  const temp = (typeof temperature === 'number' && temperature >= 0 && temperature <= 2) ? temperature : 0;
  const wantsStream = stream === true;
  // GPT-5 family models are reasoning models: they reject `temperature`
  // (anything but the default) and instead accept `reasoning_effort`. Sending
  // temperature returns a 400 and the chatbot goes silent. gpt-4o-style
  // models still take temperature as before.
  const isReasoningModel = /^gpt-5/.test(model);

  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getOpenAIKey()
      },
      body: JSON.stringify({
        model, messages: outMessages,
        max_completion_tokens: cap,
        ...(isReasoningModel ? { reasoning_effort: 'none' } : { temperature: temp }),
        ...(wantsStream ? { stream: true } : {})
      })
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      res.status(upstream.status).setHeader('Content-Type', 'application/json').send(text);
      return;
    }

    if (!wantsStream) {
      const text = await upstream.text();
      res.status(upstream.status).setHeader('Content-Type', 'application/json').send(text);
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
    } finally {
      res.end();
    }
  } catch (err) {
    console.error('chat upstream error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'upstream_failed' });
    } else {
      try { res.end(); } catch {}
    }
  }
}
