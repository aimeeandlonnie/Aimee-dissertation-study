import { applyCors, authAndRateLimit, readJson, getOpenAIKey } from '../lib/auth.js';

const ALLOWED_MODELS = new Set(['text-embedding-3-small']);
const MAX_BATCH = 256;
const MAX_INPUT_CHARS = 64 * 1024;

export default async function handler(req, res) {
  if (!applyCors(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
  if (!authAndRateLimit(req, res)) return;

  let body;
  try { body = await readJson(req); }
  catch (e) { res.status(400).json({ error: e.message || 'bad_request' }); return; }

  const { model, input } = body || {};
  if (!ALLOWED_MODELS.has(model)) { res.status(400).json({ error: 'model_not_allowed' }); return; }
  if (input == null || (typeof input !== 'string' && !Array.isArray(input))) {
    res.status(400).json({ error: 'input_required' }); return;
  }
  if (Array.isArray(input) && input.length > MAX_BATCH) {
    res.status(413).json({ error: 'batch_too_large' }); return;
  }
  const charCount = Array.isArray(input)
    ? input.reduce((acc, s) => acc + (typeof s === 'string' ? s.length : 0), 0)
    : input.length;
  if (charCount > MAX_INPUT_CHARS) { res.status(413).json({ error: 'input_too_large' }); return; }

  try {
    const upstream = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getOpenAIKey()
      },
      body: JSON.stringify({ model, input })
    });
    const text = await upstream.text();
    res.status(upstream.status).setHeader('Content-Type', 'application/json').send(text);
  } catch (err) {
    console.error('embed upstream error:', err.message);
    res.status(502).json({ error: 'upstream_failed' });
  }
}
