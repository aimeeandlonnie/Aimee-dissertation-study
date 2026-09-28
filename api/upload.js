import { applyCors, readJson } from '../lib/auth.js';

// First-party proxy to DataPipe/Dataverse.
//
// The browser POSTs here — SAME ORIGIN as the study — and this forwards the
// request to pipe.jspsych.org server-side. Because the participant's browser
// only ever talks to the Vercel site (never the third-party DataPipe domain),
// ad-blockers, privacy browsers, and school/corporate firewalls that block
// pipe.jspsych.org no longer break participant uploads. Your Vercel server —
// which has no ad-blocker — relays the payload to Dataverse.
//
// No auth token is required. This is a thin relay to DataPipe, which is
// already openly writable by anyone holding the (non-secret) experiment IDs
// that ship in the client — so the proxy adds no new exposure. Keeping it
// token-free is also what lets the pagehide sendBeacon fallback (which cannot
// set an Authorization header) use it.
//
//   POST /api/upload?type=data    -> https://pipe.jspsych.org/api/data/    (JSON payloads)
//   POST /api/upload?type=base64  -> https://pipe.jspsych.org/api/base64/  (base64 payloads)
//
// Body is forwarded verbatim: { experimentID, filename, data }. The upstream
// status and body are mirrored back unchanged, so the client's success and
// FILE_EXISTS (duplicate = already stored) detection behave exactly as
// they did when posting to DataPipe directly.

const DATAPIPE_DATA_URL = 'https://pipe.jspsych.org/api/data/';
const DATAPIPE_BASE64_URL = 'https://pipe.jspsych.org/api/base64/';
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export default async function handler(req, res) {
  if (!applyCors(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }

  let body;
  try { body = await readJson(req, MAX_BODY_BYTES); }
  catch (e) { res.status(400).json({ error: e.message || 'bad_request' }); return; }

  const { experimentID, filename, data } = body || {};
  if (!experimentID || !filename || typeof data !== 'string') {
    res.status(400).json({ error: 'missing_fields' });
    return;
  }

  // ?type=base64 routes to the base64 endpoint; anything else -> data endpoint.
  let type = 'data';
  try {
    const parsed = new URL(req.url, 'http://localhost');
    if (parsed.searchParams.get('type') === 'base64') type = 'base64';
  } catch { /* default to data */ }
  const target = type === 'base64' ? DATAPIPE_BASE64_URL : DATAPIPE_DATA_URL;

  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ experimentID, filename, data })
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/json');
    res.send(text);
  } catch (err) {
    console.error('upload proxy upstream failed:', err && err.message);
    res.status(502).json({ error: 'upstream_failed' });
  }
}
