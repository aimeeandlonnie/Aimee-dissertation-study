# How the chatbot answers

How a participant's question becomes a chatbot reply, what keeps replies consistent across participants, and where each piece lives in the code. To test it, see [CHATBOT_TESTS.md](CHATBOT_TESTS.md). For costs, see [TESTING.md](TESTING.md) §3.1.

The chatbot is identical in every condition. 

---

## 1. The pipeline at a glance

```
question
  │
  ├─ 1. embed the question (text-embedding-3-small)
  ├─ 2. follow-up / meta / context-dependent? ──yes──► write fresh, not cached          route: skipped
  ├─ 3. same question asked earlier in this chat? ──yes──► re-explain the earlier answer  route: repeat
  ├─ 4. router (gpt-5.4-mini) picks a reference:
  │       CURATED: <id>   an FAQ answer
  │       CACHE: <n>      an answer already given to someone
  │       GENERATE        no reference
  │       MULTI           several questions in one message, each routed on its own
  │
  └─ 5. reply
          FAQ / cached, first question of the chat ──► sent word for word         route: faq / cache
          FAQ / cached, later in the chat ──────────► fitted to the conversation  route: faq_adapted / cache_adapted
          GENERATE ─────────────────────────────────► written fresh, then cached  route: new
          MULTI ────────────────────────────────────► parts stitched together, coverage-checked, then cached
                                                                                      route: multi
```

Except for a word-for-word reply, every reply is written with the **whole conversation** in view, plus the system prompt and an extra instruction block built for that question.

**Message order (for cost).** Each answer call is sent as: system prompt, then the earlier turns, then the instruction block, then the newest question. The instruction block is the only part that changes with every question, so placing it near the end keeps the start of each request identical to the previous one. OpenAI automatically bills a repeated start of a prompt at about a tenth of the price (for prompts of 1,024 tokens or more). The system prompt is discounted for everyone, and in a chat, every turn except the latest exchange is discounted too. The discount only applies when a request reaches the OpenAI server that holds the earlier one, so every chatbot answer call carries the same `prompt_cache_key` (`PROMPT_CACHE_KEY` in [api/chat.js](api/chat.js)), which sends them to the same servers. If OpenAI ever rejects that setting, the call is retried without it. Keep this order when changing `callOpenAI`.

## 2. Step by step

**1. Embed.** The question is turned into an embedding, a numeric fingerprint used to compare it with earlier questions and answers.

**2. Questions that skip the router.** They only make sense next to the previous turn, so they're always written fresh and never cached (`isFollowUp`, `isMetaQuestion` and `isContextDependent`). There are three kinds:
- follow-ups such as "explain that more simply" or "give me another example";
- meta questions that ask whether something counts as a category, such as "why is the cradle rule a rule?" or "is recutting really learning?". Ordinary why/how questions such as "why did Nera go to Seli?" are not meta and go through the router;
- context-dependent questions such as "why?", "and Seli?" or "is that true?".

**3. Repeats.** A question counts as a repeat if it has the same text as an earlier question in this chat, ignoring capitals and punctuation, or if its embedding is at least 95% similar to an earlier one. A repeat skips the router.

The reply opens with a natural line ("I get why this is still tricky, so let's clarify it further."), using a different one each time. It then explains the idea from another angle and keeps every fact of the earlier answer.

The router also catches repeats: if it picks an FAQ or cached answer already shown in this chat (for example "truing?" after "What is truing?"), that's treated as a repeat too.

**4. Router.** One gpt-5.4-mini call decides what the reply should be built on. It sees:
- the ~20 FAQ entries closest to the question, plus four that the integrity rules depend on;
- all of this participant's cached answers, plus the ~20 closest answers given to other participants;
- the last 4 turns of the conversation;
- the question.

Its main rules:
- **Subject rule.** It may reuse an entry only if it's about the same subject as the question. This fixed the bug where "What is Tor?" got the Weighing answer.
- **Reuse when in doubt** among entries about the same subject.
- **Write fresh** for anything no entry covers.

**5. Reply.**

| Route | Written by | Gets | Cached? |
|---|---|---|---|
| `faq` / `cache` | nobody (sent as is) | the first question of a chat; any word-for-word answer (§3) | no |
| `faq_adapted` / `cache_adapted` | gpt-5.4-mini | the reference answer: keep its sentences nearly word for word, and change at most one sentence or add one connecting clause | no |
| `new` | gpt-5.4 | the 3 closest FAQ answers as style examples, and up to 5 related cached answers whose details must stay consistent | yes |
| `multi` | gpt-5.4 | each part with its FAQ or cached answer (if any), stitched into one paragraph | yes |
| `repeat` | gpt-5.4 | the earlier answer, plus the re-explanation instructions | no |
| `skipped` | gpt-5.4 | the style examples | no |

**Multi-part check.** A multi-part reply isn't streamed. Before it's shown, gpt-5.4-mini checks that every part was answered. If one was skipped, the reply is regenerated once with the missing part named.

**Caching.** New and multi-part replies are saved to Firebase `semantic_cache`, so the router can reuse them for later participants. A reply written partway through a chat can refer to the conversation ("like Tor, which we discussed"), so gpt-5.4-mini first rewrites it into a standalone version, and that's what gets cached. If the rewrite fails, nothing is cached. Every entry is labelled with `CHATBOT_CACHE_VERSION`, and the router ignores entries with any other label.

**How the router reads the cache.** Each server keeps a copy of `semantic_cache` in memory. On each question it downloads only the entries added since its last check, and every 10 minutes (and whenever a new server starts, for example after a deploy) it reloads the whole node, which picks up deletions. Embeddings are stored compactly: 32-bit numbers in base64 (`embeddingB64`, about 8 KB per entry instead of about 30 KB). This changes similarity scores by about a ten-billionth, so no decision changes. Older entries that store `embedding` as a plain list are still read. Firebase downloads therefore stay small however large the cache grows.

## 3. Always sent word for word

These are never fitted to the conversation or re-explained:

- **The fixed "how I work" reply** (`how_chatbot_works`). This is a research-integrity rule.
- **Answers to explicit questions about the Turning of the Stone contradiction:** `turning_keep_vs_remove`, `what_turning_really_does` and `shifting_vs_chiseling`.
- **Short acknowledgements without the closer**, such as "Okay, glad to help." after "I'm done".

The list is `VERBATIM_FAQ_IDS` in `index.html`.

## 4. Rules every written reply follows

These live in the system prompt, [lib/chatbot-system-prompt.js](lib/chatbot-system-prompt.js). The server adds it to every call, so it never reaches the browser.

**Length and form:**
- 2 to 4 sentences in one paragraph, plus the closer "Do you have another question about the lesson?".
- Plain prose, with no dashes of any kind.
- Every part of a multi-part question is answered.

**Using the conversation:**
- connect to earlier topics where that helps;
- don't re-explain at length something just explained;
- address misunderstandings the participant's earlier messages show;
- never change facts to fit the conversation.

**Invented details.** The chatbot may add modest details the lesson leaves open, but each one must:
1. fit the story;
2. agree with details already given, in this chat or in related cached answers;
3. never touch the lesson's key ideas.

**The Turning of the Stone contradiction:**
- It's never raised or hinted at unless the participant explicitly asks what happens to the earlier Mark, whether Nera owes Tor on the repair day, whether someone still owes their former House, or whether the descriptions fit together.
- When asked, the reply gives both descriptions and never picks one.

**Declines:**
- The study design, visibility of the chat, which condition the participant is in, and how the chatbot works are all declined.
- Off-topic and real-world questions are declined too.

## 5. What gets logged

Each chatbot message in the exported data (`chatbot_conversation.messages`) has two extra fields, which also appear in the **Route** and **Reference** columns of the *Chatbot Conversation* sheet:

- **`route`:** `faq`, `cache`, `faq_adapted`, `cache_adapted`, `new`, `multi`, `repeat` or `skipped`.
- **`reference_id`:** the FAQ id the reply was built on (for `multi`, a list of ids), or `cache: <question>` for a cached answer.

The browser console also logs each decision, for example `Router: CURATED "truing_def"`, `Reference answer: fitting it to the conversation` or `Repeated question (…)`.

**Token usage.** Every OpenAI call also logs its token counts, for example:

```
Tokens [answer, gpt-5.4]: 5480 in (4864 discounted, 89%), 112 out
```

"Discounted" counts the input tokens that matched the start of a recent request and were billed at the lower price. In a chat, the answer calls should show most of their input discounted from the second question on. The router calls show a smaller share, since only their fixed instructions repeat. The embedding calls aren't logged (they cost almost nothing). This appears only in the console, not in the exported data.

## 6. Where things live and what you can change

| What | Where |
|---|---|
| Main flow | `sendChatMessage` in [index.html](index.html) |
| FAQ answers and their trigger phrases | `CHATBOT_FAQ` in [index.html](index.html) |
| Skip-the-router patterns | `FOLLOWUP_PATTERNS`, `META_PATTERNS`, `CONTEXT_DEPENDENT_PATTERNS` in [index.html](index.html) |
| Repeat detection | `findEarlierAnswerToSameQuestion`, `buildRepeatBlock` in [index.html](index.html) |
| Fitting a reference to the conversation | `buildReferenceBlock` in [index.html](index.html) |
| Multi-part answers | `buildMultiPartBlock`, `findUnansweredParts` in [index.html](index.html); `parseMultiParts` in [api/router.js](api/router.js) |
| Standalone rewrite and caching | `makeStandaloneAnswer`, `cacheFreshAnswer`, `persistAnswer` in [index.html](index.html) |
| Router prompt and candidate selection | `buildRouterPrompt`, `routerCandidates`, `relatedEntries` in [api/router.js](api/router.js); `curatedCatalogForQuestion` in [index.html](index.html) |
| Reading the cache (in-memory copy, incremental downloads) | `loadFirebaseSemanticCache` in [api/router.js](api/router.js) |
| Compact embedding format | [lib/embedding-codec.js](lib/embedding-codec.js); written by `normalizeCacheEntry` in [api/firebase.js](api/firebase.js) |
| System prompt and cache version | [lib/chatbot-system-prompt.js](lib/chatbot-system-prompt.js) |
| Message order and token logging | `callOpenAI`, `logTokenUsage` in [index.html](index.html); `stream_options` in [api/chat.js](api/chat.js) |

**Settings:**

| Setting | Value | File | Effect |
|---|---|---|---|
| `CHATBOT_CACHE_VERSION` | `velora-open-v3` | lib/chatbot-system-prompt.js | Change it to retire every cached answer |
| `VERBATIM_FAQ_IDS` | 4 ids | index.html | FAQ answers always sent word for word |
| `REPEAT_MIN_SIMILARITY` | 0.95 | index.html | How similar a rewording must be to count as a repeat |
| `ROUTER_CURATED_CANDIDATES` | 20 | index.html | FAQ entries the router sees, besides `ROUTER_ALWAYS_INCLUDE` |
| `ROUTER_MAX_SHARED_CACHE` | 20 | api/router.js | Other participants' cached answers the router sees |
| `RELATED_MAX` / `RELATED_MIN_SIMILARITY` | 5 / 0.45 | api/router.js | Related cached answers passed in for consistency |
| `MULTI_MAX_PARTS` | 4 | api/router.js | Most parts a multi-part question is split into |
| `CACHE_FULL_RELOAD_MS` | 10 minutes | api/router.js | How often each server reloads the whole cache (to pick up deletions) |

**Changing things safely:**
- **After editing the system prompt or an FAQ answer,** change `CHATBOT_CACHE_VERSION` if answers cached under the old wording shouldn't be reused, then delete the old entries from `semantic_cache` (see [TESTING.md](TESTING.md) §6.1). Changing the version and redeploying takes effect immediately. A deletion on its own reaches servers that are already running only at their next full reload, up to 10 minutes later.
- **When adding an FAQ entry,** give it several trigger phrases. The router finds candidates through them, so an entry with weak triggers may not be among the 20 the router sees.
