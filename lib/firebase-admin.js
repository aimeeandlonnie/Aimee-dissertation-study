import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

function parseServiceAccount() {
  const base64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!base64 && !json) return null;

  const raw = base64
    ? Buffer.from(base64, 'base64').toString('utf8')
    : json;

  const parsed = JSON.parse(raw);
  if (parsed.private_key) {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  return parsed;
}

// Race a Firebase operation against a deadline. A hung admin-SDK
// connection (e.g. missing/invalid service-account credentials on the
// host) would otherwise stall a serverless function until its 30s
// wall-clock limit and return a 504. With this, callers can degrade
// gracefully on a 'firebase_timeout' rejection instead.
export function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('firebase_timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// The Realtime Database URL is public config (it's also hardcoded in the
// frontend), not a secret. Used as a fallback so a missing or still-
// placeholder FIREBASE_DATABASE_URL env var can't hang the whole backend.
// A valid env var always takes precedence.
const FALLBACK_DATABASE_URL = 'https://hpl-study-lb-default-rtdb.firebaseio.com';

export function getFirebaseDatabase() {
  let databaseURL = process.env.FIREBASE_DATABASE_URL;
  if (!databaseURL || databaseURL.includes('your-project-id')) {
    databaseURL = FALLBACK_DATABASE_URL;
  }

  if (!getApps().length) {
    const serviceAccount = parseServiceAccount();
    initializeApp({
      credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
      databaseURL
    });
  }

  return getDatabase();
}
