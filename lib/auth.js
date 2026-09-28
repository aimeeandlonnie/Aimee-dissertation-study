import { verifyToken } from './token.js';

function getAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

export function applyCors(req, res) {
  const origin = req.headers.origin || '';
  const allowed = getAllowedOrigins();
  const requestHost = req.headers['x-forwarded-host'] || req.headers.host || '';
  // Four-way decision:
  //   1. No Origin header → same-origin request (some browsers, notably
  //      Safari, omit Origin on same-origin POSTs). Allow.
  //   2. Origin's host matches the host the request was sent to → the page
  //      is calling its OWN same-origin backend. Chrome DOES send an Origin
  //      header in this case, so it must be allowed regardless of the
  //      ALLOWED_ORIGINS allowlist. This is what keeps the deployed site
  //      working even when ALLOWED_ORIGINS is unset or misconfigured.
  //   3. Cross-origin and in the allowlist (or '*'). Allow + reflect.
  //   4. Cross-origin and not allowed. Reject.
  let sameOrigin = false;
  try { sameOrigin = !!origin && !!requestHost && new URL(origin).host === requestHost; }
  catch { sameOrigin = false; }
  let ok;
  if (!origin || sameOrigin) {
    ok = true;
  } else if (allowed.length === 0) {
    ok = false;
  } else {
    ok = allowed.includes('*') || allowed.includes(origin);
  }
  if (ok && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') {
    res.status(ok ? 204 : 403).end();
    return false;
  }
  if (!ok) {
    res.status(403).json({ error: 'origin_not_allowed' });
    return false;
  }
  return true;
}

const PER_TOKEN_LIMIT = parseInt(process.env.PER_TOKEN_CALL_LIMIT || '500', 10);
const PER_TOKEN_WINDOW_MS = 5 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = parseInt(process.env.PER_TOKEN_MIN_INTERVAL_MS || '0', 10);
const tokenBuckets = new Map();

function pruneOld() {
  const now = Date.now();
  for (const [k, v] of tokenBuckets) {
    if (now - v.firstSeen > PER_TOKEN_WINDOW_MS) tokenBuckets.delete(k);
  }
}

export function authAndRateLimit(req, res) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) { res.status(401).json({ error: 'missing_token' }); return null; }
  const payload = verifyToken(token);
  if (!payload) { res.status(401).json({ error: 'invalid_or_expired_token' }); return null; }

  pruneOld();
  const now = Date.now();
  const bucket = tokenBuckets.get(payload.sid) || { firstSeen: now, count: 0, lastAt: 0 };
  if (bucket.count >= PER_TOKEN_LIMIT) {
    res.status(429).json({ error: 'session_call_limit_reached' });
    return null;
  }
  if (now - bucket.lastAt < MIN_INTERVAL_MS) {
    res.status(429).json({ error: 'rate_limited' });
    return null;
  }
  bucket.count += 1;
  bucket.lastAt = now;
  tokenBuckets.set(payload.sid, bucket);

  return payload;
}

export async function readJson(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) { reject(new Error('payload_too_large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

export function getOpenAIKey() {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error('OPENAI_API_KEY env var missing.');
  return k;
}
