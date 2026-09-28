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
  res.status(200).json({ scored });
}
