# Track B test prompt: HaanJi ops loop and full-system e2e

You are a test-automation agent for Track B and for the end-to-end system. Read `00-shared-contract.md` and `02-build-track-b-ops.md` first. The 1st-place claim is one causal loop:

surge, then real 429s, then one alert, then a NudgeBee investigation, then **a human approval**, then a Flagsmith write, then the app degrades, then 429s fall, then the restore.

Your job is to prove each link with timestamps and numbers, and to prove the safety invariant: **nothing changes before a human approves.**

Stack: `pytest`, `pytest-asyncio`, `fakeredis` (with Lua support: `fakeredis[lua]`), `respx`, plus bash scripts driving `kubectl`, `curl` and `jq`. Put everything under `tests/b_*` and `scripts/e2e_*`. Mark live tests with `@pytest.mark.live`.

## 1. Unit tests (`tests/b_unit/`, no network)

1. **Sliding-window limiter (`acquire_sarvam_slot`):**
   - With a budget of 10/min, 50 concurrent acquirers across 3 simulated "pods" (separate client objects on one fakeredis) grant exactly 10 in the first window. The rest wait.
   - Granted slots never exceed `min(budget, SARVAM_RPM_HARD_CAP)`, even when the budget flag says 500.
   - The timeout raises `SarvamQuotaError` after 20 s. Use a fake clock or monkeypatched sleep so the test runs in under 1 s.
   - A budget change takes effect on the next acquire, with no restart.
2. **Alerter state machine** (a fake clock with injected metric series):
   - healthy, then 429% at 23 for 30 s, gives exactly one `firing` post;
   - staying bad for 4 minutes gives no extra posts; at 5 minutes there is one re-fire;
   - recovery held for 119 s gives no `resolved`; at 121 s there is exactly one `resolved` with the same fingerprint;
   - a flapping series (bad, good for 30 s, bad) gives no resolved and no duplicate firing;
   - each threshold fires alone: 429% > 10, p95 chat > 6 s, queue > 30;
   - payload validation: every contract 7.5 field is present, `severity="high"`, and numbers are serialised as strings in `labels` and `annotations`.
3. **Single active alerter:** two alerter instances on one fakeredis give only one holding the lock, and one firing post total. When the lock holder stops, the other takes over within 30 s.
4. **flagsmith_admin:**
   - rejects level 3, level -1, a budget of 0 and a budget of 100 before any HTTP call;
   - with respx, sends the exact method, path, headers and body confirmed in spike B2, using an `Api-Key` header;
   - caches the feature id lookup after the first call;
   - a 4xx response from Flagsmith raises and is logged with the actor, and does not report success.
5. **Ops routes:**
   - a missing or wrong `X-Ops-Token` returns 401 on every `/ops/*` route except `/metrics`;
   - the token comparison uses `hmac.compare_digest`, checked by AST;
   - `/ops/surge` refuses a second concurrent surge with 409;
   - `/ops/state` never includes any key or token.
6. **Metrics exposition:** after `observe_sarvam("tts","429",0.3)`, `/metrics` contains `haanji_sarvam_requests_total{api="tts",status="429"} 1.0`.

## 2. Static and config checks (`tests/b_static/`, fast)

- `kubectl apply --dry-run=client -k deploy/k8s` succeeds. It runs without a cluster when `kubectl` is present; skip with a clear reason if not.
- Every Deployment has resource requests and limits plus a readiness probe. The worker has no HPA, because scaling workers raises the Sarvam request rate, and that is the point of the demo. Assert it so nobody adds one "helpfully".
- The committed NudgeBee workflow JSON:
  - parses;
  - contains a `core.approval` task;
  - the actuator task (`integrations.http` or `cloud.k8s.cli`) depends on the approval task, directly or transitively;
  - the approval timeout is at least 30 m;
  - it contains no Flagsmith key. Only the placeholder `<FLAGSMITH_ORG_API_KEY>` or a NudgeBee secret reference is allowed.
- Run `nbctl workflow validate` on each workflow file if `nbctl` is installed.
- **Secret scan of the tracked tree:** `git ls-files | xargs grep -nE "Api-Key [A-Za-z0-9]{8,}|ser\.[A-Za-z0-9]{10,}|sk_[A-Za-z0-9]{10,}|gsk_|AIza"` prints nothing, `.env` is untracked, and `git ls-files | grep -iE "\.(db|sqlite)(-|$)"` is empty.

## 3. Integration tests against the real cluster (`scripts/e2e_cluster.sh`, needs kind up)

1. `scripts/up.sh` from a clean namespace (`kubectl delete ns haanji --wait`) finishes, and all pods are Ready within 180 s.
2. `curl` through the NodePort and through the tunnel URL returns 200 on `/healthz`.
3. Prometheus has the `haanji` scrape target `up == 1`. Query via `kubectl port-forward` to the Prometheus service.
4. One real voice turn from a fixture clip via `/api/turn` completes. `haanji_sarvam_requests_total` increases by 3 (STT, chat, TTS) at level 0.

## 4. The money test: full incident loop (`scripts/e2e_surge.sh`, live, about 8 minutes)

This is the script that produces the README's timing table and the video footage. It prints an ISO timestamp for every step and writes `tests/REPORT-B-loop.json`.

```
T_start          record baseline: level (Flagsmith API read-back), 429 count, rpm
                 assert level == 0 and no firing alert
T_surge          POST /ops/surge {"rate_per_min":100,"seconds":240}
T_429            poll /ops/state every 2 s until sarvam_429_last_60s > 0       (timeout 120 s)
T_alert          wait for the alerter's firing log line, then confirm the event in NudgeBee
                 (JSON-RPC events list via NUDGEBEE_API_TOKEN if the method exists, else the UI check is manual
                 and the script pauses with "confirm event visible in NudgeBee, press enter")
T_approval_req   wait until the NudgeBee workflow run is in the approval-pending state (API if available,
                 else a manual confirm prompt)
SAFETY CHECK     while approval is pending, read ops_degradation_level from the Flagsmith API 3 times, 5 s apart:
                 MUST still be 0. Any change before approval fails the run.
T_approved       a human approves in Slack or the NudgeBee UI (the script waits for this)
T_flag           poll the Flagsmith API until ops_degradation_level == 1                (timeout 60 s)
T_app            poll /ops/state until level == 1                                        (timeout 30 s)
measure          429 rate over the 60 s before T_flag vs the 60 s after T_app; assert a reduction of at least 80%
                 TTS request count over the 60 s after T_app: assert it is 0
                 haanji_turns_total{outcome="answered"} keeps increasing after T_app (guests still served)
T_surge_end      surge finishes
T_resolved       the alerter posts resolved (about 120 s healthy hold)
T_restore        a human approves the restore workflow; level returns to 0 within 60 s
```

Output: a table of each step's elapsed seconds from `T_surge`, the before and after 429 numbers, and the Flagsmith audit-log entry (fetched via the Admin API if an endpoint exists, otherwise a screenshot path). Run it **3 times** at T0+4h to T0+5h. Report the median and the worst time for each step. If any run fails the safety check, stop all feature work and tell the human.

## 5. Negative and failure-mode tests (live where noted, worth showing on camera)

1. **Approval rejected:** reject in NudgeBee. Assert the flag stays 0 for 2 minutes, and the workflow run ends rejected or failed, not applied.
2. **Approval timeout:** let one approval sit. Assert that after the timeout the flag is still 0. This also verifies that the 30 m timeout setting actually took.
3. **Flagsmith unreachable mid-surge:** block egress from the api pods to `api.flagsmith.com` with a NetworkPolicy, if kind's CNI enforces it. If not, set a wrong env key on one replica. Assert the app keeps serving on the cached environment or the defaults and does not crash. Remove the block afterwards.
4. **NudgeBee unreachable:** point `NUDGEBEE_EVENT_WEBHOOK_URL` at a dead host. Assert the alerter retries 3 times, logs the failure, and the app is unaffected.
5. **The fallback actuator works:** run `kubectl -n haanji exec deploy/haanji-api -- python -m app.ops.flagsmith_admin --level 1 --budget 40 --actor test --reason fallback`, assert the Flagsmith read-back, then restore. This guarantees a working path even if `integrations.http` misbehaves on the day.
6. **Scale-out makes it worse (the demo's thesis, measured):** under the same surge, compare 429 counts with the worker at 2 replicas against 6 replicas (`kubectl scale`), with the limiter's budget flag raised to the hard cap. Report both numbers. If 6 replicas don't increase 429s, say so honestly in the README and reword the claim. Never keep a claim the data contradicts.

## 6. Full-system acceptance run (both tracks, at T0+5h, before the freeze)

A single checklist the human runs with both agents, results pasted into `tests/REPORT-E2E.md`:

- [ ] A fresh clone runs `cp .env.example .env`, fills the keys, then `docker compose up`. A text turn works. This is the "README someone else can set up from" proof.
- [ ] `scripts/up.sh` on kind, the tunnel and a phone work: a Kannada voice question gets a spoken Kannada answer.
- [ ] Track A's golden-set gates are all green (grounding 100%, injection 4/4).
- [ ] `scripts/e2e_surge.sh` passes, with the safety check holding.
- [ ] The Flagsmith experiment page shows exposures in both arms from real floor users (not `load-` gids). Write down the actual numbers and the credible interval. If it crosses zero, the README says "inconclusive at n=..., here's the traffic it would take", which is the honest reading the judges reward.
- [ ] Incognito check of the repo URL, the demo video link and the tunnel URL.
- [ ] Secret scan (section 2) passes on the final commit.

## 7. Reporting

Write `tests/REPORT-B.md` with the unit counts, the static-check results, the 3-run loop timing table, the negative-test outcomes, and the scale-out measurement. The README's "Proof" section quotes these numbers verbatim with "live, measured on 25 Nov 2026, kind on a laptop, NudgeBee Cloud, Flagsmith SaaS, Sarvam pay-as-you-go."
