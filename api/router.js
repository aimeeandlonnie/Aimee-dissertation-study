import { applyCors, authAndRateLimit, readJson, getOpenAIKey } from '../lib/auth.js';
import { getFirebaseDatabase, withTimeout } from '../lib/firebase-admin.js';
import { CHATBOT_CACHE_VERSION } from '../lib/chatbot-system-prompt.js';
import { decodeEmbedding } from '../lib/embedding-codec.js';

const ALLOWED_MODELS = new Set(['gpt-5.4-mini', 'gpt-4o-mini']);
const MAX_COMPLETION_TOKENS = 60;
const MAX_INPUT_CHARS = 32 * 1024;

// On GENERATE, the closest cached answers are returned so the fresh answer
// can stay consistent with Velora details invented in earlier answers.
const RELATED_MAX = 5;
const RELATED_MIN_SIMILARITY = 0.45;

// Only the cross-participant cache entries closest to the question are
// shown to the router, so its prompt stays small however large the cache
// grows. This participant's own session entries are always shown (they
// are few, and needed to spot same-chat reuse). The client narrows the
// curated catalog the same way (curatedCatalogForQuestion in index.html).
const ROUTER_MAX_SHARED_CACHE = 20;
const CACHE_POOL_MAX = 2000;

function preview(text, n = 250) {
  const s = String(text || '');
  return s.length > n ? s.substring(0, n) + '...' : s;
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-4)
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
}

function cleanSessionCache(cache) {
  if (!Array.isArray(cache)) return [];
  return cache
    .filter(e => e && typeof e.question === 'string' && typeof e.answer === 'string')
    .slice(-100)
    .map(e => ({ question: e.question.slice(0, 4000), answer: e.answer.slice(0, 12000) }));
}

// The cross-participant cache is kept in this server instance's memory
// between questions. Each question downloads only the entries added since
// the last check (push keys sort by time), so Firebase downloads stay small
// however large the cache grows. A full reload every CACHE_FULL_RELOAD_MS
// (and on every new instance, e.g. after a deploy) picks up deletions such
// as the pre-launch reset.
const CACHE_FULL_RELOAD_MS = 10 * 60 * 1000;
const sharedCache = { entries: new Map(), lastKey: null, loadedAt: 0 };

function addCacheEntries(data) {
  for (const [key, e] of Object.entries(data || {})) {
    // Entries written under an older prompt (or before versioning) are
    // ignored rather than deleted.
    if (!e || !e.question || !e.answer || e.cacheVersion !== CHATBOT_CACHE_VERSION) continue;
    sharedCache.entries.set(key, {
      question: e.question,
      answer: e.answer,
      embedding: decodeEmbedding(e) || cleanEmbedding(e.embedding)
    });
  }
  for (const key of Object.keys(data || {})) {
    if (!sharedCache.lastKey || key > sharedCache.lastKey) sharedCache.lastKey = key;
  }
}

async function loadFirebaseSemanticCache() {
  try {
    // Non-critical: if Firebase is slow/unconfigured we route with what is
    // already in memory rather than stalling every question for 30s.
    const ref = getFirebaseDatabase().ref('semantic_cache');
    const fullReload = !sharedCache.loadedAt || Date.now() - sharedCache.loadedAt > CACHE_FULL_RELOAD_MS;
    if (fullReload) {
      const snap = await withTimeout(ref.get(), 2500);
      sharedCache.entries = new Map();
      sharedCache.lastKey = null;
      addCacheEntries(snap.val());
      sharedCache.loadedAt = Date.now();
    } else {
      // startAt includes lastKey itself; re-adding it is harmless.
      const query = sharedCache.lastKey ? ref.orderByKey().startAt(sharedCache.lastKey) : ref;
      const snap = await withTimeout(query.get(), 2500);
      addCacheEntries(snap.val());
    }
  } catch (err) {
    console.warn('semantic cache unavailable, using the in-memory copy:', err.message);
  }
  return [...sharedCache.entries.values()];
}

function cleanEmbedding(embedding) {
  if (embedding instanceof Float32Array) return embedding.length > 0 ? embedding : null;
  if (!Array.isArray(embedding) || embedding.length === 0 || embedding.length > 4096) return null;
  return embedding.every(n => typeof n === 'number' && Number.isFinite(n)) ? embedding : null;
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]; }
  return (magA && magB) ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}

function routerCandidates(pool, questionEmbedding) {
  if (!questionEmbedding) return pool.slice(0, 500);
  const session = pool.filter(e => e.fromSession);
  const shared = pool
    .filter(e => !e.fromSession && e.embedding)
    .map(e => ({ e, score: cosineSimilarity(questionEmbedding, e.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, ROUTER_MAX_SHARED_CACHE)
    .map(x => x.e);
  return [...session, ...shared];
}

function relatedEntries(cache, questionEmbedding) {
  if (!questionEmbedding) return [];
  return cache
    .filter(e => e.embedding)
    .map(e => ({ question: e.question, answer: e.answer, score: cosineSimilarity(questionEmbedding, e.embedding) }))
    .filter(e => e.score >= RELATED_MIN_SIMILARITY)
    .sort((a, b) => b.score - a.score)
    .slice(0, RELATED_MAX)
    .map(e => ({ question: e.question, answer: e.answer }));
}

// Parses the per-part lines that follow MULTI, e.g.
// "1. what is tor -> GENERATE". Cache indexes are resolved to the cached
// answer text; an out-of-range index falls back to GENERATE.
const MULTI_MAX_PARTS = 4;
const MULTI_PART_LINE = /^\s*\d+[.)]\s*(.+?)\s*->\s*(?:curated\s*:?\s*([a-z_0-9]+)|cache\s*:?\s*\[?\s*(\d+)|generate)/i;

function parseMultiParts(reply, cache) {
  const parts = [];
  for (const line of reply.split('\n').slice(1)) {
    const m = line.match(MULTI_PART_LINE);
    if (!m) continue;
    const question = m[1].trim().slice(0, 500);
    if (m[2]) {
      parts.push({ question, type: 'curated', id: m[2].toLowerCase() });
    } else if (m[3] !== undefined && parseInt(m[3], 10) < cache.length) {
      parts.push({ question, type: 'cache', answer: cache[parseInt(m[3], 10)].answer });
    } else {
      parts.push({ question, type: 'generate' });
    }
    if (parts.length >= MULTI_MAX_PARTS) break;
  }
  return parts;
}

function buildRouterPrompt({ question, history, curatedCatalog, cache }) {
  const cacheCatalog = cache.length === 0
    ? '(cache is empty)'
    : cache.map((entry, i) => {
        return `[${i}] question: "${preview(entry.question, 500)}"\n    answer: ${preview(entry.answer)}`;
      }).join('\n\n');

  const ctxLines = history.length > 0
    ? history.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n')
    : '(no prior turns)';

  return `You are the routing system for a Harvard research study chatbot. Identical participant questions MUST produce identical answers across participants for experimental validity. Your job is to decide whether to reuse an existing canonical answer or generate a fresh one.

OUTPUT EXACTLY ONE OF THESE, WITH NO EXPLANATION OR PREAMBLE:
- CURATED: <id>        (reuse a curated repository answer)
- CACHE: <index>       (reuse a cache answer from a prior participant)
- GENERATE             (generate a fresh answer)
- MULTI                (the question asks two or more separate things; see MULTI-PART RULE)

MULTI-PART RULE. If the question asks two or more separate things ("what is tor and what is seli", "what is recutting? how is it different from adding?", "who is nera and why does she help seli"), output MULTI on the first line, then one line per part in this exact format, at most 4 parts:
1. <the part, rewritten as a short standalone question that names its subject> -> CURATED: <id>
2. <the part> -> CACHE: <index>
3. <the part> -> GENERATE
Route each part on its own, applying every rule below to that part alone. A single question about how two things relate ("how is X different from Y", "compare X and Y", "is X a kind of Y") is ONE question, not MULTI. The one exception: if a cache entry answers this exact combination of parts (the same multi-part question asked before), output CACHE: <index> instead of MULTI.

SUBJECT RULE (check this first). Identify what the question is about: the term, House, person, place, event, or idea it names. Only an entry about that SAME subject can be reused. Many things the lesson names may have no entry of their own (for example the Houses Tor and Seli, House Marks, the record stone, Nera, the Festival of First Rain, or Velora itself). A question about such a subject is GENERATE unless an entry or cache item is specifically about it. Never pick an entry because the question has the same shape ("what is X", "define X", "explain X"), because the entry is a definition, or because it appears first in the list. Reusing an answer about a different subject is the worst possible outcome: the participant gets an answer to a question they did not ask. Generating is safe, because fresh answers are cached and later participants who ask the same thing get the same answer.

DEFAULT RULE. Among entries about the same subject, when in doubt, REUSE. The cost of incorrectly reusing a same-subject answer is small (a slightly off answer). The cost of incorrectly generating is high (two participants get different answers to the same question, breaking experimental consistency).

REUSE RULES. Reuse (CURATED or CACHE) when the participant's question is asking for the SAME core information about the SAME subject as an existing entry, even if:
- it is paraphrased ("what is X" vs "explain X" vs "describe X" vs "tell me about X")
- it is a shortened form ("X?" or just "X" right after a fuller question about X is in the catalog or context)
- it contains typos ("alignmnet", "reckonning", "weiging")
- it is reordered ("is X different from Y" vs "is Y different from X")
- it repeats a question the participant already asked moments earlier (in any form, including one-word repeats)
- it has filler or softening words ("so what does X mean?", "wait, X?", "can you tell me X again")

GENERATE RULES. Generate only when no existing entry answers the participant's specific information request:
- a comparison ("how is X different from Y") AND no entry compares X to Y
- an example ("give me an example of X") AND no entry gives examples
- a specific aspect ("why is X hard", "when does X happen") AND no entry covers it
- a genuinely new concept or specific application that no entry addresses
- a question outside the lesson scope (sports, weather, personal advice). Generate so the system prompt's refusal rules can fire.

DISAMBIGUATION.
- When both a CURATED and a CACHE entry match, always prefer CURATED.
- Never reuse a cache entry that answers several questions at once for a question (or part) that asks only one of them.
- When multiple CURATED entries match, pick the one whose answer most directly addresses the question's core (definition entry wins for "what is X"; comparison entry wins for "X vs Y").
- When the question could plausibly be REUSE or GENERATE and the entry is about the same subject, REUSE wins. Tie-breaker is consistency. If no entry is about the same subject, GENERATE.

WORKED EXAMPLES.
- Prior: (none). Now: "what is truing" -> CURATED: truing_def
- Prior: Q "what is truing" -> A. Now: "truing?" -> CURATED: truing_def (shortened repeat)
- Prior: Q "what does incompatible mean" -> A. Now: "incompatible?" -> CURATED: incompatible_claims_def (shortened repeat of same concept)
- Prior: (none). Now: "alignmnet? :)" -> CURATED: alignment_def (typo, same concept)
- Prior: (none). Now: "what is tor" -> GENERATE when no entry or cache item is about Tor (same "what is" shape as a definition entry, but a different subject)
- Prior: Q "what is a weighing" -> A. Now: "what is seli" -> GENERATE when no entry or cache item is about Seli (a new subject, not a repeat)
- Prior: Q "what is X" -> A. Now: "give me an example of X" -> GENERATE (asking for new info: example)
- Prior: Q "what is X" -> A. Now: "how is it different from Y" -> CURATED if an X-vs-Y entry exists, else GENERATE
- Prior: (none). Now: "what will i be asked later" -> CURATED: future_questions
- Prior: (none). Now: "what is truing and what is tor?" ->
  MULTI
  1. what is truing -> CURATED: truing_def
  2. what is tor -> GENERATE (or CACHE: <index> if a cache entry is about Tor)
- Prior: (none). Now: "how is adding different from recutting" -> one question, not MULTI

== CURATED REPOSITORY (the entries closest to the question; output only ids listed here) ==
${curatedCatalog}

== CACHE (${cache.length} entries from this session and the closest from prior participants) ==
${cacheCatalog}

== CONVERSATION SO FAR (the participant's CURRENT question is NOT in this list) ==
${ctxLines}

== PARTICIPANT'S CURRENT QUESTION ==
"${question}"

Output:`;
}

async function routeQuestion(body, res) {
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 4000) : '';
  const curatedCatalog = typeof body.curatedCatalog === 'string' ? body.curatedCatalog.slice(0, 48 * 1024) : '';
  if (!question || !curatedCatalog) { res.status(400).json({ error: 'route_question_required' }); return true; }

  const history = cleanHistory(body.history);
  const sessionCache = cleanSessionCache(body.sessionCache);
  const firebaseCache = await loadFirebaseSemanticCache();
  const seen = new Set();
  const pool = [];
  const sessionCount = sessionCache.length;
  [...sessionCache, ...firebaseCache].forEach((entry, i) => {
    if (!entry || !entry.question || !entry.answer || pool.length >= CACHE_POOL_MAX) return;
    const k = String(entry.question).toLowerCase().trim();
    if (seen.has(k)) return;
    seen.add(k);
    pool.push({
      question: String(entry.question).slice(0, 4000),
      answer: String(entry.answer).slice(0, 12000),
      embedding: cleanEmbedding(entry.embedding),
      fromSession: i < sessionCount
    });
  });
  // `cache` is what the router sees (and what CACHE: <index> refers to);
  // related answers are still searched across the whole pool.
  const questionEmbedding = cleanEmbedding(body.questionEmbedding);
  const cache = routerCandidates(pool, questionEmbedding);

  const prompt = buildRouterPrompt({ question, history, curatedCatalog, cache });
  if (prompt.length > 128 * 1024) { res.status(413).json({ error: 'router_prompt_too_large' }); return true; }

  const routerModel = ALLOWED_MODELS.has(body.model) ? body.model : 'gpt-5.4-mini';
  // GPT-5 reasoning models reject `temperature` and consume their token
  // budget on hidden reasoning. Use `reasoning_effort: 'none'` so the
  // single routing line (e.g. "CURATED: foo") isn't eaten by reasoning, and
  // give it a little more headroom than the 30 used for gpt-4o. A MULTI
  // reply lists up to 4 rewritten parts, so both budgets leave room for it.
  const isReasoningModel = /^gpt-5/.test(routerModel);
  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + getOpenAIKey()
    },
    body: JSON.stringify({
      model: routerModel,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: isReasoningModel ? 300 : 250,
      ...(isReasoningModel ? { reasoning_effort: 'none' } : { temperature: 0 })
    })
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    res.status(upstream.status).setHeader('Content-Type', 'application/json').send(text);
    return true;
  }

  const data = await upstream.json();
  const reply = (data.choices?.[0]?.message?.content || '').trim();
  // Token usage (including prompt-cache hits) goes back to the browser,
  // which logs it to the console for cost checks.
  const send = (payload) => res.status(200).json({ ...payload, usage: data.usage || null });
  const generate = () => send({
    type: 'generate',
    related: relatedEntries(pool, questionEmbedding)
  });

  if (/^\s*generate\b/i.test(reply)) {
    generate();
    return true;
  }

  // A multi-part question is always answered fresh (so the parts can be
  // stitched into one paragraph), with each part's reusable answer passed
  // along to keep it consistent. Fewer than two parsed parts means the
  // router's MULTI was not usable, so answer it as one fresh question.
  if (/^\s*multi\b/i.test(reply)) {
    const parts = parseMultiParts(reply, cache);
    if (parts.length < 2) { generate(); return true; }
    send({
      type: 'multi',
      parts,
      related: relatedEntries(pool, questionEmbedding)
    });
    return true;
  }

  let m = reply.match(/^\s*curated\s*:?\s*([a-z_0-9]+)/i);
  if (m) {
    send({ type: 'curated', id: m[1].toLowerCase() });
    return true;
  }

  m = reply.match(/^\s*cache\s*:?\s*\[?\s*(\d+)\s*\]?/i);
  if (m) {
    const idx = parseInt(m[1], 10);
    if (idx >= 0 && idx < cache.length) {
      send({ type: 'cache', answer: cache[idx].answer, question: cache[idx].question });
      return true;
    }
  }

  generate();
  return true;
}

export default async function handler(req, res) {
  if (!applyCors(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
  if (!authAndRateLimit(req, res)) return;

  let body;
  try { body = await readJson(req, 256 * 1024); }
  catch (e) { res.status(400).json({ error: e.message || 'bad_request' }); return; }

  if (body && body.routeQuestion === true) {
    try { await routeQuestion(body, res); }
    catch (err) {
      console.error('router decision error:', err.message);
      if (!res.headersSent) res.status(502).json({ error: 'router_decision_failed' });
    }
    return;
  }

  const { model, messages, max_completion_tokens, temperature } = body || {};
  if (!ALLOWED_MODELS.has(model)) { res.status(400).json({ error: 'model_not_allowed' }); return; }
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages_required' }); return;
  }
  if (JSON.stringify(messages).length > MAX_INPUT_CHARS) {
    res.status(413).json({ error: 'input_too_large' }); return;
  }

  const cap = Math.min(parseInt(max_completion_tokens, 10) || 30, MAX_COMPLETION_TOKENS);
  const temp = (typeof temperature === 'number' && temperature >= 0 && temperature <= 2) ? temperature : 0;
  const isReasoningModel = /^gpt-5/.test(model);

  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getOpenAIKey()
      },
      body: JSON.stringify({
        model, messages,
        max_completion_tokens: cap,
        ...(isReasoningModel ? { reasoning_effort: 'none' } : { temperature: temp })
      })
    });
    const text = await upstream.text();
    res.status(upstream.status).setHeader('Content-Type', 'application/json').send(text);
  } catch (err) {
    console.error('router upstream error:', err.message);
    res.status(502).json({ error: 'upstream_failed' });
  }
}
