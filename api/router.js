import { applyCors, authAndRateLimit, readJson, getOpenAIKey } from '../lib/auth.js';
import { getFirebaseDatabase, withTimeout } from '../lib/firebase-admin.js';

const ALLOWED_MODELS = new Set(['gpt-5.4-mini', 'gpt-4o-mini']);
const MAX_COMPLETION_TOKENS = 60;
const MAX_INPUT_CHARS = 32 * 1024;

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

async function loadFirebaseSemanticCache() {
  try {
    // Non-critical: if Firebase is slow/unconfigured we route without the
    // cross-participant cache rather than stalling every question for 30s.
    const snap = await withTimeout(getFirebaseDatabase().ref('semantic_cache').get(), 2500);
    const data = snap.val();
    return data
      ? Object.values(data).filter(e => e && e.question && e.answer)
      : [];
  } catch (err) {
    console.warn('semantic cache unavailable:', err.message);
    return [];
  }
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

OUTPUT EXACTLY ONE OF THESE LINES, WITH NO EXPLANATION OR PREAMBLE:
- CURATED: <id>        (reuse a curated repository answer)
- CACHE: <index>       (reuse a cache answer from a prior participant)
- GENERATE             (generate a fresh answer)

DEFAULT RULE. When in doubt, REUSE. The cost of incorrectly reusing is small (a slightly off answer). The cost of incorrectly generating is high (two participants get different answers to the same question, breaking experimental consistency). Bias toward REUSE.

REUSE RULES. Reuse (CURATED or CACHE) when the participant's question is asking for the SAME core information as an existing entry, even if:
- it is paraphrased ("what is X" vs "explain X" vs "describe X" vs "tell me about X")
- it is a shortened form ("X?" or just "X" right after a fuller question about X is in the catalog or context)
- it contains typos ("redistribrition", "naive theroy", "thot xperment")
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
- When multiple CURATED entries match, pick the one whose answer most directly addresses the question's core (definition entry wins for "what is X"; comparison entry wins for "X vs Y").
- When the question could plausibly be REUSE or GENERATE, REUSE wins. Tie-breaker is consistency.

WORKED EXAMPLES.
- Prior: (none). Now: "what is consistency monitoring" -> CURATED: consistency_monitoring_def
- Prior: Q "what is consistency monitoring" -> A. Now: "consistency monitoring?" -> CURATED: consistency_monitoring_def (shortened repeat)
- Prior: Q "what does internally inconsistent mean" -> A. Now: "internally inconsistent?" -> CURATED: internally_inconsistent (shortened repeat of same concept)
- Prior: (none). Now: "redistrribution? :)" -> CURATED: belief_weight_def (typo, same concept)
- Prior: Q "what is X" -> A. Now: "give me an example of X" -> GENERATE (asking for new info: example)
- Prior: Q "what is X" -> A. Now: "how is it different from Y" -> CURATED if an X-vs-Y entry exists, else GENERATE
- Prior: (none). Now: "what will i be asked later" -> CURATED: future_questions

== CURATED REPOSITORY ==
${curatedCatalog}

== CACHE (${cache.length} entries from prior participants and this session) ==
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
  const cache = [];
  for (const entry of [...sessionCache, ...firebaseCache]) {
    if (!entry || !entry.question || !entry.answer) continue;
    const k = String(entry.question).toLowerCase().trim();
    if (seen.has(k)) continue;
    seen.add(k);
    cache.push({
      question: String(entry.question).slice(0, 4000),
      answer: String(entry.answer).slice(0, 12000)
    });
    if (cache.length >= 500) break;
  }

  const prompt = buildRouterPrompt({ question, history, curatedCatalog, cache });
  if (prompt.length > 128 * 1024) { res.status(413).json({ error: 'router_prompt_too_large' }); return true; }

  const routerModel = ALLOWED_MODELS.has(body.model) ? body.model : 'gpt-5.4-mini';
  // GPT-5 reasoning models reject `temperature` and consume their token
  // budget on hidden reasoning. Use `reasoning_effort: 'none'` so the
  // single routing line (e.g. "CURATED: foo") isn't eaten by reasoning, and
  // give it a little more headroom than the 30 used for gpt-4o.
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
      max_completion_tokens: isReasoningModel ? 64 : 30,
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

  if (/^\s*generate\b/i.test(reply)) {
    res.status(200).json({ type: 'generate' });
    return true;
  }

  let m = reply.match(/^\s*curated\s*:?\s*([a-z_0-9]+)/i);
  if (m) {
    res.status(200).json({ type: 'curated', id: m[1].toLowerCase() });
    return true;
  }

  m = reply.match(/^\s*cache\s*:?\s*\[?\s*(\d+)\s*\]?/i);
  if (m) {
    const idx = parseInt(m[1], 10);
    if (idx >= 0 && idx < cache.length) {
      res.status(200).json({ type: 'cache', answer: cache[idx].answer });
      return true;
    }
  }

  res.status(200).json({ type: 'generate' });
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
