# End-to-end testing

How to test the deployed study as a team, check that data is actually stored, and reset everything before launch. Read [SETUP.md](SETUP.md) first for how the pipeline is built, and [CHATBOT.md](CHATBOT.md) for how the chatbot produces its answers.

- **Live study URL:** https://aimee-dissertation-study.vercel.app/
- **Researcher mode:** https://aimee-dissertation-study.vercel.app/?researcher-access

> **The rule that matters most:** researcher mode does **not** upload data, so it cannot tell you whether storage works. Checking storage needs a normal participant run, and those write to the real databases. Do them **before launch only**, then reset.

---

## 1. How the pipeline fits together

```
GitHub repo ──deploys──► Vercel (holds the secret keys)
                            ├─► OpenAI      chatbot answers, routing, embeddings
                            ├─► Firebase    counters, chatbot cache, emails, chat logs
                            └─► /api/upload ─► DataPipe ─► Dataverse   data files
```

- **Secrets** (`OPENAI_API_KEY`, `FIREBASE_*`, `TOKEN_SECRET`, …) live only in Vercel's environment variables.
- **The 4 DataPipe experiment IDs** (Main, Consent, XLSX, Email) are written into `index.html`. DataPipe creates **one Dataverse collection per experiment**, so a participant's files end up in four different places.
- **Deploys:** if Vercel is connected to this GitHub repo, **pushing to `main` redeploys the live study**. Ask the account owner before pushing.

## 2. Access each tester needs

| Service | Needed for | How the owner grants it |
|---|---|---|
| [Study URL](https://aimee-dissertation-study.vercel.app/) | Running the study | Public |
| **Dataverse** | Seeing the uploaded files | Collection → *Edit → Permissions* → assign the tester's Harvard Dataverse account a role. Viewing needs a read role. **Resetting needs a role that can edit files** (e.g. Curator / Contributor). |
| **Firebase** | Checking counters, cache, emails, chat logs | Firebase console → *Project settings → Users and permissions*. **Viewer** can read the data; **Editor** is needed to reset it. |
| Vercel | Deploy logs and server errors (optional) | The free Hobby plan likely can't add members; the owner can share logs instead. |
| DataPipe, OpenAI | Not needed | Check results in Dataverse instead. OpenAI only needs to work. |

Only someone with edit rights in Firebase and Dataverse can do the reset in §6.

### 2.1 What to exchange with the setup owner

Testing "on your laptop" means using the **deployed URL in your laptop's browser**. Nothing needs to be installed, and **no API keys or passwords need to change hands**.

**Send the owner:**

| Info | So they can… |
|---|---|
| Your **Harvard Dataverse account username** (create one at dataverse.harvard.edu first) | Give you a role on **all four** DataPipe collections (Main, Consent, XLSX, Email) |
| The **Google account email** you'll use for Firebase | Add you under *Project settings → Users and permissions* (Viewer to check, Editor to reset) |
| Your **GitHub username** (only if you'll push code) | Give you access to the repo |

**Additional info/checks:**

- [ ] Links to the **four Dataverse collections**, and confirmation that their datasets are **still unpublished** (see §6.2)
- [ ] Which **branch Vercel deploys from**, and whether pushing to it updates the live study
- [ ] Whether **Preview deployments** have the same environment variables as Production, if you want to test a branch at its own preview URL before merging
- [ ] Confirmation that the four **DataPipe experiments** are set up as in [SETUP.md](SETUP.md) §4, and that their IDs match those in `index.html`
- [ ] That an **OpenAI spending limit** is set, since your tests use their credits
- [ ] Who does the **reset before launch**, and when (§6)
- [ ] *(Optional)* Access to **Vercel logs**, or a way to get them if something fails on the server

**Don't ask for secrets.** You don't need `OPENAI_API_KEY`, the Firebase service account, `TOKEN_SECRET`, or the Dataverse API token to test in the browser.

You'd need those only to run the server code **locally** (for example with `vercel dev`) against their accounts. Handing them over is a security risk. If you need to run code locally, set up your own copy of the pipeline per [SETUP.md](SETUP.md) instead: your own accounts and keys, and on a separate branch your own 4 DataPipe IDs in `index.html`.

Opening `index.html` straight from disk won't work either. It calls `/api/...` on the same site, and the server rejects requests from other sites unless they're added to `ALLOWED_ORIGINS`.

---

## 3. Phase 1: researcher-mode testing (no real data stored)

Open **https://aimee-dissertation-study.vercel.app/?researcher-access**. The flag must be spelled exactly like that. 

A test panel appears: force a condition, jump to any screen, skip the reading timers, dump the data, reset the study. Copy/paste blocks are lifted.

**Blocked in researcher mode:**

| What | Normally goes to |
|---|---|
| Sequential participant number (P001…). The run keeps a `temp-XXXX` ID | Firebase `participant_counter` |
| Server-side CRT and LLM-knowledge scoring. Test data has no scores | `api/score.js` (stores nothing) |
| Main response JSON, plus its local backup and retries | Dataverse (Main) |
| Consent PDF / Excel file / email file | Dataverse (Consent / XLSX / Email) |
| Email hash (the "already participated" record) | Firebase `email_hashes` |
| Raw email + condition saved at consent | Firebase `contact_emails` |
| Chat messages CSV | Firebase `chatbot_user_messages` |
| Q&A pairs from the conversation | Firebase `qa_repository` |
| `partial_` upload when someone leaves early | Dataverse (Main) |
| "Completed" flag, duplicate-email check, "already completed" redirect | Browser / Firebase (read only) |

At the end, the page says nothing was uploaded. The full data is printed in the browser console and kept in `window.__lastResearcherPayload`, marked `researcher_mode: true`.

**⚠️ Still written in researcher mode:**

1. **The chatbot cache (`semantic_cache`).** Every new chatbot answer is saved there (as a standalone version), and the router can give it **word for word to a real participant's first question**, use it as the reference for their later answers, or feed it into later answers as "established Velora details". Treat everything you type during testing as something participants may see, and reset the cache before launch (§6).
2. **The condition counter (`condition_counter`).** Unless you pick a condition in the test panel's **Force condition** menu *before consenting*, each fresh test run uses up the next turn of the real rotation. Always force a condition.
3. **OpenAI calls** are real and billed to the setup owner's key (see §3.1).

**Worth checking in this phase:**
- All three conditions (baseline / reasoning = Chatbot B / scripted = Chatbot A): framing text and diagram, chatbot reminder banner and header, icon boxes on the rating pages.
- Chatbot behaviour. The browser console logs each routing decision, for example `Router: CURATED "…"`, `Router: CACHE`, `Router: GENERATE … (N related cached answers)`, or `Router: MULTI …` for a question with several parts. Only the first question of a chat gets an FAQ or cached answer word for word; later ones are fitted to the conversation (`Reference answer: fitting it to the conversation`). Ask the same question twice in a row: the second answer should be a re-explanation that opens naturally ("I get why this is still tricky…"), not the same text again. See [CHATBOT_TESTS.md](CHATBOT_TESTS.md) for the full list.
- Every questionnaire page, the two manipulation-check pages, and the debrief.
- The data in `window.__lastResearcherPayload`: every section filled in, and the right condition.

### 3.1 API calls and OpenAI costs

Researcher mode and participant mode cost the same. Every chatbot question calls OpenAI for real.

**Calls per question.** The study caps each browser session at **500 calls** to its own API (`PER_TOKEN_CALL_LIMIT`). Resetting the study starts a new session.

| Question type | Calls |
|---|---|
| New answer (`GENERATE`) | 3: embedding, router, answer; 4 after the first question, adding the standalone rewrite for the cache |
| FAQ or cached answer, first question of the chat (sent as is) | 2: embedding, router |
| FAQ or cached answer later in the chat (fitted to the conversation) | 3: embedding, router, answer |
| Skips the router (follow-up, meta, context-dependent) | 2: embedding, answer |
| Repeated question in the same chat | 2: embedding, answer (3 if the router is what spotted the repeat) |
| Multi-part question (`MULTI`) | 4: embedding, router, answer, coverage check; plus 1 if a part was skipped and the answer is regenerated, and 1 for the standalone rewrite after the first question |
| Opening the chat screen | 2, once: embeds the FAQ triggers |

**Price per call.** These are list prices as of October 2026, without OpenAI's automatic discount for repeated prompt text, which can lower input costs a lot:

| Call | Model (price per 1M tokens) | Approx. cost |
|---|---|---|
| Embedding | text-embedding-3-small ($0.02) | under $0.0001 |
| Router | gpt-5.4-mini ($0.75 in / $4.50 out) | ~$0.004, flat however large the cache gets: it sees only the ~20 closest FAQ entries and the ~20 closest cached answers (~5K tokens) |
| Answer, new / multi-part / repeated | gpt-5.4 ($2.50 in / $15 out) | ~$0.015–0.02, growing slowly as the conversation gets longer |
| Answer, FAQ or cached answer fitted to the conversation | gpt-5.4-mini | ~$0.005 |
| Standalone rewrite (new answers after the first question, before caching) | gpt-5.4-mini | ~$0.001–0.002 |

**Per question and per run.**

| | Approx. cost |
|---|---|
| New answer (router + answer, plus rewrite after the first question) | $0.02–0.025 |
| FAQ or cached answer, first question (router only) | ~$0.004 |
| FAQ or cached answer later in the chat (router + gpt-5.4-mini answer) | ~$0.01 |
| Skips the router (answer only) | $0.015–0.02 |
| Repeated question (answer only) | $0.015–0.02 |
| Multi-part question (router + answer + check, sometimes a second answer) | $0.025–0.05 |
| One participant asking ~10 questions | ~$0.15 |
| Full [CHATBOT_TESTS.md](CHATBOT_TESTS.md) list (~150 questions) | ~$2–3 |

**Caveats.**

- Neither the router cost nor Firebase downloads grow much with `semantic_cache`. Each server keeps the cache in memory and downloads only new entries per question, plus a full reload every 10 minutes (see [CHATBOT.md](CHATBOT.md) §2). Old entries (other `cacheVersion`s) are still downloaded on those full reloads without being used, so delete them (§6).
- These are list-price estimates from the prompt sizes. Real costs should be lower, because OpenAI bills a repeated start of a prompt at about a tenth of the price. The system prompt repeats in every answer call, and so do the earlier turns of a chat (see [CHATBOT.md](CHATBOT.md) §1).
- To check, open the browser console while chatting. Every OpenAI call logs a line like `Tokens [answer, gpt-5.4]: 5480 in (4864 discounted, 89%), 112 out`. From the second question of a chat on, answer calls should show most of their input discounted. Router, multi-part-check and standalone-rewrite calls normally show 0%, because their repeated part is under OpenAI's 1,024-token minimum. In a first 6-question test chat (November 2026), the real total was about $0.045, roughly $0.008 per question. Also check the setup owner's OpenAI usage dashboard after the first test session, and make sure a spending limit is set (§2.1).
- OpenAI keeps API inputs for up to 30 days for abuse monitoring, and doesn't use them for training by default. Test questions are sent to OpenAI just like participants' questions.

---

## 4. Phase 2: participant-mode testing (writes to the real databases)

**Only before launch.** Open **https://aimee-dissertation-study.vercel.app/**, without `?researcher-access`.

**Before you start:**
- Use a **throwaway email for each run**. Afterwards it's saved as "already participated" and that email is blocked.
- Use a fresh browser profile or private window for each run, or clear site data (§6.3). Otherwise you'll get the "already completed" page or a "resume" prompt.
- You can't force a condition in this mode; the rotation picks it. Run at least 3 completions to cover all three conditions (baseline → reasoning → scripted, in that order from a reset counter). Do the completions first, because every consent, including a dropout, moves the rotation on.

**Test runs:**
1. **Complete run.** Go all the way to "You're all done". The end screen should say *"Your responses have been saved."* If it says it's still saving, keep the tab open; it retries for about 25 minutes.
2. **Dropout run.** Consent, go a few screens in, then close the tab.
3. **Duplicate run.** Reuse a completed email; you should be sent to the "already completed" page.
4. *(Optional)* **Resume run.** Close the tab mid-study, reopen the link in the same browser, and accept the resume prompt.

**Checklist: a complete run should produce:**

| Where | Expect |
|---|---|
| Dataverse – Main | `P00N_<condition>_<DD-MM-YYYY>_data.json` |
| Dataverse – Consent | `P00N_consent_<date>.pdf` |
| Dataverse – XLSX | `P00N_<condition>_<date>_data.xlsx` |
| Dataverse – Email | `<email>_<condition>.json` |
| Firebase `participant_counter` | Goes up by 1 per completion |
| Firebase `condition_counter` | Goes up by 1 per **consent** (dropouts count too) |
| Firebase `email_hashes` | One entry per completed email |
| Firebase `contact_emails` | One entry per consent, including dropouts |
| Firebase `chatbot_user_messages/P00N` | Chat CSV |
| Firebase `qa_repository` | Q&A pairs from the conversation |
| Firebase `semantic_cache` | New entries labelled with the current `CHATBOT_CACHE_VERSION` (`"velora-open-v3"` as of this writing) |

A dropout run should produce `partial_temp-XXXX_<condition>_<date>_data.json` in Dataverse – Main, plus its `contact_emails` entry, and no P-number.

Open the main JSON and check: the condition matches what was shown, the chatbot transcript is there, and every questionnaire section is filled in, including `appraisal.learning_experience_likert` and both manipulation-check questions. `researcher_mode` should be `false`, and CRT / LLM-knowledge scores should be present.

**Caveats when reading the results:**
- **`partial_` files are not the same as dropouts.** One is sent whenever the page is closed **or reloaded** before finishing, so someone who reloads and then completes has both a `partial_` file and a full file. DataPipe also rejects a second file with the same name, so only a participant's **first** `partial_` file of the day is kept.
- **If uploads fail**, check the DataPipe experiment settings (see [SETUP.md](SETUP.md) §4): Main needs *Accept new data* and *Validation* on; the other three need *Accept new data* and *Accept base64 file uploads* on, with *Validation* off.
- **Live answer keys:** the Velora learning questions are never scored by the code; scoring happens in analysis. Only CRT and LLM-knowledge are scored, on the server.

---

## 5. Things that affect assignment and data

- **Condition rotation.** Each consent takes the next turn from `condition_counter`: `(counter − 1) mod 3` → baseline, reasoning, scripted. Tests during live collection, and real participants who drop out after consenting, all use up turns, so groups among finishers can end up slightly uneven. Pre-launch tests don't matter if you reset the counter.
- **Chatbot cache version.** Cache entries are labelled with `CHATBOT_CACHE_VERSION` in `lib/chatbot-system-prompt.js`. The router ignores entries with any other label. Changing the label and redeploying retires every existing cache entry without deleting anything. Use it if the prompt changes after launch.
- **Questions that aren't cached.** Only new and multi-part answers are cached. Follow-ups ("explain that more simply"), category questions ("why is X a Y"), context-dependent questions ("why?", "and Seli?"), repeats, and FAQ or cached answers fitted to the conversation never add an entry. Testing reuse with them won't work. To see reuse, ask the same question as the **first** question of a new session.

---

## 6. Reset before launch

Do this **after the final deploy and immediately before opening to participants.** Requires the edit access from §2.

### 6.1 Firebase

Console → **Realtime Database → Data**. Hover over each node → trash icon. **Do not change the Rules tab.**

| Node | Contains |
|---|---|
| `participant_counter` | P-number counter. Missing = 0, so the next completion becomes P001 |
| `condition_counter` | Rotation counter. Missing = 0, so the next participant gets baseline |
| `email_hashes` | "Already participated" records |
| `contact_emails` | Emails + condition from consent |
| `chatbot_user_messages` | Chat CSVs |
| `qa_repository` | Q&A log |
| `semantic_cache` | Chatbot answer cache. Optionally keep entries you've checked and want reused, but remove entries from older `cacheVersion`s, which are downloaded on every full reload without being used |

Every node is recreated automatically on the next write.

**The chatbot cache takes up to 10 minutes to forget.** Servers that are already running keep their in-memory copy of `semantic_cache` until their next full reload, so deleted answers can still be reused for up to 10 minutes. For the pre-launch reset, also change `CHATBOT_CACHE_VERSION` and redeploy (or at least redeploy). A deploy starts fresh servers, so the reset takes effect immediately.

**After launch, never delete whole nodes.** Delete only specific test entries, found by P-number, email hash or timestamp.

### 6.2 Dataverse

In **each of the four collections**, delete the test files (`P00N_…`, `partial_…`, `<email>_…`).

**⚠️ Files can only be fully removed from a draft (unpublished) dataset.** If a dataset has been published, deleting a file only removes it from the next version, and the published version keeps it. Keep the datasets unpublished until testing is done.

### 6.3 Each tester's browser

- **Recommended:** DevTools → *Application → Storage → **Clear site data*** for the study URL.
- **Or:** the test panel's **Reset study** button.
  - ⚠️ **Known bug:** this clears `hpl_session_snapshot_v2`, but the code now saves the resume snapshot as `hpl_session_snapshot_v3`, so a "resume" prompt may still appear. Use *Clear site data* until it's fixed.

### 6.4 Confirm

- [ ] All seven Firebase nodes are gone (or the counters are at 0)
- [ ] All four Dataverse collections are free of test files
- [ ] One researcher-mode pass on the final deployment looks right, **with a condition forced**. Then delete `semantic_cache` and `condition_counter` once more, since that pass may have written to them.
- [ ] Open to participants

---

## 7. Known gaps (as of this writing)

- Researcher mode still writes to the shared chatbot cache, and to the condition counter unless a condition is forced (§3).
- No way to check storage after launch without adding fake participants. A possible fix is a test-upload mode that saves with a `TEST_` prefix and skips the counters.
- Dropouts after consent use up rotation turns (§5).
- **Reset study** clears the wrong snapshot key (§6.3).
- The manipulation-check answer options still describe the chatbots as "reflected on…" / "matched keywords… to a database". The framing page now says "keyword search algorithm" / "context-sensitive planning".
