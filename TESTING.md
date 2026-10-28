# End-to-end testing

How to test the deployed study as a team, check that data is actually stored, and reset everything before launch. Read [SETUP.md](SETUP.md) first for how the pipeline is built.

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

1. **The chatbot cache (`semantic_cache`).** Every newly written chatbot answer is saved there, and the router can give it **word for word to real participants**, or feed it into later answers as "established Velora details". Treat everything you type during testing as something participants may see, and reset the cache before launch (§6).
2. **The condition counter (`condition_counter`).** Unless you pick a condition in the test panel's **Force condition** menu *before consenting*, each fresh test run uses up the next turn of the real rotation. Always force a condition.
3. **OpenAI calls** are real and billed.

**Worth checking in this phase:**
- All three conditions (baseline / reasoning = Chatbot B / scripted = Chatbot A): framing text and diagram, chatbot reminder banner and header, icon boxes on the rating pages.
- Chatbot behaviour. The browser console logs each routing decision, for example `Router: CURATED "…"`, `Router: CACHE`, or `Router: GENERATE … (N related cached answers)`. Ask the same question twice in a row and check that the second answer is reused.
- Every questionnaire page, the two manipulation-check pages, and the debrief.
- The data in `window.__lastResearcherPayload`: every section filled in, and the right condition.

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
| Firebase `semantic_cache` | New entries labelled `cacheVersion: "velora-open-v1"` |

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
- **Questions that aren't cached.** Follow-ups ("explain that more simply"), category questions ("why is X a Y") and context-dependent questions ("why?", "and Seli?") always get a new answer and are never cached. Testing reuse with them won't work.

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
| `semantic_cache` | Chatbot answer cache. Optionally keep entries you've checked and want reused |

Every node is recreated automatically on the next write.

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
