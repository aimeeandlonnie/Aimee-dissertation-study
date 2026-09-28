import { applyCors, authAndRateLimit, readJson } from '../lib/auth.js';
import { getFirebaseDatabase, withTimeout } from '../lib/firebase-admin.js';

const CONDITION_ROTATION = ['baseline', 'private', 'visible'];
const MAX_STRING = 32 * 1024;

function nowIso() {
  return new Date().toISOString();
}

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function requireString(value, name, max = MAX_STRING) {
  if (typeof value !== 'string') throw new Error(`${name}_required`);
  if (value.length > max) throw new Error(`${name}_too_large`);
  return value;
}

function requireHash(value) {
  const hash = requireString(value, 'hash', 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('invalid_hash');
  return hash;
}

function cleanParticipantId(value) {
  const id = requireString(value, 'participant_id', 64);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('invalid_participant_id');
  return id;
}

function cleanCondition(value) {
  const condition = requireString(value, 'condition', 32);
  if (!CONDITION_ROTATION.includes(condition)) throw new Error('invalid_condition');
  return condition;
}

function normalizeCacheEntry(entry) {
  if (!isObject(entry)) throw new Error('entry_required');
  const question = requireString(entry.question, 'question', 4000).trim();
  const answer = requireString(entry.answer, 'answer', 12000).trim();
  const embedding = Array.isArray(entry.embedding) ? entry.embedding : null;
  if (!question || !answer) throw new Error('entry_incomplete');
  if (embedding && embedding.length > 4096) throw new Error('embedding_too_large');
  if (embedding && !embedding.every(n => typeof n === 'number' && Number.isFinite(n))) {
    throw new Error('invalid_embedding');
  }
  return {
    question,
    answer,
    ...(embedding ? { embedding } : {}),
    savedAt: typeof entry.savedAt === 'string' ? entry.savedAt : nowIso()
  };
}

async function claimCounter(refName) {
  const db = getFirebaseDatabase();
  const ref = db.ref(refName);
  const result = await ref.transaction(current => {
    const n = parseInt(current || '0', 10);
    return Number.isFinite(n) ? n + 1 : 1;
  });
  return parseInt(result.snapshot.val() || '1', 10);
}

async function handleAction(body) {
  const db = getFirebaseDatabase();
  const action = body && body.action;

  switch (action) {
    case 'claimParticipantId': {
      const next = await claimCounter('participant_counter');
      return { participantId: 'P' + String(next).padStart(3, '0'), counter: next };
    }

    case 'claimCondition': {
      const next = await claimCounter('condition_counter');
      const previous = next - 1;
      return { condition: CONDITION_ROTATION[previous % CONDITION_ROTATION.length], counter: next };
    }

    case 'getEmailHash': {
      const hash = requireHash(body.hash);
      const snap = await db.ref(`email_hashes/${hash}`).get();
      return { exists: snap.exists() };
    }

    case 'putEmailHash': {
      const hash = requireHash(body.hash);
      const participantId = cleanParticipantId(body.participant_id);
      await db.ref(`email_hashes/${hash}`).set({
        participant_id: participantId,
        saved_at_iso: nowIso()
      });
      return { ok: true };
    }

    // Early contact capture: store the participant's email as soon as they
    // consent — BEFORE the study runs — so that even if their final upload
    // fails (blocked/offline), we still have a way to reach them and their
    // condition. Keyed by email hash (deduped), value holds the raw email so
    // the researcher can contact them. Separate from email_hashes (which is
    // the anonymous dedup index written at completion).
    case 'recordContactEmail': {
      const hash = requireHash(body.hash);
      const email = requireString(body.email, 'email', 320).trim();
      const condition = body.condition ? cleanCondition(body.condition) : null;
      await db.ref(`contact_emails/${hash}`).set({
        email,
        condition,
        saved_at_iso: nowIso()
      });
      return { ok: true };
    }

    case 'appendSemanticCache': {
      const entry = normalizeCacheEntry(body.entry);
      await db.ref('semantic_cache').push(entry);
      return { ok: true };
    }

    case 'saveChatbotUserCsv': {
      const participantId = cleanParticipantId(body.participant_id);
      const condition = cleanCondition(body.condition);
      const csvContent = requireString(body.csv_content, 'csv_content', 128 * 1024);
      const totalUserTurns = parseInt(body.total_user_turns || '0', 10);
      await db.ref(`chatbot_user_messages/${participantId}`).set({
        participant_id: participantId,
        condition,
        total_user_turns: Number.isFinite(totalUserTurns) ? totalUserTurns : 0,
        saved_at_iso: nowIso(),
        saved_at_eastern: typeof body.saved_at_eastern === 'string' ? body.saved_at_eastern : null,
        csv_content: csvContent
      });
      return { ok: true };
    }

    case 'appendQaPairs': {
      if (!Array.isArray(body.pairs)) throw new Error('pairs_required');
      if (body.pairs.length > 100) throw new Error('too_many_pairs');
      const ref = db.ref('qa_repository');
      const updates = {};
      for (const pair of body.pairs) {
        if (!isObject(pair)) continue;
        const question = requireString(pair.question || '', 'question', 4000).trim();
        const answer = requireString(pair.answer || '', 'answer', 12000).trim();
        if (!question) continue;
        updates[ref.push().key] = { question, answer };
      }
      if (Object.keys(updates).length) await ref.update(updates);
      return { ok: true, count: Object.keys(updates).length };
    }

    default:
      throw new Error('unknown_action');
  }
}

export default async function handler(req, res) {
  if (!applyCors(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
  if (!authAndRateLimit(req, res)) return;

  let body;
  try { body = await readJson(req, 256 * 1024); }
  catch (e) { res.status(400).json({ error: e.message || 'bad_request' }); return; }

  try {
    // Cap total Firebase work well under the 30s function limit so a hung
    // admin-SDK connection returns a fast error (letting the frontend's
    // fallbacks engage) instead of a 504.
    const result = await withTimeout(handleAction(body || {}), 12000);
    res.status(200).json(result);
  } catch (err) {
    console.error('firebase action failed:', err.message);
    const badRequest = /required|invalid|too_large|too_many|unknown|incomplete/.test(err.message);
    res.status(badRequest ? 400 : 500).json({ error: err.message || 'firebase_failed' });
  }
}
