import { applyCors, authAndRateLimit, readJson } from '../lib/auth.js';

// CRT scoring key — correct and intuitive (wrong) answers per protocol.
// Kept server-side so participants cannot read the answers from the client
// and cheat. The client sends raw CRT answers and gets back annotations.
const CRT_ANSWER_KEY = {
  bat_ball:  { correct: 5,  intuitive: 10  },
  widgets:   { correct: 5,  intuitive: 100 },
  lily_pads: { correct: 47, intuitive: 24  },
  house_den: { correct: 20, intuitive: 40  },
  shoes:     { correct: 81, intuitive: 80 }
};

// LLM-knowledge scoring key — points per option (3 = completely right,
// 2 = mostly right, 1 = kind of right, 0 = wrong). Server-side for the same
// reason as the CRT key.
const LLM_KNOWLEDGE_KEY = {
  llmk_1: { A: 0, B: 1, C: 2, D: 3 },
  llmk_2: { A: 2, B: 3, C: 1, D: 0 },
  llmk_3: { A: 0, B: 3, C: 1, D: 2 },
  llmk_4: { A: 2, B: 0, C: 3, D: 1 },
  llmk_5: { A: 3, B: 1, C: 0, D: 2 },
  llmk_6: { A: 3, B: 2, C: 1, D: 0 },
  llmk_7: { A: 0, B: 3, C: 1, D: 2 }
};

export default async function handler(req, res) {
  if (!applyCors(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
  if (!authAndRateLimit(req, res)) return;

  let body;
  try { body = await readJson(req); }
  catch (e) { res.status(400).json({ error: e.message || 'bad_request' }); return; }

  const answers = (body && body.crt) || {};
  const scored = {};
  for (const id of Object.keys(CRT_ANSWER_KEY)) {
    const key = CRT_ANSWER_KEY[id];
    const raw = answers[id];
    const participant = (raw != null && raw !== '' && Number.isFinite(Number(raw))) ? Number(raw) : null;
    scored[id] = {
      correct_answer: key.correct,
      intuitive_wrong_answer: key.intuitive,
      scored_correct: participant != null && participant === key.correct,
      gave_intuitive_wrong: participant != null && participant === key.intuitive
    };
  }
  const llmAnswers = (body && body.llm_knowledge) || {};
  const llm_knowledge_scored = {};
  for (const id of Object.keys(LLM_KNOWLEDGE_KEY)) {
    const key = LLM_KNOWLEDGE_KEY[id];
    const selected = Object.prototype.hasOwnProperty.call(key, llmAnswers[id]) ? llmAnswers[id] : null;
    llm_knowledge_scored[id] = {
      points: selected != null ? key[selected] : null,
      points_by_option: key
    };
  }
  res.status(200).json({ scored, llm_knowledge_scored });
}
