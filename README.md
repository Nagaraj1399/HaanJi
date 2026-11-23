# HaanJi — Multilingual Wedding Voice Concierge, Ops Control Plane & Verification Workbench

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x%20%2F%207.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Express](https://img.shields.io/badge/Express-4.21-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Verification](https://img.shields.io/badge/Tests-All%20Suites%20Passing-15803D)](#verified-test-proof)

**HaanJi** is a full-stack multilingual wedding concierge, deterministic RSVP/catering ledger, human-in-the-loop degradation control plane, and automated verification suite built for the **Sharma & Reddy Wedding (Bengaluru)**.

It solves two real-world problems in one unified application:
1. **Product (Track A):** Guests speak or type in Hindi, Hinglish, Kannada (`ಕನ್ನಡ`), Tamil (`தமிழ்`), or Indian English. Every answer is strictly grounded to the verified wedding card (`data/wedding.yaml`) by a deterministic post-LLM guard, while headcounts and dietary totals are computed by pure arithmetic—never by an LLM.
2. **Operations & Reliability (Track B):** During a "Muhurat morning" traffic surge, upstream AI rate limits (`429`) spike even while application containers have low CPU and zero restarts. **Scaling out workers makes the outage worse** by multiplying upstream request rate. HaanJi's alerter opens an evidence-backed investigation and waits for **explicit human approval** before degrading from Level 0 (Live Voice) to Level 1 (Text Mode, shedding TTS calls by ~33%).

---

## Table of Contents

- [System Architecture Diagram](#system-architecture-diagram)
- [End-to-End Guest Turn & Grounding Flow](#end-to-end-guest-turn--grounding-flow)
- [Causal Incident Loop & Safety Sequence](#causal-incident-loop--safety-sequence)
- [Project Full Structure](#project-full-structure)
- [Workspaces & Core Features](#workspaces--core-features)
- [Feature Flag & Degradation Matrix](#feature-flag--degradation-matrix)
- [API Reference](#api-reference)
- [Verified Test Proof](#verified-test-proof)
- [Quick Start & GitHub Setup](#quick-start--github-setup)
- [Security & Demo Disclosure](#security--demo-disclosure)

---

## System Architecture Diagram

```mermaid
flowchart TB
    subgraph Browser["Browser Client (React 19 + Vite + Tailwind CSS v4)"]
        GC["Guest Concierge<br/>(MediaRecorder 25s cap, Text fallback, RSVP Edit)"]
        HD["Host Desk<br/>(Caterer Totals, Add-to-Card FAQ, A/B Panel)"]
        OC["Ops Control Plane<br/>(Live Charts, Surge Launcher, Approval Gate)"]
        TW["Test Workbench<br/>(Unit, 30-Case Golden Set, Causal Loop, Sec Scan)"]
    end

    subgraph Server["Express Full-Stack Server (server.ts · Port 3000)"]
        API["REST & Auth Boundary<br/>(/api/turn, /api/host/* 403, /ops/* 401 timingSafeEqual)"]
        WRK["Turn Worker Pipeline (server/worker.ts)<br/>Audio 413 Guard · Level 0/1/2 Routing · Async Drain"]
        BRN["Concierge Brain & Grounding Guard (server/brain.ts)<br/>Structured JSON + postCheck() Time/Venue Verifier"]
        STR["Deterministic Wedding Store (server/store.ts)<br/>Pure Arithmetic Caterer Sums · Unanswered Queue"]
        FLG["Flags & Experiment Engine (server/flags.ts)<br/>FNV-1a 50/50 Split · load- Exclusion · Audit Log"]
        LIM["Sliding-Window Limiter (server/limiter.ts)<br/>60s Window · Hard Cap 55 RPM · 2x Retry 429 / 0x 402"]
        ALR["Alerter & Approval Engine (server/alerter.ts)<br/>ok <-> firing · 120s Hold · 5m Re-fire · Leader Lease"]
        MET["Prometheus Metrics Registry (server/metrics.ts)<br/>1s Buckets · /ops/metrics Exposition"]
    end

    subgraph Upstream["External & Data Layer"]
        GAI["@google/genai SDK (Server-Side Only)<br/>gemini-3.5-transcribe · gemini-4-hydrogen · gemini-3.8-flash-lite-tts"]
        YML["Wedding Info Cards<br/>data/wedding.yaml & data/wedding.test.yaml"]
    end

    GC & HD & OC & TW --> API
    API --> WRK
    API --> STR
    API --> FLG
    API --> ALR
    API --> MET

    WRK --> LIM
    WRK --> BRN
    WRK --> STR
    WRK --> FLG
    BRN --> GAI
    LIM --> MET
    ALR --> MET
    ALR --> FLG
    STR --> YML
```

---

## End-to-End Guest Turn & Grounding Flow

Every guest voice or text message passes through strict pre-flight validation, rate-limit slot acquisition, post-LLM grounding verification, and deterministic RSVP merging:

```mermaid
flowchart LR
    IN["Guest Input<br/>(WebM/Opus Audio ≤ 25s or Text)"] --> GUARD413{"Size ≤ 2 MB &<br/>Duration ≤ 30s?"}
    GUARD413 -- "No" --> E413["HTTP 413 Rejected<br/>(0 Upstream Calls)"]
    GUARD413 -- "Yes" --> LVL{"Degradation<br/>Level?"}

    LVL -- "Level 2 (Very Busy)" --> QUEUED["Return 'queued' < 50ms<br/>+ Prerendered Clip<br/>Drain Async at Budget"]
    LVL -- "Level 0 or 1" --> STT["Stage 1: STT<br/>(acquireSlot + gemini-3.5-transcribe)"]
    QUEUED --> STT

    STT --> CHAT["Stage 2: Brain NLU<br/>(acquireSlot + gemini-4-hydrogen JSON Schema)"]
    CHAT --> POSTCHECK{"postCheck() Grounding Guard<br/>All times & venues in wedding.yaml?"}

    POSTCHECK -- "Violation Detected" --> SAFE["Replace w/ Safe Phrase<br/>Log grounding_violation<br/>Push to Host Unanswered Queue"]
    POSTCHECK -- "Grounded" --> MERGE["Deterministic RSVP Merge<br/>(validateRsvpPatch + mergeRsvp)"]

    SAFE --> MERGE
    MERGE --> CONV{"First Time<br/>RSVP Complete?"}
    CONV -- "Yes & not load-*" --> TRACK["Record 1x rsvp_completed<br/>(Same gid as Exposure)"]
    CONV -- "No" --> TTSGATE

    TRACK --> TTSGATE{"Level == 0 AND<br/>voice_reply ON AND<br/>Supported Lang?"}
    TTSGATE -- "Yes" --> TTS["Stage 3: TTS<br/>(acquireSlot + gemini-3.8-flash-lite-tts WAV)"]
    TTSGATE -- "No (Level 1 / Off)" --> TEXTONLY["Return Text Answer<br/>(0 Live TTS Calls)"]
    TTS --> DONE["Return Transcript, Answer, Audio & RSVP Card"]
    TEXTONLY --> DONE
```

---

## Causal Incident Loop & Safety Sequence

HaanJi enforces a strict **human-in-the-loop safety invariant**: upstream quota exhaustion never triggers automatic degradation or blind worker scaling. Nothing mutates feature flags until a human operator inspects the cluster evidence and approves remediation.

```mermaid
sequenceDiagram
    autonumber
    participant Surge as Surge Generator (/ops/surge)
    participant Limiter as Limiter & Metrics (60 RPM Cap)
    participant Alerter as Alerter State Machine
    participant Flagsmith as Flags & Audit Log
    participant Human as On-Call Human Operator

    Note over Limiter,Flagsmith: T_start: Baseline Level 0 (Live Voice), Budget 40 RPM, 0 Firing Alerts
    Surge->>Limiter: Replay 100 turns/min (3 calls/turn = ~300 RPM)
    Limiter-->>Surge: Upstream 429 Quota Errors climb (> 10%)
    Alerter->>Limiter: Poll 60s rolling buckets
    Alerter->>Alerter: Transition ok -> firing (Contract 7.5 Event)
    Alerter->>Human: Open Investigation + Pending Approval (30m timeout)<br/>Evidence: Pods 2/2 Running, CPU 14%, 0 Restarts.<br/>"Do NOT scale haanji-worker."

    rect rgb(254, 243, 199)
        Note over Flagsmith,Human: SAFETY INVARIANT CHECK (3x polls while awaiting_approval)
        Human->>Flagsmith: Read ops_degradation_level
        Flagsmith-->>Human: Level === 0 (Unchanged before approval)
    end

    Human->>Alerter: Approve Remediation (Level 1, Budget 40 RPM)
    Alerter->>Flagsmith: adminSetDegradation(1, 40, "nudgebee:approver")
    Note over Limiter,Flagsmith: TTS Shed -> 0 TTS Calls, 429 Errors drop >= 80% (100% measured)

    Alerter->>Limiter: Observe 120s healthy window (0% 429s)
    Alerter->>Alerter: Transition firing -> resolved (matching fingerprint)
    Alerter->>Human: Open Restore Approval Request
    Human->>Alerter: Approve Restore (Level 0)
    Alerter->>Flagsmith: adminSetDegradation(0, 40, "nudgebee:approver")
```

---

## Project Full Structure

```text
haanji/
├── .env.example                       # Environment template (GEMINI_API_KEY, APP_URL)
├── .gitignore                         # Ignores node_modules, dist, .env*, logs
├── README.md                          # Project documentation, diagrams, and test proof
├── index.html                         # HTML entry with Fraunces, Plus Jakarta Sans & JetBrains Mono
├── metadata.json                      # App identity, mic permissions & server Gemini capability
├── package.json                       # Scripts (dev, build, start, lint, test) & dependencies
├── tsconfig.json                      # TypeScript configuration
├── vite.config.ts                     # Vite + Tailwind v4 + static asset bundle plugin
├── server.ts                          # Express + Vite full-stack entrypoint (Port 3000)
│
├── data/
│   ├── wedding.yaml                   # Live demo wedding card (Sharma & Reddy, 4 functions, 8 FAQs)
│   └── wedding.test.yaml              # Frozen wedding card snapshot for Golden Set regression
│
├── server/                            # Backend modules (TypeScript)
│   ├── types.ts                       # Shared domain types (RSVP, BrainResult, OpsState, Tests)
│   ├── config.ts                      # Card YAML loader, safe multilingual phrases, persona config
│   ├── flags.ts                       # Flagsmith-contract client, FNV-1a 50/50 split, audit log
│   ├── limiter.ts                     # Sliding-window RPM limiter & custom 429/5xx retry wrapper
│   ├── metrics.ts                     # Prometheus counter/gauge registry & 60s rolling buckets
│   ├── store.ts                       # Deterministic RSVP validation, merge & caterer summation
│   ├── brain.ts                       # Gemini STT/Chat/TTS + postCheck() grounding guard + replay
│   ├── worker.ts                      # Async turn queue, audio size/duration guard, L0/L1/L2 pipeline
│   ├── alerter.ts                     # ok<->firing state machine, 120s hold, 5m re-fire, approvals
│   ├── routes_ops.ts                  # /ops/* routes (timingSafeEqual auth), surge controller, /metrics
│   ├── run-tests.ts                   # CLI entrypoint for `npm test`
│   └── tests/
│       ├── golden_cases.ts            # 30 labelled multilingual evaluation cases
│       └── runner.ts                  # Executable Track A/B unit, golden, causal loop & security suites
│
├── src/                               # Frontend SPA (React 19 + Tailwind CSS v4)
│   ├── main.tsx                       # React root mount
│   ├── index.css                      # Tailwind v4 theme tokens & tabular-numeral typography
│   ├── App.tsx                        # 3-zone top bar shell & workspace switcher
│   ├── assets/
│   │   └── images/
│   │       └── sharma_reddy_venue_1795418307752.jpg  # Bespoke heritage pavilion illustration
│   └── components/
│       ├── GuestConcierge.tsx         # Hold-to-ask mic (25s cap), text fallback, RSVP edit card
│       ├── HostDashboard.tsx          # Caterer line, diet table, Add-to-Card FAQ loop, A/B stats
│       ├── OpsControlPlane.tsx        # Live charts, Muhurat surge, HITL approval gate, audit log
│       ├── TestWorkbench.tsx          # Interactive 5-suite test runner & REPORT.md exporter
│       └── WeddingCardDrawer.tsx      # Slide-over official wedding card reference drawer
│
└── public/
    └── assets/aistudio/               # Original Track A & Track B build/test specifications
```

---

## Workspaces & Core Features

| Workspace | Route / Tab | Key Capabilities |
| :--- | :--- | :--- |
| **Guest Concierge** | `Guest Concierge` | Hold-to-ask WebM/Opus recording (25 s auto-stop), text fallback, `Live AI` vs `Replay Engine` switch, grounded answer + grounding status, spoken WAV playback, persistent `haanji_gid`, and inline RSVP editor. |
| **Host Desk** | `Host Desk` | `HOST_KEY`-protected view (`haanji-host-demo-2026`), auto-refreshes every 3 s. Shows deterministic caterer totals (`Mehendi`, `Sangeet`, `Shaadi`, `Reception`), diet breakdown, unconfirmed ranges, unanswered questions **Add to card** loop, `exp_voice_persona` metrics, and multilingual announcements. |
| **Ops Control** | `Ops Control` | Real-time RPM, 429%, and TTS SVG charts; **Muhurat Morning Surge** launcher (`100 turns/min`); Alerter investigation evidence; **Approve / Reject** human-in-the-loop gate; Flagsmith level/budget/voice-toggle/outage simulator; `/ops/metrics` viewer; and audit log. |
| **Test Bench** | `Test Bench` | One-click runner for all 5 verification suites (`Track A Unit`, `30-Case Golden Set`, `Track B Ops Unit`, `Causal Incident Loop + Scale-Out Proof`, `API & Secret-Leak Scan`) with downloadable `HAANJI-TEST-REPORT.md`. |

---

## Feature Flag & Degradation Matrix

| Flag Key | Default | Range / Arms | Operational Behavior |
| :--- | :--- | :--- | :--- |
| `ops_degradation_level` | `0` | `0` / `1` / `2` | **L0:** STT + Chat + TTS (`Live voice`). **L1:** STT + Chat, `0` live TTS calls (`Text mode (busy)`). **L2:** Immediate `queued` return (`< 50ms`), drained asynchronously at budget rate. |
| `sarvam_rpm_budget` | `40` | `5 – 55` | Dynamically enforced by `SlidingWindowLimiter`, clamped to `SARVAM_RPM_HARD_CAP = 55`. |
| `exp_voice_persona` | `formal` | `formal` / `warm` | Deterministic FNV-1a 50/50 split per `gid`. `load-*` synthetic gids are excluded from exposure & conversion tracking. |
| `rel_voice_reply` | `true` (all) | `hi-IN`, `en-IN`, `kn-IN`, `ta-IN` | Per-language toggle to shed TTS selectively by language at Level 0. |
| *Outage Fallback* | `level=0, formal` | Automatic | When Flagsmith is unreachable, all getters revert safely to contract defaults. |

---

## API Reference

| Method & Path | Auth | Purpose |
| :--- | :--- | :--- |
| `GET /healthz` | Public | Liveness/readiness check returning service status & active degradation level. |
| `GET /api/card?gid=...` | Public | Returns wedding card, guest RSVP, persona arm, level, and host announcements. |
| `POST /api/turn` | Public | Enqueues voice/text turn (`413` if `> 2 MB` or `> 30 s`); returns `{ job_id, level, status }`. |
| `GET /api/turn/:jobId` | Public | Polls job status (`pending` / `queued` / `done` / `error`) and final grounded result. |
| `GET/POST /api/rsvp/:gid` | Public | Reads or manually updates a guest's RSVP record with schema validation. |
| `GET /api/host/state` | `?k=<HOST_KEY>` (`403`) | Returns deterministic caterer summary, unanswered queue, experiment stats, and sanitized ops chip. |
| `POST /api/host/add-to-card` | `?k=<HOST_KEY>` (`403`) | Resolves an unanswered question and appends the FAQ live to the wedding card. |
| `POST /api/host/announcement` | `?k=<HOST_KEY>` (`403`) | Translates an English host announcement into `en`, `hi`, `kn`, and `ta` via Gemini. |
| `GET /ops/metrics` | Public | Prometheus text format metrics (`haanji_sarvam_requests_total`, `haanji_turns_total`, etc.). |
| `GET /ops/state` | `X-Ops-Token` (`401`) | Constant-time (`timingSafeEqual`) authenticated telemetry, alerter, and workflow state. |
| `POST /ops/surge` | `X-Ops-Token` (`401`) | Starts synthetic load surge (`409` if already running). |
| `POST /ops/approve` / `reject` | `X-Ops-Token` (`401`) | Human approval/rejection endpoint gating degradation flag writes. |
| `POST /api/tests/*` | Local Workbench | Executes Track A unit, 30-case Golden Set, Track B ops unit, causal loop, and API security suites. |

---

## Verified Test Proof

All checks below were executed directly against the running codebase (`npm test`, `npm run lint`, `npm run build`, and live Express HTTP checks):

| Suite | Result | Key Measured Assertions |
| :--- | :--- | :--- |
| **Track A Unit (`A-U1` – `A-U9`)** | **9 / 9 PASS** | Schema warning on `diet > headcount`; field merge & range exclusion; 50-row caterer sum + static import check (`store.ts` never imports `brain` or `genai`); grounding guard rejected `8 PM` and passed `7:30 PM`, `7.30 pm`, `शाम 7:30`; 1,000-gid split `500/500`; `429` retried `2x` (`3` attempts) vs `402` fail-fast (`1` attempt); L0/L1/L2 worker gating; single-fire `rsvp_completed`; `413` audio guard. |
| **Golden Set (30 Cases, Replay)** | **30 / 30 PASS** | Intent Accuracy: **100%** · RSVP Field Accuracy: **100%** · Grounding Precision: **100%** (Gate: 100%) · Unanswered Recall: **6/6** (Gate: ≥ 5/6) · Injection Resistance: **4/4** (Gate: 4/4) · Language Match: **100%** (Gate: ≥ 90%). |
| **Track B Ops Unit (`B-U1` – `B-U6`)** | **6 / 6 PASS** | Limiter granted `10/50` at budget `10`, clamped `500 → 55`, timed out at `20s`; Alerter verified `firing`, 4m silence, 5m re-fire, flap suppression, `119s` hold, `121s` `resolved` with matching fingerprint; 30s single-leader failover; admin bounds validation; `crypto.timingSafeEqual` check; Prometheus exposition format. |
| **Causal Incident Loop & Thesis** | **PASS** | Safety invariant held (`level === 0` across 3 checks while awaiting approval); `429` count dropped **100%** (`42 → 0`) with **0 TTS calls** after Level 1 approval; rejected & 30m-timed-out workflows kept `level === 0`; Scale-out proof measured **156 429s/min at 6 workers vs 12 429s/min at 2 workers** (+1200% worse). |
| **Live API & Security Scan** | **4 / 4 PASS** | `POST /api/turn` responded in **45.7 ms** (`< 300 ms`); `/api/host/state` returned `403` without key and `200` with key (zero `OPS_TOKEN` leakage); `/ops/state` enforced `401` without `X-Ops-Token`; `0` secret leaks across 4 endpoints and 12 client files. |

---

## Quick Start & GitHub Setup

### 1. Local Development

```bash
# 1. Clone the repository
git clone https://github.com/<your-username>/haanji.git
cd haanji

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Set GEMINI_API_KEY in .env for live AI calls (Replay Mode & Test Suites work out of the box)

# 4. Start the full-stack server (Express + Vite on Port 3000)
npm run dev
```

Open `http://localhost:3000` to access **Guest Concierge**, **Host Desk**, **Ops Control**, and **Test Bench**.

### 2. Run Verification & Build

```bash
# Run full Track A & Track B verification suites
npm test

# Type-check TypeScript across client & server
npm run lint

# Build production bundle
npm run build
```

### 3. Push to GitHub

```bash
git init
git add .
git commit -m "feat: HaanJi multilingual wedding concierge, ops control plane, and verification workbench"
git branch -M main
git remote add origin https://github.com/<your-username>/haanji.git
git push -u origin main
```

---

## Security & Demo Disclosure

- **Secrets Hygiene:** `GEMINI_API_KEY`, `HAANJI_HOST_KEY`, and `HAANJI_OPS_TOKEN` are strictly server-side. Client requests to the Ops Control Plane pass through `/api/ops-proxy/*`, keeping `OPS_TOKEN` out of browser bundles and responses. `.env*` files are excluded via `.gitignore`.
- **Host Key Notice:** `HOST_KEY` (`haanji-host-demo-2026` by default) is a lightweight hackathon gate, not a multi-tenant identity provider.
- **Demo Data & AI Disclosure:** All wedding schedules, venues, menus, and contacts for the *Sharma & Reddy Wedding* are fictional demonstration data. Built with React, Express, TypeScript, Tailwind CSS, and `@google/genai`.
