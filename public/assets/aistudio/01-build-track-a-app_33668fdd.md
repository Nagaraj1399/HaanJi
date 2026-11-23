# Track A build prompt: HaanJi app and Sarvam pipeline

You are a coding agent building Track A of HaanJi at a one-day hackathon. Read `00-shared-contract.md` in full first. It overrides anything here. Track B (ops, flags admin, Kubernetes, NudgeBee) is being built in parallel by another agent, so stay inside the files the contract assigns to Track A.

Work in small verified steps. After each step, run the step's check and paste the real output. Never report a feature as working without having run it. If a Sarvam or Flagsmith call does not behave as described here, stop, write what you observed in `SPIKES.md`, and adapt. The docs notes below were gathered on 23 Nov 2026 and some details are marked as unconfirmed.

## 1. What you own

- `app/main.py`, `config.py`, `flags.py`, `sarvam_client.py`, `brain.py`, `store.py`, `routes_guest.py`, `routes_host.py`, `worker.py`.
- `app/static/` (the guest page, host dashboard and pre-rendered audio).
- `data/wedding.yaml` and `fixtures/audio/`.
- `tests/a_*`.
- The product half of `README.md`.

## 2. Verified API facts you must use (do not use older IDs from blog posts)

**Sarvam (base `https://api.sarvam.ai`, header `api-subscription-key`, a bad key returns 403):**

- STT: `client.speech_to_text.transcribe(file=..., model="saaras:v4", mode="codemix")`.
  - REST accepts WebM/Opus, WAV and others.
  - **Max 30 s of audio**, so cap recordings at 25 s in the browser.
  - The response has `transcript` and should include `language_code`. How auto-detection is requested on REST is unconfirmed (spike S1).
- Chat: the OpenAI client with `base_url="https://api.sarvam.ai/v2"`, `model="sarvam-105b"`, plus `response_format={"type":"json_schema","json_schema":{...,"strict":true}}`.
  - Reasoning is on by default. Disable it (`reasoning_effort=None`, passed via `extra_body` if the client rejects it) or it eats `max_tokens` and returns empty content with `finish_reason="length"`.
- TTS: `client.text_to_speech.convert(text=..., target_language_code or language_code=..., model="bulbul:v4-flash", speaker=...)`.
  - Returns base64 in `audios[]`.
  - Only 11 languages: `hi-IN, en-IN, bn-IN, gu-IN, kn-IN, mr-IN, pa-IN, ta-IN, te-IN, ml-IN, od-IN`.
  - v4 Flash speakers look like `simran_en_customer` or `shubh_enhi_ads` and are case-sensitive.
  - v3 speakers (`priya`, `mani`, `ishita`, `varun`) only work with `model="bulbul:v3"`. Mixing them returns 400.
- Translate (Should tier): `client.text.translate(input=..., source_language_code="auto", target_language_code="ta-IN", model="mayura:v1", mode="modern-colloquial")`.
- Limits: 60 req/min per account across keys. Errors are 429 (rate) and 402 (out of credit, do not retry).
- Old IDs that will fail: `saarika:v2.5`, `sarvam-m`, `sarvam-30b`, `/speech-to-text-translate`.

**Flagsmith (pip `flagsmith` 6.6.0 or newer):**

```python
Flagsmith(environment_key=FLAGSMITH_SERVER_KEY, enable_local_evaluation=True,
          environment_refresh_interval_seconds=15, enable_events=True,
          default_flag_handler=<returns contract defaults>)
flags = fs.get_identity_flags(gid, traits={"language": "hi", "wedding_id": "w_demo"})
exp = fs.get_experiment_flag("exp_voice_persona", identifier=gid, traits={...})   # records exposure
fs.track_event("rsvp_completed", identifier=gid)                                  # same gid as exposure
```

JSON values are strings, so `json.loads(...)` them. Wrap all Flagsmith access in `app/flags.py` with typed getters (`persona(gid, traits)`, `degradation_level()`, `rpm_budget()`, `voice_reply_enabled(gid, traits)`, `llm_config()`). Never call the SDK from anywhere else.

## 3. Behaviour spec

### 3.1 Guest page `/` (mobile first, works one-handed)

1. On first load, create `gid` (UUID v4) and save it in the cookie and localStorage. Reuse it forever. Show the wedding name, date and a big "Hold to ask" button with the hint "Hindi, English, ಕನ್ನಡ, தமிழ், any language".
2. Recording uses `MediaRecorder` (WebM/Opus). There is a visible 25 s countdown and it auto-stops at 25 s.
3. Upload goes to `POST /api/turn` as multipart (audio, gid). The response is `{job_id}`. The page polls `GET /api/turn/{job_id}` every 700 ms for up to 45 s.
4. The result shows the transcript (small, grey), the answer text (large), and plays the audio if present. When the RSVP is partly filled, a compact card shows what HaanJi understood ("4 log, Sangeet + Shaadi, 2 Jain") with an "Edit" link that opens a plain form fallback.
5. A status chip shows "Live voice", "Text mode (busy)" or "Queued (very busy)" from the `level` field in every API response.
6. Text input is a fallback for guests who can't or won't speak. It uses the same endpoint with `text` instead of `audio`.

### 3.2 Worker turn pipeline (`worker.py`, async, N concurrent jobs per pod, N=4)

```
pop job -> read level, budget, persona, voice_reply, cfg_llm from flags.py
level 2 at enqueue time -> API already answered "queued"; worker drains it at budget rate
await acquire_sarvam_slot("stt")  -> STT (saaras:v4, codemix) -> transcript, language
await acquire_sarvam_slot("chat") -> brain.run(transcript, language, wedding card, guest's current RSVP, persona)
   -> {intent, answer_text, answer_language, rsvp_patch, rsvp_complete, followup_question, unanswered_question, confidence}
apply rsvp_patch to store (Python merge, validated by pydantic)
if rsvp became complete for the first time: fs.track_event("rsvp_completed", gid); metrics counter
if level == 0 and voice_reply_enabled and language in TTS_LANGS:
    await acquire_sarvam_slot("tts") -> bulbul:v4-flash with the persona's speaker -> audio
write result; metrics turns_total{level, outcome}
```

Every Sarvam call goes through `sarvam_client.py`, which:

- times the call and calls `metrics.observe_sarvam(api, status, seconds)` for every attempt;
- retries 429 and 5xx at most 2 times, with jittered backoff of 0.5 s then 1.5 s;
- never retries 402 or 4xx;
- raises a typed `SarvamQuotaError` on a final 429, so the worker can answer "busy, try again" instead of crashing.

Do not let the SDK's own retry loop hide 429s from the metrics. Set the SDK's `max_retries=0` and retry yourself.

### 3.3 Brain (`brain.py`), the only place the prompt lives

- The system prompt carries the info card (rendered compactly from YAML), the guest's current RSVP JSON, the persona style and the rules:
  - answer only from the card;
  - reply in the guest's language and script (Hinglish stays Hinglish);
  - keep it to 2 sentences or fewer;
  - ask at most one follow-up, only when the RSVP is missing headcount or functions;
  - number words such as "dhai sau", "do-teen log" or "char-paanch" become a range, which triggers a confirming follow-up and is never a guess.
- The strict JSON schema has `rsvp_patch` fields `{attending: bool|null, headcount: int|null, headcount_range: [int,int]|null, functions: [enum of card function ids]|null, diet: {veg:int, jain:int, nonveg:int, no_onion_garlic:int}|null, arrival: str|null, needs_room: bool|null}`.
- **Grounding check in Python, after the LLM:** every time and venue string in `answer_text` must appear in the card. Normalise digits and the am/pm forms. If it doesn't, replace the answer with the safe phrase in the guest's language, set `unanswered_question`, and log `grounding_violation`. This is non-negotiable #1 in the contract.
- Personas (the experiment arms) come from a dict keyed by `formal` and `warm`, each with `{speaker_v4, style_instruction}`:
  - `formal` is respectful, uses "aap", and is complete sentences;
  - `warm` is family-style Hinglish, short and friendly ("Arre aap toh aa hi rahe ho na!").
  - Speaker IDs are confirmed in spike S3.

### 3.4 Host dashboard `/host?k=<HOST_KEY>`

The host key is a random value printed at startup, not a real auth system; say so in the README.

- **Caterer line:** "Tell the caterer: Mehendi 84, Sangeet 212, Shaadi 388, Reception 410." Computed by summing confirmed headcounts. Ranges show separately as "+ 12 to 20 unconfirmed".
- Diet table per function, and a needs-room count.
- **Unanswered questions** list, newest first, with an "Add to card" button that appends an FAQ entry to `wedding.yaml` in Redis. The next guest gets the answer. This is the loop that makes the product improve during the day.
- **Experiment panel:** exposures and completions per persona from our own Redis counters, plus a link to the Flagsmith results page. State plainly that Flagsmith's Bayesian result is the source of truth.
- Live ops chip (level, rpm last 60 s, 429s last 60 s) from B's `/ops/state` through a server-side proxy route, so the ops token never reaches the browser.
- Auto-refreshes every 3 s.

### 3.5 Info card (`data/wedding.yaml`), fictional and clearly labelled demo data

The Sharma and Reddy families, a Bengaluru wedding, 4 functions with times and venues (one venue has a Google Maps link), the menu with Jain and no-onion-garlic marked, the dress code per function, parking, contact roles (no real phone numbers), and 8 FAQ entries. Include Kannada and Tamil names for the venues so the multilingual answer is visible.

### 3.6 Pre-rendered audio (generated at T0+30m by a script, committed)

`scripts/prerender.py` renders, per persona, the greeting, the busy message and the queued message in `hi`, `en`, `kn` and `ta` to `app/static/audio/`. This means level 1 and level 2 still have a voice without spending Sarvam calls during the surge. Running it costs a few rupees once.

## 4. Must, Should, Could (cut from the bottom when behind, no exceptions)

| Tier   | Item                                                                                                                                                                                                                                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Must   | 3.1 steps 1 to 5, the 3.2 pipeline with metrics and the slot hook, brain with schema and grounding check, flags.py with defaults, caterer line, unanswered list, experiment exposure and conversion wired, prerendered busy and queued clips |
| Must   | `docker compose up` brings up redis, api and worker locally with only `.env` filled                                                                                                                                                          |
| Should | Text fallback input, "Add to card" loop, experiment panel, Tamil and Kannada end-to-end verified on a real phone                                                                                                                             |
| Should | Host announcement: the host types English, `mayura:v1` produces each guest language, and it shows on guest pages at their next poll                                                                                                          |
| Could  | Edit-RSVP form, needs-room count, keyterms biasing (`keyterms=[venue and dish names]` on saaras:v4)                                                                                                                                          |

## 5. Spikes, first 45 minutes after T0 (write results to `SPIKES.md`)

- **S1 STT:** transcribe 4 fixture clips (Hindi, Hinglish, Kannada, Tamil). Record how the language code comes back and how to ask for auto-detect on REST. Time each call from the venue wifi.
- **S2 Chat:** one `sarvam-105b` call through the OpenAI client at `/v2`, with the strict json_schema and reasoning disabled. Confirm the content is not empty and the JSON validates. If json_schema is rejected, fall back to `{"type":"json_object"}` plus pydantic validation and one repair retry.
- **S3 TTS:** list or confirm 2 v4-flash speaker IDs per persona (one female, one male) for hi, kn and ta. If v4 IDs can't be confirmed quickly, use `bulbul:v3` with `priya` and `mani` and note it.
- **S4 Flagsmith:** `get_experiment_flag` returns a variant for 10 fake gids, with a roughly even split and stable per gid. `track_event` works. Changing `ops_degradation_level` in the dashboard shows in `flags.degradation_level()` within 20 s. If the Python SDK exposes a method to force an environment refresh, note it for Track B.

## 6. Order of work

1. T0 to T0+15m: skeleton (`main.py` with `/healthz`, settings, the B stub imports `from app.ops import metrics` behind try/except stubs), redis in compose. Check: `curl /healthz`.
2. T0+15m to T0+1h: spikes S1 to S4.
3. T0+1h to T0+2h15m: `sarvam_client`, `brain`, `store`, the worker pipeline, `/api/turn`. Check: `pytest tests/a_unit -q` plus one live turn from a fixture clip via curl.
4. T0+2h15m to T0+3h: guest page with recording, polling and the status chip. Check on a real phone via B's tunnel.
5. T0+3h to T0+3h45m: host dashboard, unanswered list, prerender script.
6. T0+3h45m to T0+4h: experiment wiring checks: both arms get exposures, the same gid for exposure and event, a conversion recorded.
7. Then Should items, in table order, until the freeze.
8. At T0+5h: the README product half (problem, persona, flow GIF or screenshots, Sarvam one-model-one-job table, flag map from the contract, honest competitors Weddingkart and Dawat, what's not shipped, AI disclosure).

## 7. Acceptance criteria for Track A

- [ ] A Hinglish voice question about the sangeet time is answered correctly and aloud in about 6 s or less on venue wifi. Measure and report the real number.
- [ ] A question the card can't answer yields the safe phrase plus an entry in the unanswered list. No invented fact passes the grounding check.
- [ ] "Hum 4 log aayenge, 2 Jain, sirf shaadi" produces `headcount=4, functions=[shaadi], diet.jain=2`, and the caterer line moves by exactly 4.
- [ ] With `ops_degradation_level=1`, no TTS request leaves the worker (the metric stays flat) and guests get text plus the prerendered chip.
- [ ] With level 2, `/api/turn` returns "queued" in under 300 ms and the job finishes later at the budget rate.
- [ ] Killing Flagsmith access (wrong key) leaves the app answering at level 0 with persona `formal`.
- [ ] `docker compose up` from a fresh clone works with only `.env` filled.
- [ ] No key in the browser bundle, the repo or the logs. Check with `grep -rE "sk_|ser\.|api-subscription-key" app/static` (must be empty).
