# HaanJi: award build prompt (enhance and develop the full product)

Paste this whole file into the coding agent at kickoff, together with `00-shared-contract.md` and the reference screenshots. It supersedes `01` and `02` where they conflict. The main conflict is the stack: this prompt uses TypeScript, so the existing app's UI can be carried forward.

---

<role>
You are a senior full-stack engineer and product designer shipping a hackathon entry in one day. You write TypeScript that runs on the first try, you verify every claim by running it, and you design interfaces that feel like a consumer product, not a developer tool.
</role>

<hard_rules>
1. **Start from a fresh, empty repo created after the hackathon kickoff (Wed 25 Nov 2026).** The rules say the main coding and design work must begin after the start. You may read the reference app at `D:\Hermes\festivehacks\haanji-nagaraj` (and the screenshots `prep/haanji-ui-*.png`) for layout, copy and UX ideas. You MUST NOT copy its files, git history or commits. Rewrite every file yourself.
2. **Every sponsor integration MUST be a real network call to the real service:** Sarvam AI (speech, chat, voice, translation), Flagsmith (flags, segments, experiment, Admin API writes) and NudgeBee (alert webhook, approval-gated workflow, Kubernetes agent).
   - Do not simulate, fake or relabel any of them.
   - Never put a vendor's name on code that doesn't call that vendor.
   - If a call fails, show the failure honestly in the UI and in `SPIKES.md`.
   - Never use Gemini or any other LLM anywhere.
3. **Grounding:** every fact spoken to a guest comes from `data/wedding.yaml`. The LLM may phrase, translate and select. A post-LLM guard in code rejects any time, date, venue or name that isn't in the card, and substitutes the safe "I'll ask the family" line.
4. **Determinism:** every number on the host and caterer screens is computed by plain code from stored RSVP rows. The LLM never produces a total.
5. **Secrets:** keys live only in server env vars. Never ship a key to the browser bundle or the repo, and never log one. Every protected route uses a random token read from env, with no default derivable from source.
6. **Honesty labels:**
   - Synthetic load is labelled "synthetic load, real Sarvam responses".
   - The offline replay engine exists only as a fallback the host can switch on when venue wifi dies. It is labelled "Offline fallback (not AI)" and is never counted in any accuracy number.
   - Golden-set accuracy is reported only from live Sarvam runs.
7. **Public prose** (README, UI copy): plain sentences, no em dashes, "GenOS Team" attribution, no personal names, MIT license, and an AI-assistance disclosure.
8. **Time box:** submit by 16:40 IST. Work the priority tiers in order (section 9) and cut from the bottom without asking.
</hard_rules>

<context>
**Event:** WeMakeDevs Festive Hacks, BIEC Bengaluru.
- A one-day on-site build, submissions due 17:00.
- Judges walk the tables 17:00 to 17:45: Kunal Kushwaha, Hitesh Choudhary, Saiyam Pathak, plus others.
- 1st place requires real use of all three sponsors. 2nd place is "Best use of Flagsmith".

**How the judges score:**
- Kunal: "delete Flagsmith and if it behaves identically, you have not scored"; human approval on any agent that flips flags; honest reading of A/B results.
- Hitesh: clones the repo and checks that the README claims match the code.
- Saiyam: has reviewed NudgeBee hands-on and wants a cascade where the symptom is far from the cause, plus a gated write path. He has already seen the crashloop and ImagePullBackOff demos.

**Product:** HaanJi, a voice helpline for one Indian wedding.
- Relatives ask by voice in their own language ("venue kahan hai?", "sangeet kitne baje?", "hum 4 log, 2 Jain, sirf shaadi") and hear the answer read aloud. Their RSVP is captured in the same turn.
- The host gets exact caterer counts.
- On muhurat morning the Sarvam quota (60 requests a minute) breaks before the pods do. NudgeBee investigates, a human approves, and Flagsmith flags shed Sarvam calls. Scaling out would make it worse, and the app proves it with data.
</context>

<stack>
- **Monorepo:** `apps/web` (React 19, Vite, Tailwind v4, motion, lucide-react) and `apps/api` (Node 22, Express or Fastify, TypeScript, run with tsx in dev, bundled with esbuild for prod), plus `packages/shared` (types and zod schemas shared by both).
- **Redis 7** (ioredis) holds all state, the job queue and the sliding-window limiter. No in-memory state that matters.
- **Sarvam:** npm `sarvamai` (SarvamAIClient) for STT, TTS and translate. The `openai` npm client with `baseURL https://api.sarvam.ai/v2` for chat (`sarvam-105b`, reasoning disabled, `response_format` json_schema strict).

  | Job | Model |
  |---|---|
  | Speech to text | `saaras:v4`, mode `codemix`, `keyterms` from venue and dish names |
  | Spoken reply | `bulbul:v4-flash` |
  | Translation | `mayura:v1` |
  | Language ID for typed text | `/text-lid` |

  Dead IDs that MUST NOT appear: `saarika:v2.5`, `sarvam-m`, `sarvam-30b`.
- **Flagsmith:**
  - Server SDK `@flagsmith/nodejs` (9.1.0 or newer) with local evaluation and a 15 s refresh. Experiments, exposure and conversion events go through it.
  - Admin writes use the Organisation API key (`Authorization: Api-Key ...`) against `PATCH /api/__future__/environments/{env_key}/features/{feature_id}/`.
  - Never use the old `flagsmith-nodejs` package: it can't send experiment events.
- **NudgeBee Cloud:**
  - Event Webhook for alerts.
  - A workflow with `core.approval`, then the actuator (`integrations.http` straight to Flagsmith, with a `cloud.k8s.cli` fallback that runs `kubectl exec ... node dist/ops-cli.js degrade --level 1`).
  - The agent installed on a local kind cluster (`installation.sh -a <key> -d true`).
- **Runtime:** a kind cluster on the laptop (api 2 replicas, worker 2 replicas, redis), a cloudflared quick tunnel for public HTTPS, and `docker compose up` as the no-Kubernetes path.
- **Optional public mirror:** Vercel (web static) plus the api as one bundled Node function backed by Upstash Redis. On Vercel, a turn is processed inside the request instead of the background worker.
</stack>

<first_45_minutes_spikes>
Before writing features, prove each external contract with a tiny script in `scripts/spikes/` and record the real output in `SPIKES.md`. Build only on what actually worked.

1. Enumerate the installed SDK symbols:
   - `node -e "const s=require('sarvamai');console.log(Object.keys(s))"`
   - the same for `@flagsmith/nodejs`, listing the method names on a Flagsmith instance.
   Use the real method names for experiment exposure and event tracking. If a named feature doesn't exist, substitute the real equivalent and write the substitution down. Never invent a method.
2. Sarvam:
   - one STT call per fixture language (hi, Hinglish, kn, ta), recording how the language code comes back;
   - one chat call with a strict json_schema and reasoning off (content must not be empty);
   - one TTS call each with 2 v4-flash speakers;
   - one mayura translation.
   Record the latencies measured on venue wifi.
3. Flagsmith:
   - read all flags for an identity with traits;
   - check the experiment variant is stable across 10 gids;
   - send one event;
   - flip `ops_degradation_level` 0, 1, 0 via the Admin API and read it back.
4. NudgeBee:
   - post one test event and confirm it in the UI;
   - check the agent pods are Running on kind;
   - run one manual workflow whose only step PATCHes Flagsmith.
5. Tunnel: open the cloudflared URL on a phone and confirm the microphone prompt appears.
</first_45_minutes_spikes>

<features>

### A. Guest app (`/`, mobile first, the screen a relative actually sees)
1. **Household link:** `/?h=<household_code>` pre-fills the family name ("Welcome, Iyer family"). The host generates links and QR codes per household. Anonymous scans still work.
2. **Hold to ask:**
   - one huge thumb-reachable button with live waveform feedback, a 25 s cap with a countdown ring, and haptic feedback on mobile;
   - release to send;
   - while it's thinking, the stages show as a short sequence ("Sun raha hoon... samajh raha hoon... bol raha hoon"), localised to the detected language.
3. **The answer card:**
   - the answer in large type, in the guest's script;
   - the spoken reply plays automatically, with a replay button;
   - the transcript in small grey text;
   - a "Map" chip when the answer names a venue (link from the card);
   - an "Add to calendar" chip (.ics generated in code from card data) when it names a function time.
4. **RSVP capture in the same turn:**
   - a friendly confirmation card ("4 log, Shaadi, 2 Jain. Sahi hai?") with Haan / Badlo buttons;
   - "Badlo" opens a 3-field form fallback;
   - an RSVP is complete only after the guest confirms. Number ranges ("do-teen log") always trigger a confirming follow-up.
5. **Elder mode:** a toggle at the top for extra-large text, slower TTS pace (0.85) and high contrast. Remember it per device.
6. **Text fallback** for when the mic is denied or the guest prefers typing, with the same pipeline and language detected by `/text-lid`.
7. **Announcements banner:**
   - the host's latest announcement, auto-translated to the guest's language with `mayura:v1` and spoken on tap;
   - unread dot.
8. **Status chip:** "Live voice" / "Text replies (very busy)" / "Queued, answer in about a minute", driven by the degradation level. In level 2 the queued message plays from a pre-rendered clip.
9. **No developer internals on this screen:** no persona names, codec names, test buttons, mode toggles or "replay" switches. A footer link "How HaanJi works" opens a plain-language explainer.

### B. Host desk (`/host`, token in a cookie set from `?k=`, desktop and tablet)
1. **Caterer hero line:** "Tell the caterer: Mehendi 84, Sangeet 212, Shaadi 388, Reception 410", with unconfirmed ranges shown separately. A one-click CSV export per function, plus a WhatsApp-ready text block to copy.
2. **Diet matrix** per function (veg, Jain, no onion-garlic, non-veg), needs-room count, and arrivals.
3. **Unanswered questions inbox:**
   - grouped by similarity;
   - "Answer once" adds an FAQ entry to the card in Redis, and the next guest gets it.
   - Show "Answered after adding: N guests". This is the loop that makes the product better during the day.
4. **Announcements:** type in English, preview the 4 translations side by side, send.
5. **Households:** generate links and QR codes, and see who has and hasn't responded, with a "nudge" button that copies a pre-filled WhatsApp message in their language.
6. **Experiment panel:**
   - exposures and completions per voice persona from our own counters;
   - a deep link to the Flagsmith experiment results page;
   - a plain-English honest reading ("Inconclusive at n=38. Here's the traffic a real answer would need").
7. **Live ops strip:** current level, Sarvam rpm and 429s, via a server-side proxy so no token reaches the browser.

### C. Ops console (`/ops`, token-gated, dark theme, the judges' second screen)
1. **Live charts** (2 s polling or SSE from our own server): Sarvam requests per minute by API, 429 percent, queue depth, p95 latency, degradation level, pod count.
2. **"Muhurat morning" button:** starts a synthetic surge as a Kubernetes Job against the in-cluster service. It shows an estimated cost and asks for confirmation.
3. **Incident timeline** with real timestamps: surge started, first 429, alert sent to NudgeBee, investigation done, approval requested, approved by X, Flagsmith flag changed (read back from the Flagsmith API), app at level 1, 429s cleared. The time between each step is shown.
4. **Evidence panel:** pods healthy (CPU, restarts from the Kubernetes API) next to the upstream 429s. Deep link to the NudgeBee investigation.
5. **Approval status** mirrored from NudgeBee. Approval happens in NudgeBee or Slack, never via a button in our app, because the approval gate is NudgeBee's job.
6. **Flagsmith panel:** the live values of every flag in the flag map (read from Flagsmith, not local state), with the last Flagsmith audit entries if the API allows.
7. **"Why not scale?" card:** a measured comparison of 429s at 2 workers against 6 workers under the same surge, from a real recorded run. If the data doesn't support the claim, the card says so.
8. **Fault switches** for the floor demo, each one real:
   - block Flagsmith egress, so the app falls back to defaults and survives;
   - point the NudgeBee webhook at a dead URL, so retries are logged.

### D. Judge mode (`/judge`, public, read-only, built for the 60-second walk-around)
A single screen that tells the whole story:
- a big QR code to try the helpline on your own phone;
- live counters (questions answered, RSVPs, languages heard, guests served during the surge);
- a three-step strip: "Guests ask in their language", "Muhurat surge hits the AI quota", "Agent proposes, human approves, flag sheds load";
- the sponsor map (each sponsor's real job in one line);
- a link to the repo.

It auto-cycles through the live charts when idle. This is the page on the laptop facing the judges.

### E. Flagsmith flag map (exact keys from the contract, plus one)

| Flag | Type | Job |
|---|---|---|
| `exp_voice_persona` | multivariate experiment | `formal` vs `warm`. Exposure on first answer, conversion `rsvp_completed`, guardrail `rsvp_abandoned` |
| `ops_degradation_level` | int 0/1/2 | Written only by the NudgeBee runbook after approval |
| `ops_sarvam_rpm_budget` | int | The worker drain rate, written by the runbook |
| `rel_voice_reply` | boolean plus segment overrides on trait `language` | e.g. Kannada at 50% |
| `cfg_llm` | JSON | `{model, prompt_version, temperature}` |
| `rel_elder_mode_default` | boolean plus segment on trait `age_band` | Turns elder mode on by default for households the host marks as elders |

Synthetic gids start with `load-` and are excluded from every experiment call. Add a README section titled "Delete Flagsmith and this breaks", listing exactly what stops working without each flag.

### F. Sarvam, one model per job (README table)
STT `saaras:v4` codemix with keyterms. Chat `sarvam-105b` with a strict json_schema for `{intent, answer_text, answer_language, rsvp_patch, followup_question, unanswered_question, confidence}`. TTS `bulbul:v4-flash` with persona speakers, at pace 0.85 in elder mode. Translate `mayura:v1` for announcements. Language ID `/text-lid` for typed input. The SDK's own retries are off. Our wrapper retries 429 and 5xx at most twice, records every attempt in metrics, and never retries 402.

### G. NudgeBee loop
- The alerter fires once per incident: a Redis lock so only one api pod alerts, firing then resolved with the same fingerprint, a 120 s healthy hold, and a re-fire every 5 minutes while still bad.
- The workflow JSON is exported from the NudgeBee UI and committed under `nudgebee/` with a placeholder for the Flagsmith key.
- The approval timeout is 30 minutes.
- The restore workflow (level back to 0) is also approval-gated.

</features>

<design_system>
**Mood:** a modern Indian wedding invitation, not a SaaS dashboard. Warm, celebratory, calm.
- **Palette:**
  - ivory `#FBF7F0` background;
  - deep maroon `#6B1E2E` as the primary colour;
  - marigold `#F2A93B` for accents and the record button;
  - antique gold `#C9A96E` for hairlines and dividers;
  - leaf green `#2F6B4F` for success;
  - ink `#1F1A17` for text.
  - The ops console flips to a dark theme: charcoal `#14110F`, marigold for data, maroon for alerts.
- **Type:** Fraunces for headings and the caterer line, Plus Jakarta Sans for UI, Noto Sans Devanagari, Kannada and Tamil for Indic scripts (check that every script renders), JetBrains Mono for ops numbers only.
- **Motion:**
  - a soft marigold pulse on the record button;
  - a waveform while recording;
  - answer cards rise in at 180 ms;
  - number tickers on counters;
  - nothing longer than 300 ms;
  - respect `prefers-reduced-motion`.
- **Texture:** a very faint rangoli line pattern in the guest header only (an inline SVG under 4 KB). No stock photos.
- **Mobile:**
  - a 375 px base;
  - the record button is at least 88 px and sits in the thumb zone;
  - every tap target is at least 44 px;
  - Lighthouse mobile performance 90+ and accessibility 95+;
  - contrast AA everywhere, AAA in elder mode.
- **Copy:** warm Hinglish by default on the guest side, plain English on host and ops. Microcopy is short and kind ("Koi baat nahi, dobara boliye").
- **States:** design every one, including loading, empty, error, offline and permission denied. Never show a raw error string to a guest.
</design_system>

<architecture_and_quality>
- **One turn pipeline**, implemented once in `apps/api/src/turn/`, used by both the worker (kind) and the inline path (Vercel).
- **Shared zod schemas** for every API payload. The web and api apps import the same types.
- **Prometheus metrics**, named exactly as in the contract, served at `/metrics` and scraped by kube-prometheus-stack through a ServiceMonitor.
- **Tests** (see `06-award-test-prompt.md`): vitest units, a live golden set of 30 cases (labels in `prep/notes/golden-set-draft.yaml`), Playwright e2e with fake mic audio, and the surge loop script.
- **Fresh-clone proof:** `rm -rf node_modules && npm ci && npm run build && npm test` must pass, run for real, before submit. Pin compatible versions (esbuild must satisfy Vite's peer range).
- **README** for a judge who reads for 90 seconds:
  - a one-line problem statement and a 20-second GIF;
  - the live link and the judge-mode link;
  - the sponsor table, the flag map, and "Delete Flagsmith and this breaks";
  - architecture in prose plus a mermaid diagram;
  - the "Reproduce the incident" commands;
  - measured numbers (latency, golden-set metrics from live runs, loop timings, scale-out comparison);
  - honest competitors (Weddingkart, Dawat) and what isn't shipped;
  - the AI disclosure.
</architecture_and_quality>

<priorities>
Work in this order and cut from the bottom when behind.
- **MUST:**
  - all spikes;
  - the guest voice turn with grounding and RSVP confirmation;
  - the caterer line;
  - flags read from Flagsmith with defaults;
  - the experiment exposure and conversion;
  - metrics, limiter and alerter;
  - the NudgeBee approval workflow writing Flagsmith;
  - the level 1 and 2 behaviours;
  - kind deploy plus the tunnel;
  - judge mode;
  - the README core;
  - fresh-clone proof.
- **SHOULD:** the unanswered inbox with "answer once", announcements via mayura, the ops timeline and evidence panel, elder mode, the restore workflow, household links and QR codes, the "why not scale" measurement.
- **COULD:** CSV and WhatsApp exports, the add-to-calendar chip, fault switches, the Vercel mirror on Upstash, `rel_elder_mode_default`.
</priorities>

<checkpoints_and_stop_conditions>
- **Stop and report, with the output pasted, at:**
  - T0+45m (spikes);
  - T0+2h30m (one real voice turn from a phone through the tunnel);
  - T0+4h (the full surge loop: surge, real 429s, NudgeBee event, human approval, Flagsmith write, level 1, 429s down at least 80%, with the flag unchanged while approval is pending);
  - T0+5h30m (feature freeze).
- **If the loop isn't closed at T0+4h,** stop all SHOULD and COULD work and fix only the loop.
- **Ask the human before you:**
  - add a paid service;
  - delete files outside the repo;
  - change any flag key or metric name from the contract;
  - make the repo public.
- **Never** commit `.env`, push to someone else's repo, or claim a feature works without having run it.
</checkpoints_and_stop_conditions>

<output_format>
At each checkpoint, write `CHECKPOINT-<name>.md` with:
- what now works, with the exact command and its real output;
- what doesn't, and why;
- the measured numbers;
- the next 3 steps.

End of day: `SUBMISSION.md` containing:
- the repo URL, live URL and judge URL;
- the video shot list using the real numbers;
- every submission-form field's value;
- the final secret-scan output;
- the fresh-clone run output.
</output_format>
