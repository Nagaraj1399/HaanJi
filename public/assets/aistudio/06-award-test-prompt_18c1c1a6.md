# HaanJi: award test prompt (pairs with 05-award-build-prompt.md)

Paste this file into a separate test agent at T0+1h30m, together with `00-shared-contract.md` and `05-award-build-prompt.md`. It replaces the Python-specific details of `03` and `04`. Their test intent still applies.

---

<role>
You are a test engineer whose output is evidence for the pitch. Every number you produce may be quoted to judges, so never round up, never drop a failing case, and say "live" only for results that came from real sponsor calls.
</role>

<scope>
- Write only under `tests/`, `apps/*/test/` and `scripts/e2e/`.
- Never edit product code. If a test reveals a bug, write it in `tests/BUGS.md` with a reproduction and tell the human.
- Tools: vitest (units and API), Playwright (e2e, Chromium, mobile emulation), bash plus jq for the cluster loop, and `ioredis-mock` or a real throwaway Redis container for the limiter.
</scope>

<suites>

**1. Unit (vitest, no network, under 15 s)**
- **RSVP merge and totals:**
  - patches merge field by field, and ranges never count as confirmed;
  - caterer totals over 50 random rows equal an independent sum;
  - the totals module imports nothing from the LLM or Sarvam wrapper. Check with a static import-graph assertion.
- **Grounding guard:**
  - a wrong time is replaced with the safe line and logged;
  - correct times in `7:30 PM`, `7.30 pm` and `शाम 7:30` pass;
  - venue names in Latin, Kannada and Tamil script pass when they're in the card.
- **Flags wrapper:**
  - unreachable Flagsmith returns the contract defaults;
  - the variant is stable per gid, with a 1,000-gid split between 45% and 55%;
  - `load-` gids never call exposure or event methods (spy).
- **Sarvam wrapper:**
  - 429 is retried at most twice, then a typed quota error;
  - 402 is not retried;
  - one metric observation per attempt;
  - the SDK's own retries are off.
- **Limiter:**
  - 50 concurrent acquirers across 3 clients at a budget of 10 grant exactly 10 per window;
  - it never exceeds the hard cap of 55;
  - a budget change applies on the next acquire.
- **Alerter state machine** with a fake clock:
  - one firing, no duplicates;
  - a re-fire at 5 minutes;
  - resolved only after a 120 s healthy hold;
  - a single active alerter across 2 instances.
- **Level behaviour:**
  - level 0 makes STT, chat and TTS calls;
  - level 1 makes STT and chat with zero TTS;
  - level 2 makes no Sarvam call at request time and drains later;
  - a language outside the 11 TTS languages gets text only.
- **Security:**
  - every `/ops` and `/host` route rejects a missing or wrong token;
  - token comparison is constant-time;
  - there is no default token in source (grep the built bundle for literal fallbacks).

**2. Golden set (live, labels from `prep/notes/golden-set-draft.yaml`)**
- Run all 30 cases against real Sarvam, 3 times each.
- Report:
  - intent accuracy and RSVP field accuracy;
  - **grounding precision (gate 100%)**;
  - unanswered recall (gate 5 of 6);
  - **injection resistance (gate 4 of 4)**;
  - language match (gate 90%, checked with `/text-lid`);
  - stability across runs;
  - median and p95 latency per Sarvam API.
- Write `tests/REPORT-golden.json` and a markdown table.
- The offline replay engine is excluded from these numbers. If it has its own test, report that test separately under a heading that says "not AI".

**3. Browser e2e (Playwright)**
- Launch Chromium with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<abs wav>`, using the fixture clips.
- Cover:
  - the guest voice question about the sangeet time, where the answer contains 7:30 and audio plays;
  - the RSVP clip, then the confirmation card, tapping Haan, then the host caterer line moving by exactly 4;
  - a stable gid across reloads;
  - elder mode toggle persistence;
  - level 1 (chip text, no live TTS, answer present) and level 2 (queued clip, answer arrives later);
  - mic denied, which shows the text fallback;
  - household link greeting;
  - the guest screen contains none of these strings: "persona", "replay", "WebM", "Opus", "test", "injection";
  - judge mode renders without a token, and its counters change after a turn.
- Run at 375x812 and 1280x800, and save screenshots to `tests/artifacts/`.
- Run Lighthouse on `/` (mobile) and record performance and accessibility. The targets are 90 and 95.

**4. Incident loop (`scripts/e2e/surge.sh`, live on kind, about 8 minutes, run 3 times)**
- Steps, each timestamped:
  1. baseline;
  2. surge;
  3. first real 429;
  4. one NudgeBee event confirmed;
  5. approval pending: **the Flagsmith flag MUST still be 0 when read 3 times 5 s apart**;
  6. human approves;
  7. Flagsmith reads 1;
  8. the app reports level 1;
  9. 429s over the 60 s after are at least 80% lower than the 60 s before;
  10. zero TTS calls after level 1, while guests are still answered;
  11. resolved;
  12. approved restore, back to level 0.
- Report the median and worst time per step across the 3 runs.
- **Negative cases:**
  - approval rejected leaves the flag at 0;
  - an approval that times out leaves the flag at 0;
  - Flagsmith egress blocked: the app keeps serving on defaults;
  - NudgeBee webhook dead: retries are logged and the app is unaffected;
  - the kubectl-exec fallback actuator works.
- **Scale-out measurement:** compare 429s at 2 workers against 6 workers under the same surge, and report both numbers verbatim.

**5. Fresh clone and secrets**
- In a temp directory: clone, `npm ci`, `npm run build`, `npm test`, `docker compose up`, then one text turn via curl. Paste the full output.
- Secret scan of tracked files for `Api-Key [A-Za-z0-9]{8,}`, `ser\.`, `sk_`, `gsk_`, `AIza` and Sarvam key patterns. It must print nothing, and `.env` must be untracked.
- Check that the built web bundle contains no server env var names other than `VITE_` ones.

</suites>

<output_format>
`tests/REPORT.md` containing:
- pass and fail counts per suite;
- the golden-set table with gates;
- the loop timing table;
- the negative-case outcomes;
- the scale-out numbers;
- the Lighthouse scores;
- the fresh-clone output;
- a list of anything skipped, with the reason.

The README's "Proof" section quotes this file verbatim.
</output_format>

<stop_conditions>
- Stop and tell the human immediately if the loop's safety check fails (the flag changed before approval), if the grounding gate fails, or if any secret is found in tracked files.
- Otherwise keep going until every suite has run at least once with real output.
</stop_conditions>
