import crypto from 'node:crypto';
import { applyCors, readJson } from '../lib/auth.js';
import { signToken } from '../lib/token.js';

const PER_IP_ISSUE_LIMIT = parseInt(process.env.PER_IP_TOKEN_LIMIT || '15', 10);
const PER_IP_WINDOW_MS = 60 * 60 * 1000;
const ipBuckets = new Map();

function pruneOld() {
  const now = Date.now();
  for (const [k, v] of ipBuckets) {
    if (now - v.firstSeen > PER_IP_WINDOW_MS) ipBuckets.delete(k);
  }
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

export default async function handler(req, res) {
  if (!applyCors(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }

  try { await readJson(req); } catch { /* body optional */ }

  pruneOld();
  const ip = getClientIp(req);
  const now = Date.now();
  const bucket = ipBuckets.get(ip) || { firstSeen: now, count: 0 };
  if (bucket.count >= PER_IP_ISSUE_LIMIT) {
    res.status(429).json({ error: 'too_many_token_requests' });
    return;
  }
  bucket.count += 1;
  ipBuckets.set(ip, bucket);

  const sessionId = crypto.randomBytes(16).toString('hex');
  try {
    const token = signToken({ sessionId });
    res.status(200).json({ token, sessionId, expiresInMs: 5 * 60 * 60 * 1000 });
  } catch (err) {
    console.error('token issue failed:', err.message);
    res.status(500).json({ error: 'token_issue_failed' });
  }
}
