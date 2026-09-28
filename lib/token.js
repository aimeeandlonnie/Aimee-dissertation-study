import crypto from 'node:crypto';

const TOKEN_TTL_MS = 5 * 60 * 60 * 1000;

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function getSecret() {
  const s = process.env.TOKEN_SECRET;
  if (!s || s.length < 32) {
    throw new Error('TOKEN_SECRET env var missing or too short (>=32 chars required).');
  }
  return s;
}

export function signToken({ sessionId }) {
  const now = Date.now();
  const payload = { sid: sessionId, iat: now, exp: now + TOKEN_TTL_MS };
  const body = b64url(JSON.stringify(payload));
  const mac = b64url(crypto.createHmac('sha256', getSecret()).update(body).digest());
  return `${body}.${mac}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = b64url(crypto.createHmac('sha256', getSecret()).update(body).digest());
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(fromB64url(body).toString('utf8')); } catch { return null; }
  if (!payload.sid || !payload.exp) return null;
  if (Date.now() > payload.exp) return null;
  return payload;
}
