# End-to-end testing

How to test the deployed study as a team, check that data is actually stored, and reset everything before launch. Read [SETUP.md](SETUP.md) first for how the pipeline is built, and [CHATBOT.md](CHATBOT.md) for a plain-language summary of how the chatbot produces its answers.

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

### 3.1 What the chatbot costs

**In short: about 1 cent per question, or 5–10 cents per participant.** Testing and real participants cost the same, because every chatbot question calls OpenAI for real. The cost goes to the OpenAI account on the study's key, which belongs to the setup owner.

| Who | Likely cost |
|---|---|
| One participant (about 10 questions) | $0.05–0.10 |
| 50 participants | $3–5 |
| 150 participants | $8–15 |
| 300 participants | $15–30 |
| Running the full [CHATBOT_TESTS.md](CHATBOT_TESTS.md) list once (about 150 questions) | $1–3 |

**For budgeting, plan on $0.20 per participant** (so $60 for 300) plus a little for testing. That leaves room for people who ask many questions, and for the start of the study, when there are few stored answers to reuse and more answers have to be newly written.

**Cost of one question:**

| What the chatbot does | Approx. cost |
|---|---|
| Sends a stored answer word for word | 0.2–0.4¢ |
| Lightly edits a stored answer to fit the chat | 0.3–0.7¢ |
| Answers a follow-up or repeated question | 0.5–1.5¢ |
| Writes a new answer | 0.7–1.6¢ |
| Answers several questions in one message | 0.8–1.6¢, or up to about 3¢ if it needs a second try |

The low end of each range applies when OpenAI's discount kicks in. Every answer resends the lesson and the chatbot's rules, and OpenAI charges about a tenth of the price for text it has seen very recently. That discount is not guaranteed: in our test chat it applied to some answers and not others.

**Other costs, not included above:**

- **Firebase (the database):** roughly 1–3 GB of downloads for 300 participants, which fits within the free plan's 10 GB a month. On the paid plan, downloads cost about $1 per GB. Delete old chatbot answers before launch so they don't add to this (§6).
- **Vercel (the website host):** not estimated here. Check which plan the study is on.
- **Participant payments:** separate, and likely the largest cost of the study.

**How reliable these numbers are.** They come from one 6-question test chat in November 2026, which cost about 4.7¢ in total, and from OpenAI's published prices. One short chat is limited evidence, and the settings changed slightly after it, so treat these as estimates and check them against real use:

- **Before testing:** make sure a spending limit is set on the OpenAI account (§2.1).
- **After the first test session and during the pilot:** check the OpenAI usage page. If the cost per question is far above about 2¢, stop and investigate.

**If you run into a limit.** Each browser session stops after 500 calls to the study's server, which is about 150 questions. Clicking Reset or opening a new private window starts a new session.

**Privacy note.** Test questions go to OpenAI just like participants' questions. OpenAI keeps them for up to 30 days for abuse monitoring, and doesn't use them for training by default.

<details>
<summary>Details for whoever checks the numbers</summary>

Prices per 1 million tokens (a token is about three-quarters of a word), from OpenAI's model pages, November 2026:

| Model | Used for | Input | Discounted input | Output |
|---|---|---|---|---|
| gpt-5.4 | new, follow-up, repeated and multi-part answers | $2.50 | $0.25 | $15.00 |
| gpt-5.4-mini | choosing a stored answer, lightly edited answers, cleaning answers for storage, the multi-part check | $0.75 | $0.075 | $4.50 |
| text-embedding-3-small | comparing questions (costs almost nothing) | $0.02 | n/a | n/a |

Sizes measured in the test chat: about 3,100 input tokens per router call (expected to reach about 4,700 as the cache fills), and 4,300–4,850 input and 50–85 output tokens per answer.

To see the numbers for your own chat, open the browser console. Each OpenAI call logs a line such as `Tokens [answer, gpt-5.4]: 4772 in (3840 discounted, 80%), 81 out`. Router, multi-part-check and cleaning calls normally show 0% discounted, because their repeated text is under OpenAI's 1,024-token minimum.

</details>

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
