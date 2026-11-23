# Track B build prompt: HaanJi ops, Flagsmith control plane, Kubernetes and NudgeBee

You are a coding agent building Track B of HaanJi at a one-day hackathon. Read `00-shared-contract.md` in full first. It overrides anything here. Track A (the app and the Sarvam pipeline) is being built in parallel by another agent, so stay inside the files the contract assigns to Track B.

Work in small verified steps. After each step, run its check and paste the real output. Several NudgeBee details below were inferred from docs and templates on 23 Nov 2026 and are marked UNCONFIRMED. When reality differs, write it in `SPIKES.md`, adapt, and keep going. Never fake an integration. If a NudgeBee or Flagsmith step can't be made real, say so in the README.

## 1. What you own

- `app/ops/` (`metrics.py`, `alerter.py`, `routes_ops.py`, `flagsmith_admin.py`).
- `Dockerfile`, `docker-compose.yml`, `deploy/`, `nudgebee/`, `loadgen/`, `tests/b_*`.
- The ops half of `README.md`.

## 2. Ship stubs at T0+10m, before anything else

Track A imports your module from minute 15. Commit `app/ops/metrics.py` with:

- the real Prometheus metric definitions from contract 7.1;
- `observe_sarvam(api, status, seconds)`;
- a no-op `async def acquire_sarvam_slot(api)`;
- `app/ops/routes_ops.py` with an `APIRouter(prefix="/ops")` returning placeholders.

Check: `python -c "from app.ops import metrics, routes_ops"`.

## 3. The story you're building (what a judge sees)

1. Press the "Muhurat morning" button on the ops panel (or run `loadgen/surge.py`). It replays real fixture clips through `/api/turn` at 90 to 120 turns a minute. That is roughly 3x Sarvam's 60 req/min allowance once each turn costs 3 calls.
2. Real 429s from Sarvam climb. Pods are healthy: low CPU, no restarts. The alerter posts the contract 7.5 event to NudgeBee.
3. NudgeBee's agent sees the cluster. Its investigation should conclude the pods are fine and the failures are upstream quota errors in the worker logs. Show that evidence panel. A workflow asks a human to approve: "Set ops_degradation_level=1 and rpm budget 40 (sheds TTS, about 33% fewer Sarvam calls). Do NOT scale haanji-worker: more workers would raise the request rate."
4. After approval the workflow changes the Flagsmith flags through the Admin API. Within about 15 s the app is at level 1, 429s drop to near zero, and guests still get answers as text. The Flagsmith audit log shows the change by the API key.
5. When the alert resolves, a second workflow, also approval-gated, restores level 0.

The insight to state in the README and the video: **the obvious remediation (scale out) is wrong here, and the agent's evidence shows why.** This is a case where the symptom is far from the cause, which is the kind of case Saiyam calls the interesting one. Do not use ImagePullBackOff or crashloop demos; he has already shown those publicly.

## 4. Verified facts and their status

**Flagsmith Admin API:**

- Header `Authorization: Api-Key <FLAGSMITH_ORG_API_KEY>`, base `https://api.flagsmith.com/`.
- Documented experimental write (it may change, it fails while change requests are on, and it can't set identity overrides): `PATCH /api/__future__/environments/{FLAGSMITH_ENV_KEY}/features/{feature_id}/` with body `{"environment_default": {"enabled": true, "value": {"type": "integer", "value": "1"}}}`.
- Look up feature ids with `GET /api/v1/projects/{FLAGSMITH_PROJECT_ID}/features/?search=ops_degradation_level` (UNCONFIRMED path shape, verify in spike B2).
- Fallback is the classic `PATCH /api/v1/environments/{env_key}/featurestates/{id}/`, exact body UNCONFIRMED, or the CLI `flagsmith flag ...`.
- Do **not** enable change requests in the Production environment, or the agent's writes will fail.

**NudgeBee Cloud:**

- Agent install: `bash installation.sh -a "<ACCESS_KEY>:<SECRET>" -d true`. `-d true` turns off the eBPF node agent, which fails on kind. Omit `-g true` so the script installs kube-prometheus-stack, because we want Prometheus.
- Event Webhook: `POST <url from UI>` with a JSON event shape (`id, fingerprint, status, title, rule_name, severity, subject{name,type,namespace}, labels`), batches of up to 100.
- Workflows are JSON or YAML and run on Temporal.
  - Triggers: manual, schedule, webhook, event (`event.created` or `investigation.completed`).
  - Tasks: `core.approval` (types `in_app`, `instant_message` for Slack, `email`), `integrations.http` (any method, headers, auth), `cloud.k8s.cli`, `notifications.im`, `llm.summary`.
  - **The approval wait defaults to about 5 minutes. Raise the task and automation timeouts to 30 m.**
  - Exact YAML keys for the Slack approval are UNCONFIRMED. Build the workflow once in the UI, use "Copy JSON", and commit that canonical JSON to `nudgebee/`.
- `nbctl workflow validate|apply|trigger` exists (Apache 2.0 CLI). Its config is `nbctl configure add default`.
- Slack approvals need each approver's Slack email to match their NudgeBee user. If Slack isn't connected by T0+2h, use `in_app` approval and approve from the NudgeBee UI on screen.
- The server is BSL 1.1 and the agents are Apache 2.0. Say "source-available" in the README, not "fully open source".

## 5. Spikes, first 60 minutes after T0 (write results to `SPIKES.md`)

- **B1 Cluster and agent:**
  - `kind create cluster --name festive --config deploy/kind-config.yaml` (1 control-plane and 1 worker, with an `extraPortMappings` NodePort 30080 mapped to host 8080);
  - the agent install;
  - `kubectl get pods -n nudgebee-agent` all Running;
  - the cluster visible in the NudgeBee UI.

  Pre-pulled images are already in the local Docker cache, so `kind load docker-image` them if the pulls are slow.

- **B2 Flagsmith write:** from a Python shell, flip `ops_degradation_level` 0→1→0 with the Org API key and read it back with `GET`. Record the exact working endpoint and body.
- **B3 NudgeBee event:** post one hand-written contract 7.5 event with curl and confirm it shows in the NudgeBee UI. Record the exact URL and auth that worked.
- **B4 NudgeBee to Flagsmith:** a manual-trigger workflow with a single `integrations.http` task that PATCHes Flagsmith. If NudgeBee Cloud can't reach Flagsmith or can't hold the header, switch the actuator to `cloud.k8s.cli` running `kubectl -n haanji exec deploy/haanji-api -- python -m app.ops.flagsmith_admin --level 1 --budget 40 --actor nudgebee` (runs inside the cluster via the agent). Record which path is live. Either one is a legitimate integration.
- **B5 Tunnel:** `cloudflared tunnel --url http://localhost:8080` gives an https URL. Open it on a phone and confirm the mic permission prompt appears (HTTPS is required). Put the URL in `PUBLIC_BASE_URL`.

**Kill rule for B1:** if the agent isn't connected by T0+1h15m, post in the NudgeBee Discord and ask at the sponsor desk, and keep building everything else against a webhook-only NudgeBee. Tell the human immediately. This is the single biggest risk to 1st place.

## 6. Components

### 6.1 `app/ops/metrics.py`

- Real metric definitions plus `observe_sarvam`.
- `acquire_sarvam_slot(api)`: a Redis sorted-set sliding window over 60 s (key `haanji:sarvam:window`), where a Lua script atomically trims old entries, counts, and adds an entry if under the limit.
  - The limit is `min(flags.rpm_budget(), SARVAM_RPM_HARD_CAP)`, read through A's `app/flags.py` getter (import inside the function to avoid cycles).
  - If no slot is free, sleep 250 ms and retry, giving up after 20 s with `SarvamQuotaError`.
  - Shared across all worker pods. Add unit tests with fakeredis.
- `haanji_degradation_level` is set on every flag read.

### 6.2 `app/ops/alerter.py`

- An asyncio task started in the api pod lifespan, with exactly one active alerter (a Redis lock `haanji:alerter:lock`, TTL 30 s), so 2 api replicas don't double-fire.
- Every 10 s it reads rolling counters from Redis that `observe_sarvam` also writes, as per-second buckets: `429_pct_60s`, `rpm_60s`, `p95_chat_60s`, `queue_depth`.
- It's a state machine (`ok → firing → ok`), with the 120 s healthy hold before `resolved`. It posts firing and resolved events to NudgeBee with the same `fingerprint`, retrying 3 times with backoff and logging the HTTP status.
- It never posts on every tick. It posts on state change only, plus a 5-minute re-fire while still firing.

### 6.3 `app/ops/flagsmith_admin.py`

- `set_degradation(level:int, rpm_budget:int|None, actor:str, reason:str) -> dict` uses the endpoint confirmed in B2. It caches the feature ids, validates level ∈ {0,1,2} and budget ∈ [5,55], and logs `actor` and `reason`.
- CLI entry `python -m app.ops.flagsmith_admin --level 1 --budget 40 --actor nudgebee --reason "..."` is used by the kubectl fallback.

### 6.4 `app/ops/routes_ops.py`

- Contract 7.4 routes. The `X-Ops-Token` check is a constant-time compare, returning 401 on mismatch.
- `POST /ops/surge` with `{"rate_per_min":100,"seconds":180}` starts the in-cluster load job (6.6), so the ops panel button works without a terminal. It is token-protected and refuses a second surge while one runs.
- An `/ops` HTML panel (server-rendered, token required as a cookie set from `?t=`) shows:
  - live charts of rpm, 429 %, queue depth and level (simple canvas, 2 s polling);
  - a "Muhurat morning" button;
  - deep links to the NudgeBee investigation and the Flagsmith flag;
  - the label "Load is synthetic. The 429s are real Sarvam responses."

### 6.5 Kubernetes (`deploy/k8s/`, namespace `haanji`)

- `redis` Deployment and Service (no persistence; fine for a demo, and say so).
- `haanji-api` Deployment, 2 replicas, `uvicorn app.main:app`, with readiness on `/healthz`, plus a NodePort Service on 30080.
- `haanji-worker` Deployment, 2 replicas, `python -m app.worker`.
- Requests and limits are small and realistic (api 100m/256Mi, worker 100m/256Mi).
- A Secret from `.env`: `kubectl create secret generic haanji-env --from-env-file=.env -n haanji`, never committed.
- A ServiceMonitor for `/metrics` (labels to match the kube-prometheus-stack release that the NudgeBee script installed; check with `kubectl get prometheus -A -o yaml | grep -A3 serviceMonitorSelector`).
- Optional: a PrometheusRule mirroring the alerter thresholds, so NudgeBee also sees an Alertmanager alert. Should tier.
- `scripts/up.sh` runs build, `kind load docker-image haanji:dev`, `kubectl apply -k deploy/k8s`, and waits for rollout. It is idempotent.

### 6.6 Load generator (`loadgen/surge.py`)

- An asyncio httpx client, targeting the in-cluster Service by default. It runs as a k8s Job from the same image, so venue wifi doesn't limit the load.
- It replays `fixtures/audio/*.webm` from A, with random fake gids prefixed `load-` so they're excluded from the experiment. **Track A must skip `get_experiment_flag` and `track_event` for gids starting with `load-`**. Tell the human if A's worker does not.
- Its args are rate and seconds. It prints a one-line summary each 10 s.
- **Budget guard:** a 3-minute surge at 100 turns/min is about 300 turns, so the Sarvam cost is a few tens of rupees. Print the estimated cost before starting and require `--yes`.

### 6.7 NudgeBee workflows (`nudgebee/`)

- `haanji-sarvam-quota-degrade.json`, canonical JSON exported from the UI:
  - trigger: event on `investigation.completed`, filtered to `rule_name == haanji_sarvam_quota` (fall back to `event.created` if investigations take more than 3 minutes);
  - `llm.summary` of the evidence;
  - `core.approval` with the message from section 3.3 and a 30 m timeout;
  - the actuator from B4 (`integrations.http` to Flagsmith, or `cloud.k8s.cli` exec);
  - `notifications.im` to Slack or the in-app channel: "Applied by NudgeBee after approval by <approver>".
- `haanji-sarvam-quota-restore.json`, triggered on the resolved event: approval, then level 0 and budget 40.
- `nudgebee/README.md` explains how to import the files (UI "Create from Code", or `nbctl workflow apply`) and how to set the Flagsmith key as a NudgeBee secret.
- **Never put the Flagsmith org key in these JSON files.** Use NudgeBee's secret or credential reference. If none exists, document the manual paste step, and commit the file with the placeholder `<FLAGSMITH_ORG_API_KEY>`.

### 6.8 `docker-compose.yml` and `Dockerfile`

- The Dockerfile is `python:3.11-slim`, non-root, with pinned requirements.
- Compose runs redis, api and worker, with an `.env` file. It is the "no Kubernetes" setup path in the README. The alerter there can post to NudgeBee too, but NudgeBee has no cluster evidence in that mode, so say so.

## 7. Must, Should, Could

| Tier   | Item                                                                                                                                                                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Must   | Stubs at T0+10m. metrics plus the slot limiter. Alerter. flagsmith_admin. ops routes. kind deploy via `up.sh`. Agent connected. Event webhook live. Degrade workflow with a real approval and a real Flagsmith write. Tunnel. surge.py |
| Must   | Committed workflow JSON, `deploy/`, `loadgen/`, plus a README section "Reproduce the incident" with exact commands                                                                                                                     |
| Should | Restore workflow. Ops HTML panel with charts and the surge button. ServiceMonitor scraping. Slack approval instead of in-app                                                                                                           |
| Could  | PrometheusRule. Flagsmith Feature Health "unhealthy" event on the flag. Sarvam TTS reading the NudgeBee summary aloud to the host in Hindi (only if everything else is green at T0+5h)                                                 |

## 8. Order of work

1. T0 to T0+10m: stubs.
2. T0+10m to T0+1h: spikes B1 to B5, with the cluster creating in the background while you do B2 and B3.
3. T0+1h to T0+2h: metrics limiter, alerter, flagsmith_admin, ops routes, with unit tests (`pytest tests/b_unit -q`).
4. T0+2h to T0+2h30m: Dockerfile, k8s manifests, `up.sh`, and Track A's current code deployed on kind. **Checkpoint: one real turn through the tunnel from a phone.**
5. T0+2h30m to T0+4h: surge.py, then the workflow in the UI, an end-to-end rehearsal, exporting the JSON. **Checkpoint: the closed loop (contract section 8).**
6. T0+4h to T0+5h: Should items, and 3 full rehearsals with timings written down (time from surge start to alert, to investigation done, to approval request, to level change, to 429s cleared).
7. T0+5h: the README ops half (architecture in prose and a mermaid diagram, the "Reproduce the incident" commands, the measured timings, the license precision note), then record the fallback video of one full surge run.

## 9. Acceptance criteria for Track B

- [ ] `scripts/up.sh` on a fresh kind cluster brings HaanJi up with no manual step except `.env`.
- [ ] A 3-minute surge produces real Sarvam 429s visible in `haanji_sarvam_requests_total{status="429"}`.
- [ ] Exactly one firing event reaches NudgeBee per incident (no duplicates from 2 api replicas), plus one resolved event.
- [ ] The degrade workflow pauses for human approval, and nothing changes in Flagsmith before approval. Prove it with a timestamped log line from both sides.
- [ ] After approval, `ops_degradation_level` is 1 in Flagsmith (read back via the API), and the app reports level 1 within 20 s.
- [ ] 429s within 60 s after level 1 are at least 80% lower than in the 60 s before. Report the measured numbers.
- [ ] The Flagsmith audit log shows the change and the actor. Take a screenshot for the README.
- [ ] No secret in git: `git ls-files | xargs grep -lE "Api-Key [A-Za-z0-9]|ser\.[A-Za-z0-9]{10,}|sk_[A-Za-z0-9]{10,}"` must print nothing, and `.env` is untracked.
