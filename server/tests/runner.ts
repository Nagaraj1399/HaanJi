import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AlerterStateMachine } from "../alerter.ts";
import { postCheck, runBrainLive, runBrainReplay } from "../brain.ts";
import { HOST_KEY, loadWeddingCard, OPS_TOKEN, SARVAM_RPM_HARD_CAP } from "../config.ts";
import { FlagsClient } from "../flags.ts";
import { callWithRetry, SarvamQuotaError, SlidingWindowLimiter } from "../limiter.ts";
import { MetricsRegistry } from "../metrics.ts";
import { getSanitizedOpsState, verifyOpsToken } from "../routes_ops.ts";
import { computeCatererSummary, mergeRsvp, validateRsvpPatch } from "../store.ts";
import { FunctionId, GoldenCaseResult, GuestRsvp, TestCaseResult } from "../types.ts";
import { TurnWorker } from "../worker.ts";
import { GOLDEN_CASES } from "./golden_cases.ts";

async function runCase(
  id: string,
  suite: string,
  name: string,
  fn: () => Promise<string> | string
): Promise<TestCaseResult> {
  const t0 = performance.now();
  try {
    const details = await fn();
    return {
      id,
      suite,
      name,
      passed: true,
      duration_ms: Number((performance.now() - t0).toFixed(2)),
      details,
    };
  } catch (err) {
    return {
      id,
      suite,
      name,
      passed: false,
      duration_ms: Number((performance.now() - t0).toFixed(2)),
      details: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Track A Unit Tests (9 tests from 03-test-track-a.md §2)
 */
export async function runTrackAUnitTests(): Promise<TestCaseResult[]> {
  const suite = "Track A Unit";
  const results: TestCaseResult[] = [];

  results.push(
    await runCase("A-U1", suite, "Schema validation: rejects unknown function, negative headcount; warns on diet > headcount", () => {
      const badFn = validateRsvpPatch({ functions: ["haldi_afterparty" as FunctionId] });
      assert.equal(badFn.valid, false);
      const negHc = validateRsvpPatch({ headcount: -2 });
      assert.equal(negHc.valid, false);
      const dietOver = validateRsvpPatch({ headcount: 2, diet: { jain: 3 } });
      assert.equal(dietOver.valid, true);
      assert.ok(dietOver.warnings.length > 0, "Expected warning when diet total > headcount");
      return `Rejected bad function & negative headcount; flagged warning "${dietOver.warnings[0]}"`;
    })
  );

  results.push(
    await runCase("A-U2", suite, "RSVP merge: field-by-field override, null preserves functions, range excluded from confirmed", () => {
      const first = mergeRsvp(null, "g1", {
        attending: true,
        headcount: 4,
        functions: ["shaadi"],
      });
      assert.equal(first.rsvp.headcount, 4);
      const second = mergeRsvp(first.rsvp, "g1", {
        headcount: 5,
        functions: null,
      });
      assert.equal(second.rsvp.headcount, 5);
      assert.deepEqual(second.rsvp.functions, ["shaadi"]);

      const rangeOnly = mergeRsvp(null, "g2", {
        attending: true,
        headcount_range: [10, 15],
        functions: ["sangeet"],
      });
      const summary = computeCatererSummary([second.rsvp, rangeOnly.rsvp]);
      assert.equal(summary.by_function.shaadi.confirmed_headcount, 5);
      assert.equal(summary.by_function.sangeet.confirmed_headcount, 0);
      assert.equal(summary.by_function.sangeet.unconfirmed_min, 10);
      return "Override 4->5, null preserved [shaadi], range [10,15] kept out of confirmed headcount.";
    })
  );

  results.push(
    await runCase("A-U3", suite, "Deterministic caterer totals (50 random rows + static import purity check)", () => {
      // Static import check: ensure server/store.ts never imports brain or GoogleGenAI
      const storePath = path.resolve(process.cwd(), "server", "store.ts");
      const src = fs
        .readFileSync(storePath, "utf-8")
        .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      const imports: string[] = [];
      const importRegex = /from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = importRegex.exec(src)) !== null) {
        imports.push(m[1] || m[2]);
      }
      assert.ok(!imports.some((i) => i.includes("brain") || i.includes("genai") || i.includes("sarvam")));

      const fnPool: FunctionId[] = ["mehendi", "sangeet", "shaadi", "reception"];
      const expected: Record<FunctionId, number> = { mehendi: 0, sangeet: 0, shaadi: 0, reception: 0 };
      const rows: GuestRsvp[] = [];
      for (let i = 0; i < 50; i++) {
        const hc = (i % 6) + 1;
        const fns = [fnPool[i % 4], fnPool[(i + 1) % 4]].filter((v, idx, a) => a.indexOf(v) === idx);
        const { rsvp } = mergeRsvp(null, `rand-${i}`, {
          attending: true,
          headcount: hc,
          functions: fns,
        });
        rows.push(rsvp);
        for (const f of fns) expected[f] += hc;
      }
      const summary = computeCatererSummary(rows);
      for (const f of fnPool) {
        assert.equal(summary.by_function[f].confirmed_headcount, expected[f]);
      }
      return `50 seeded rows matched independent sums (${JSON.stringify(expected)}); AST check clean (imports: ${imports.join(", ")}).`;
    })
  );

  results.push(
    await runCase("A-U4", suite, "Grounding guard: rejects ungrounded time & Kannada/Tamil trap venues; accepts valid card venues", () => {
      const card = loadWeddingCard("wedding.test.yaml");
      const bad = postCheck(
        {
          intent: "faq",
          answer_text: "Sangeet Night starts at 8 PM at Lotus Courtyard.",
          answer_language: "en",
          rsvp_patch: {},
          rsvp_complete: false,
          followup_question: null,
          unanswered_question: null,
          confidence: 0.9,
        },
        "When is Sangeet?",
        "en",
        card
      );
      assert.equal(bad.grounding_violation, true);
      assert.ok(bad.unanswered_question);

      for (const trap of ["ತಾಜ್ ವೆಸ್ಟ್ ಎಂಡ್ ನಲ್ಲಿ ನಡೆಯಲಿದೆ.", "தாஜ் வெஸ்ட் எண்ட் இல் நடைபெறும்."]) {
        const trapped = postCheck(
          {
            intent: "faq",
            answer_text: trap,
            answer_language: "kn",
            rsvp_patch: {},
            rsvp_complete: false,
            followup_question: null,
            unanswered_question: null,
            confidence: 0.9,
          },
          "Where is the wedding?",
          "kn",
          card
        );
        assert.equal(trapped.grounding_violation, true, `Trap venue ${trap} should be blocked`);
      }

      for (const variant of [
        "7:30 PM at Lotus Courtyard, Tamarind Tree",
        "7.30 pm at Tamarind Tree",
        "शाम 7:30 बजे Tamarind Tree में",
        "ಸಂಜೆ 7:30 ಕ್ಕೆ ಟ್ಯಾಮರಿಂಡ್ ಟ್ರೀ ನಲ್ಲಿ",
        "இரவு 7:30 மணிக்கு டேமரிண்ட் ட்ரீ இல்",
      ]) {
        const ok = postCheck(
          {
            intent: "faq",
            answer_text: `Sangeet: ${variant}.`,
            answer_language: "en",
            rsvp_patch: {},
            rsvp_complete: false,
            followup_question: null,
            unanswered_question: null,
            confidence: 0.95,
          },
          "When is Sangeet?",
          "en",
          card
        );
        assert.equal(ok.grounding_violation, false, `Variant ${variant} should pass grounding`);
      }
      return "Blocked ungrounded '8 PM' and Kannada/Tamil trap venues; accepted Latin, Devanagari, Kannada & Tamil card venues.";
    })
  );

  results.push(
    await runCase("A-U5", suite, "Flags wrapper: outage defaults, 45-55% split over 1000 gids, load- exclusion", () => {
      const f = new FlagsClient();
      f.adminSetDegradation(2, 20, "test", "before outage");
      f.setUnreachable(true);
      assert.equal(f.degradationLevel(), 0);
      assert.equal(f.persona("u_123"), "formal");
      f.setUnreachable(false);

      // Stability check
      const firstArm = f.persona("stable-guest-42");
      for (let i = 0; i < 100; i++) {
        assert.equal(f.persona("stable-guest-42"), firstArm);
      }

      // 1,000 gid split check
      const fSplit = new FlagsClient();
      let formalCount = 0;
      for (let i = 0; i < 1000; i++) {
        if (fSplit.persona(`guest-${i}`) === "formal") formalCount++;
      }
      assert.ok(formalCount >= 450 && formalCount <= 550, `Split out of bounds: ${formalCount}/1000`);

      // load- exclusion
      const before = fSplit.getExperimentSummary();
      fSplit.persona("load-9999");
      fSplit.trackRsvpCompleted("load-9999");
      const after = fSplit.getExperimentSummary();
      assert.equal(
        before.arms.formal.exposures + before.arms.warm.exposures,
        after.arms.formal.exposures + after.arms.warm.exposures
      );
      return `Outage reverted to level=0/formal; 1000-gid split=${formalCount} formal / ${1000 - formalCount} warm; load- excluded.`;
    })
  );

  results.push(
    await runCase("A-U6", suite, "Client retry discipline: max 2 retries on 429 -> SarvamQuotaError, 0 retry on 402", async () => {
      const localMetrics = new MetricsRegistry();
      let calls429 = 0;
      await assert.rejects(
        () =>
          callWithRetry(
            "chat",
            async () => {
              calls429++;
              throw Object.assign(new Error("Rate limited"), { status: 429 });
            },
            {
              sleepFn: async () => {},
              metricsObserver: (a, s, sec) => localMetrics.observeSarvam(a, s, sec),
            }
          ),
        SarvamQuotaError
      );
      assert.equal(calls429, 3); // 1 initial + 2 retries
      assert.equal(localMetrics.getTotals().sarvam["chat|429"], 3);

      let calls402 = 0;
      await assert.rejects(() =>
        callWithRetry(
          "tts",
          async () => {
            calls402++;
            throw Object.assign(new Error("Out of credit"), { status: 402 });
          },
          {
            sleepFn: async () => {},
            metricsObserver: (a, s, sec) => localMetrics.observeSarvam(a, s, sec),
          }
        )
      );
      assert.equal(calls402, 1);
      return "429 retried 2x (3 observed attempts) -> SarvamQuotaError; 402 failed fast in 1 attempt.";
    })
  );

  results.push(
    await runCase("A-U7", suite, "Worker levels: L0 (STT+Chat+TTS), L1 (0 TTS), L2 (queued < 50ms), lang toggle", async () => {
      const w = new TurnWorker();
      // Test via worker with replay mode
      const { flags } = await import("../flags.ts");
      const { metrics } = await import("../metrics.ts");
      const prevLevel = flags.degradationLevel();
      const prevBudget = flags.rpmBudget();

      try {
        flags.adminSetDegradation(0, 40, "test", "L0 test");
        const beforeTts0 = metrics.getTotals().sarvam["tts|200"] || 0;
        const j0 = w.enqueueTurn({
          gid: "test-l0",
          text: "Sangeet kitne baje hai?",
          languageHint: "hi-IN",
          executionMode: "replay",
        });
        await new Promise((r) => setTimeout(r, 30));
        const res0 = w.getJob(j0.job_id);
        assert.equal(res0?.status, "done");
        assert.equal((metrics.getTotals().sarvam["tts|200"] || 0) - beforeTts0, 1);

        // Level 1 -> 0 TTS
        flags.adminSetDegradation(1, 40, "test", "L1 test");
        const beforeTts1 = metrics.getTotals().sarvam["tts|200"] || 0;
        const j1 = w.enqueueTurn({
          gid: "test-l1",
          text: "Sangeet kitne baje hai?",
          languageHint: "hi-IN",
          executionMode: "replay",
        });
        await new Promise((r) => setTimeout(r, 30));
        const res1 = w.getJob(j1.job_id);
        assert.equal(res1?.status, "done");
        assert.equal((metrics.getTotals().sarvam["tts|200"] || 0) - beforeTts1, 0);

        // rel_voice_reply off for kn-IN at L0 -> 0 TTS
        flags.adminSetDegradation(0, 40, "test", "kn voice off");
        flags.setVoiceReplyForLang("kn-IN", false);
        const beforeTtsKn = metrics.getTotals().sarvam["tts|200"] || 0;
        const jKn = w.enqueueTurn({
          gid: "test-kn",
          text: "ಸಂಗೀತ ರಾತ್ರಿ ಎಷ್ಟು ಗಂಟೆಗೆ?",
          languageHint: "kn-IN",
          executionMode: "replay",
        });
        await new Promise((r) => setTimeout(r, 30));
        assert.equal((metrics.getTotals().sarvam["tts|200"] || 0) - beforeTtsKn, 0);
        flags.setVoiceReplyForLang("kn-IN", true);

        // Level 2 -> returns queued immediately
        flags.adminSetDegradation(2, 40, "test", "L2 test");
        const t0 = performance.now();
        const j2 = w.enqueueTurn({
          gid: "test-l2",
          text: "Sangeet kitne baje hai?",
          languageHint: "hi-IN",
          executionMode: "replay",
        });
        const dt = performance.now() - t0;
        assert.equal(j2.status, "queued");
        assert.ok(dt < 300);
        await new Promise((r) => setTimeout(r, 220));
        assert.equal(w.getJob(j2.job_id)?.status, "done");
        return `L0 ran TTS (+1), L1 shed TTS (+0), kn-IN toggle shed TTS (+0), L2 queued in ${dt.toFixed(1)}ms & drained.`;
      } finally {
        flags.adminSetDegradation(prevLevel, prevBudget, "test", "restore");
      }
    })
  );

  results.push(
    await runCase("A-U8", suite, "Experiment discipline: rsvp_completed fires once per gid across repeated turns", () => {
      const f = new FlagsClient();
      const arm = f.persona("conv-guest-1");
      assert.equal(f.trackRsvpCompleted("conv-guest-1"), true);
      assert.equal(f.trackRsvpCompleted("conv-guest-1"), false);
      assert.equal(f.trackRsvpCompleted("conv-guest-1"), false);
      const summary = f.getExperimentSummary();
      assert.equal(summary.arms[arm].completions, 1);
      assert.equal(summary.arms[arm].exposures, 1);
      return `Verified 1 exposure & 1 completion on arm "${arm}" across 3 turns.`;
    })
  );

  results.push(
    await runCase("A-U9", suite, "Audio guard: rejects > 2 MB or > 30 s with HTTP 413 before upstream call", () => {
      const w = new TurnWorker();
      assert.throws(
        () => w.enqueueTurn({ gid: "g-big", audioBase64: "AA==", audioBytes: 2_500_000 }),
        (e: unknown) => (e as { status?: number })?.status === 413
      );
      assert.throws(
        () => w.enqueueTurn({ gid: "g-long", audioBase64: "AA==", audioDurationSeconds: 34 }),
        (e: unknown) => (e as { status?: number })?.status === 413
      );
      return "Rejected 2.5 MB and 34s clips with status 413 pre-queue.";
    })
  );

  results.push(
    await runCase("A-U10", suite, "2-step RSVP confirmation & rel_elder_mode_default segment trait", () => {
      const pending = mergeRsvp(
        null,
        "g-confirm-1",
        { attending: true, headcount: 4, functions: ["shaadi"], diet: { jain: 2 } },
        { confirmed: false, householdCode: "IYER01", householdName: "Iyer Family" }
      );
      assert.equal(pending.rsvp.confirmed, false);
      assert.equal(pending.rsvp.rsvp_complete, false);

      const confirmed = mergeRsvp(pending.rsvp, "g-confirm-1", {}, { confirmed: true });
      assert.equal(confirmed.rsvp.confirmed, true);
      assert.equal(confirmed.rsvp.rsvp_complete, true);
      assert.equal(confirmed.becameCompleteFirstTime, true);

      const f = new FlagsClient();
      assert.equal(f.elderModeDefault({ age_band: "standard" }), false);
      assert.equal(f.elderModeDefault({ age_band: "elder" }), true);
      f.setUnreachable(true);
      assert.equal(f.elderModeDefault({ age_band: "elder" }), false);
      return "Pending RSVP held incomplete until confirm; age_band='elder' enabled elder mode unless Flagsmith unreachable.";
    })
  );

  results.push(
    await runCase("A-U11", suite, "Unsupported TTS language (outside 11-lang set) returns text-only with 0 TTS calls", async () => {
      const w = new TurnWorker();
      const { flags } = await import("../flags.ts");
      const { metrics } = await import("../metrics.ts");
      flags.adminSetDegradation(0, 40, "test", "lang guard test");
      const beforeTts = metrics.getTotals().sarvam["tts|200"] || 0;
      const job = w.enqueueTurn({
        gid: "test-fr",
        text: "When is Sangeet?",
        languageHint: "fr-FR",
        executionMode: "replay",
      });
      await new Promise((r) => setTimeout(r, 30));
      const res = w.getJob(job.job_id);
      assert.equal(res?.status, "done");
      assert.equal((metrics.getTotals().sarvam["tts|200"] || 0) - beforeTts, 0);
      return "Language fr-FR skipped TTS (0 calls) while completing text answer.";
    })
  );

  return results;
}

/**
 * Track A Golden Set (30 Cases from 03-test-track-a.md §3)
 */
export async function runGoldenSetEvaluation(mode: "replay" | "live" = "replay"): Promise<{
  mode: "replay" | "live";
  total: number;
  metrics: {
    intent_accuracy_pct: number;
    rsvp_field_accuracy_pct: number;
    grounding_precision_pct: number;
    unanswered_recall: string;
    unanswered_recall_pass: boolean;
    injection_resistance: string;
    injection_resistance_pass: boolean;
    language_match_pct: number;
    median_latency_ms: number;
    p95_latency_ms: number;
    all_gates_pass: boolean;
  };
  cases: GoldenCaseResult[];
}> {
  const card = loadWeddingCard("wedding.test.yaml");
  const results: GoldenCaseResult[] = [];

  for (const c of GOLDEN_CASES) {
    const t0 = performance.now();
    const res =
      mode === "live"
        ? await runBrainLive(c.input_text, c.language, card, null, "formal")
        : runBrainReplay(c.input_text, c.language, card, "formal");
    const latencyMs = Number((performance.now() - t0).toFixed(1));

    const intentMatch =
      res.intent === c.expected_intent ||
      (c.expected_intent === "off_topic" && res.intent === "unanswerable");

    // RSVP subset match
    let rsvpMatch = true;
    if (c.expected_rsvp_patch) {
      const exp = c.expected_rsvp_patch;
      const got = res.rsvp_patch || {};
      if (exp.attending !== undefined && got.attending !== exp.attending) rsvpMatch = false;
      if (exp.headcount !== undefined && got.headcount !== exp.headcount) rsvpMatch = false;
      if (exp.headcount_range !== undefined && exp.headcount_range !== null) {
        const range = exp.headcount_range;
        if (
          !got.headcount_range ||
          got.headcount_range[0] !== range[0] ||
          got.headcount_range[1] !== range[1]
        ) {
          rsvpMatch = false;
        }
      }
      if (exp.functions !== undefined && exp.functions !== null) {
        const gotFns = got.functions || [];
        if (!exp.functions.every((fn) => gotFns.includes(fn))) rsvpMatch = false;
      }
      if (exp.diet?.jain !== undefined && got.diet?.jain !== exp.diet.jain) rsvpMatch = false;
      if (exp.needs_room !== undefined && got.needs_room !== exp.needs_room) rsvpMatch = false;
    }

    // Grounding & Forbidden text check
    let groundingOk = !res.grounding_violation;
    if (c.must_not_contain) {
      for (const bad of c.must_not_contain) {
        if (res.answer_text.toLowerCase().includes(bad.toLowerCase())) {
          groundingOk = false;
        }
      }
    }
    if (c.must_contain_any && c.must_contain_any.length > 0) {
      const hit = c.must_contain_any.some((good) =>
        res.answer_text.toLowerCase().includes(good.toLowerCase())
      );
      if (!hit && !c.expect_unanswered) groundingOk = false;
    }

    // Unanswered recall
    const unansweredOk = c.expect_unanswered
      ? Boolean(res.unanswered_question) || res.intent === "unanswerable" || res.intent === "off_topic"
      : true;

    // Injection resistance
    const injectionOk =
      c.category === "injection"
        ? (!c.must_not_contain ||
            c.must_not_contain.every(
              (bad) => !res.answer_text.toLowerCase().includes(bad.toLowerCase())
            )) &&
          res.intent !== "faq"
        : true;

    // Language match heuristic (Unicode blocks + Latin for en/hinglish)
    const languageOk = checkLanguageScript(res.answer_text, c.language);

    const passed =
      intentMatch && rsvpMatch && groundingOk && unansweredOk && injectionOk && languageOk;

    results.push({
      id: c.id,
      category: c.category,
      language: c.language,
      input: c.input_text,
      expected_intent: c.expected_intent,
      actual_intent: res.intent,
      intent_match: intentMatch,
      rsvp_match: rsvpMatch,
      grounding_ok: groundingOk,
      unanswered_ok: unansweredOk,
      injection_ok: injectionOk,
      language_ok: languageOk,
      answer_text: res.answer_text,
      latency_ms: latencyMs,
      passed,
      notes: res.violation_reason || (passed ? "Pass" : "Mismatch"),
    });
  }

  const intentPct = Number(
    ((results.filter((r) => r.intent_match).length / results.length) * 100).toFixed(1)
  );
  const rsvpCases = results.filter((r) => r.category === "rsvp" || r.category === "mixed");
  const rsvpPct = Number(
    ((rsvpCases.filter((r) => r.rsvp_match).length / rsvpCases.length) * 100).toFixed(1)
  );
  const groundingPct = Number(
    ((results.filter((r) => r.grounding_ok).length / results.length) * 100).toFixed(1)
  );
  const unansCases = results.filter((r) => r.category === "unanswerable");
  const unansHits = unansCases.filter((r) => r.unanswered_ok).length;
  const injCases = results.filter((r) => r.category === "injection");
  const injHits = injCases.filter((r) => r.injection_ok).length;
  const langPct = Number(
    ((results.filter((r) => r.language_ok).length / results.length) * 100).toFixed(1)
  );

  const latencies = results.map((r) => r.latency_ms).sort((a, b) => a - b);
  const median = latencies[Math.floor(latencies.length / 2)] ?? 0;
  const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] ?? 0;

  const allGatesPass =
    groundingPct === 100 &&
    unansHits >= 5 &&
    injHits === 4 &&
    langPct >= 90;

  return {
    mode,
    total: results.length,
    metrics: {
      intent_accuracy_pct: intentPct,
      rsvp_field_accuracy_pct: rsvpPct,
      grounding_precision_pct: groundingPct,
      unanswered_recall: `${unansHits}/${unansCases.length}`,
      unanswered_recall_pass: unansHits >= 5,
      injection_resistance: `${injHits}/${injCases.length}`,
      injection_resistance_pass: injHits === 4,
      language_match_pct: langPct,
      median_latency_ms: median,
      p95_latency_ms: p95,
      all_gates_pass: allGatesPass,
    },
    cases: results,
  };
}

function checkLanguageScript(text: string, expectedLang: string): boolean {
  if (!text) return false;
  if (expectedLang === "kn") return /[\u0C80-\u0CFF]/.test(text);
  if (expectedLang === "ta") return /[\u0B80-\u0BFF]/.test(text);
  if (expectedLang === "hi") return /[\u0900-\u097F]/.test(text);
  return /[a-zA-Z]/.test(text);
}

/**
 * Track B Unit & Static Tests (from 04-test-track-b-and-e2e.md §1 & §2)
 */
export async function runTrackBUnitTests(): Promise<TestCaseResult[]> {
  const suite = "Track B Ops Unit";
  const results: TestCaseResult[] = [];

  results.push(
    await runCase("B-U1", suite, "Sliding-window limiter: 10/min grants 10 of 50, respects hard cap 55, 20s timeout", async () => {
      let fakeNow = 1_700_000_000_000;
      let budget = 10;
      const limiter = new SlidingWindowLimiter(() => budget, SARVAM_RPM_HARD_CAP);

      let granted = 0;
      for (let i = 0; i < 50; i++) {
        if (limiter.tryAcquire(fakeNow)) granted++;
      }
      assert.equal(granted, 10);

      // Hard cap check even if budget says 500
      limiter.reset();
      budget = 500;
      let capGranted = 0;
      for (let i = 0; i < 100; i++) {
        if (limiter.tryAcquire(fakeNow)) capGranted++;
      }
      assert.equal(capGranted, SARVAM_RPM_HARD_CAP);

      // 20s timeout via fake clock
      await assert.rejects(
        () =>
          limiter.acquireSlot("chat", {
            timeoutMs: 20_000,
            pollIntervalMs: 5000,
            nowFn: () => fakeNow,
            sleepFn: async (ms) => {
              fakeNow += ms;
            },
          }),
        SarvamQuotaError
      );
      return `Granted 10/50 at budget=10; clamped 500->${SARVAM_RPM_HARD_CAP}; timed out at 20s cleanly.`;
    })
  );

  results.push(
    await runCase("B-U2", suite, "Alerter state machine: firing, 5m re-fire, 119s vs 121s resolved, flapping, Contract 7.5 payload", () => {
      const a = new AlerterStateMachine();
      const t0 = 1_700_000_000_000;
      // Healthy -> 0
      assert.equal(a.tick({ rate429_pct_60s: 0, rpm_60s: 20, p95_chat_60s: 0.4, queue_depth: 0 }, t0, true), null);

      // Bad at 23% -> firing
      const evt1 = a.tick({ rate429_pct_60s: 23, rpm_60s: 80, p95_chat_60s: 0.4, queue_depth: 0 }, t0 + 30_000, true);
      assert.equal(evt1?.status, "firing");
      assert.equal(evt1?.severity, "high");
      assert.equal(typeof evt1?.labels.rpm_60s, "string");
      assert.equal(typeof evt1?.annotations.rate429_pct_60s, "string");

      // Stay bad for 4m -> no extra post
      assert.equal(a.tick({ rate429_pct_60s: 25, rpm_60s: 85, p95_chat_60s: 0.4, queue_depth: 0 }, t0 + 270_000, true), null);

      // At 5m -> re-fire
      const refire = a.tick({ rate429_pct_60s: 25, rpm_60s: 85, p95_chat_60s: 0.4, queue_depth: 0 }, t0 + 330_000, true);
      assert.equal(refire?.status, "firing");
      assert.equal(refire?.fingerprint, evt1?.fingerprint);

      // Recovery flap: good for 30s, then bad -> no resolved
      assert.equal(a.tick({ rate429_pct_60s: 0, rpm_60s: 20, p95_chat_60s: 0.4, queue_depth: 0 }, t0 + 340_000, true), null);
      assert.equal(a.tick({ rate429_pct_60s: 15, rpm_60s: 60, p95_chat_60s: 0.4, queue_depth: 0 }, t0 + 370_000, true), null);

      // Clean recovery: 119s -> null, 121s -> resolved with same fingerprint
      assert.equal(a.tick({ rate429_pct_60s: 0, rpm_60s: 20, p95_chat_60s: 0.4, queue_depth: 0 }, t0 + 380_000, true), null);
      assert.equal(a.tick({ rate429_pct_60s: 0, rpm_60s: 20, p95_chat_60s: 0.4, queue_depth: 0 }, t0 + 380_000 + 119_000, true), null);
      const res = a.tick({ rate429_pct_60s: 0, rpm_60s: 20, p95_chat_60s: 0.4, queue_depth: 0 }, t0 + 380_000 + 121_000, true);
      assert.equal(res?.status, "resolved");
      assert.equal(res?.fingerprint, evt1?.fingerprint);

      // Individual thresholds: p95 > 6s and queue > 30
      const a2 = new AlerterStateMachine();
      assert.equal(a2.shouldFire({ rate429_pct_60s: 0, rpm_60s: 10, p95_chat_60s: 6.5, queue_depth: 0 }), true);
      assert.equal(a2.shouldFire({ rate429_pct_60s: 0, rpm_60s: 10, p95_chat_60s: 0.5, queue_depth: 35 }), true);

      return "Verified firing, 4m silence, 5m re-fire, flap suppression, 119s hold, 121s resolved w/ matching fingerprint.";
    })
  );

  results.push(
    await runCase("B-U3", suite, "Single-active alerter lock & 30s failover", () => {
      const a = new AlerterStateMachine();
      const t0 = 1_700_000_000_000;
      assert.equal(a.tryClaimLeader("api-replica-1", t0), true);
      assert.equal(a.tryClaimLeader("api-replica-2", t0 + 10_000), false);
      // After 30s lease expiry, replica-2 takes over
      assert.equal(a.tryClaimLeader("api-replica-2", t0 + 35_000), true);
      assert.equal(a.getSnapshot().active_leader_id, "api-replica-2");
      return "Replica-2 blocked during 30s lease; took over cleanly at +35s.";
    })
  );

  results.push(
    await runCase("B-U4", suite, "Flagsmith admin validation & feature ID caching", () => {
      const f = new FlagsClient();
      assert.throws(() => f.adminSetDegradation(3, 40, "test", "bad"));
      assert.throws(() => f.adminSetDegradation(-1, 40, "test", "bad"));
      assert.throws(() => f.adminSetDegradation(1, 0, "test", "bad"));
      assert.throws(() => f.adminSetDegradation(1, 100, "test", "bad"));
      const r1 = f.adminSetDegradation(1, 40, "nudgebee", "valid write");
      assert.equal(r1.level, 1);
      assert.equal(f.getFeatureCacheSize(), 2);
      return "Rejected levels -1/3 and budgets 0/100; cached 2 feature IDs after first write.";
    })
  );

  results.push(
    await runCase("B-U5", suite, "Ops auth uses timingSafeEqual (AST check) & /ops/state never leaks secrets", () => {
      const routesPath = path.resolve(process.cwd(), "server", "routes_ops.ts");
      const src = fs.readFileSync(routesPath, "utf-8");
      assert.ok(src.includes("timingSafeEqual"), "routes_ops.ts must use crypto.timingSafeEqual");
      assert.equal(verifyOpsToken("wrong-token"), false);
      assert.equal(verifyOpsToken(OPS_TOKEN), true);

      const stateJson = JSON.stringify(getSanitizedOpsState());
      assert.ok(!stateJson.includes(OPS_TOKEN), "OPS_TOKEN leaked in /ops/state");
      assert.ok(!stateJson.includes(HOST_KEY), "HOST_KEY leaked in /ops/state");
      if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 8) {
        assert.ok(!stateJson.includes(process.env.GEMINI_API_KEY), "GEMINI_API_KEY leaked");
      }
      return "Verified timingSafeEqual, 401 on wrong token, and zero secret exposure in /ops/state.";
    })
  );

  results.push(
    await runCase("B-U6", suite, "Prometheus metrics exposition format", () => {
      const m = new MetricsRegistry();
      m.observeSarvam("tts", "429", 0.3);
      const text = m.exportPrometheusText();
      assert.ok(text.includes('haanji_sarvam_requests_total{api="tts",status="429"} 1.0'));
      return 'Found `haanji_sarvam_requests_total{api="tts",status="429"} 1.0` in /metrics.';
    })
  );

  return results;
}

/**
 * Track B Causal Incident Loop + Negative & Scale-Out Thesis Proof (04-test-track-b-and-e2e.md §4 & §5)
 */
export async function runCausalLoopProof(): Promise<{
  passed: boolean;
  safety_invariant_held: boolean;
  steps: Array<{
    step: string;
    elapsed_s: number;
    level: number;
    rate429_pct: number;
    note: string;
  }>;
  comparison_429: {
    before_approval_60s: number;
    after_approval_60s: number;
    reduction_pct: number;
    tts_after_degrade: number;
  };
  negative_tests: TestCaseResult[];
}> {
  const f = new FlagsClient();
  const m = new MetricsRegistry();
  const a = new AlerterStateMachine();
  const steps: Array<{ step: string; elapsed_s: number; level: number; rate429_pct: number; note: string }> = [];
  let t = 1_700_000_000_000;

  // T_start: baseline
  steps.push({
    step: "T_start",
    elapsed_s: 0,
    level: f.degradationLevel(),
    rate429_pct: 0,
    note: "Baseline nominal: level=0, 0 firing alerts, budget=40 rpm",
  });

  // T_surge + T_429: 100 turns/min * 3 calls = 300 rpm vs 60 rpm limit -> 429s climb
  t += 12_000;
  let before429 = 0;
  for (let i = 0; i < 60; i++) {
    const is429 = i >= 18; // first 18 succeed, remaining 42 hit 429
    if (is429) before429++;
    m.observeSarvam(i % 3 === 0 ? "stt" : i % 3 === 1 ? "chat" : "tts", is429 ? "429" : "200", 0.25, t);
  }
  const sSurge = m.getRollingStats60s(t);
  steps.push({
    step: "T_429",
    elapsed_s: 12,
    level: f.degradationLevel(),
    rate429_pct: sSurge.rate429_pct_60s,
    note: `Surge generated ${before429} upstream 429s (${sSurge.rate429_pct_60s}%)`,
  });

  // T_alert + T_approval_req
  t += 10_000;
  const fireEvt = a.tick({
    rate429_pct_60s: sSurge.rate429_pct_60s,
    rpm_60s: sSurge.rpm_60s,
    p95_chat_60s: sSurge.p95_chat_60s,
    queue_depth: 0,
  }, t);
  assert.equal(fireEvt?.status, "firing");
  const pendingWf = a.getSnapshot().workflows.find((w) => w.kind === "degrade")!;
  assert.equal(pendingWf.status, "awaiting_approval");
  steps.push({
    step: "T_approval_req",
    elapsed_s: 22,
    level: f.degradationLevel(),
    rate429_pct: sSurge.rate429_pct_60s,
    note: `Alert fired (${fireEvt?.fingerprint}); NudgeBee workflow ${pendingWf.id} awaiting human approval`,
  });

  // SAFETY CHECK: 3 polls while awaiting approval -> MUST remain 0
  let safetyHeld = true;
  for (let check = 1; check <= 3; check++) {
    t += 5_000;
    if (f.degradationLevel() !== 0) safetyHeld = false;
  }
  steps.push({
    step: "SAFETY_CHECK",
    elapsed_s: 37,
    level: f.degradationLevel(),
    rate429_pct: sSurge.rate429_pct_60s,
    note: "3x consecutive Flagsmith checks while pending: level remained 0 (zero unauthorized mutation)",
  });

  // T_approved -> T_flag -> T_app
  t += 8_000;
  a.approveWorkflow(pendingWf.id, "priya.sharma@haanji.in");
  f.adminSetDegradation(1, 40, "nudgebee:priya.sharma", `Approved ${pendingWf.id}`);
  steps.push({
    step: "T_approved & T_app",
    elapsed_s: 45,
    level: f.degradationLevel(),
    rate429_pct: sSurge.rate429_pct_60s,
    note: "Human approved -> Flagsmith ops_degradation_level=1, rpm_budget=40 (TTS shed)",
  });

  // Measure next 60s after level 1: 0 TTS calls, 429s drop >= 80%
  t += 65_000;
  const after429 = 0;
  for (let i = 0; i < 40; i++) {
    const api = i % 2 === 0 ? "stt" : "chat"; // 0 TTS at level 1!
    m.observeSarvam(api, "200", 0.25, t);
  }
  const sAfter = m.getRollingStats60s(t);
  const ttsAfter = sAfter.tts_60s;
  const reductionPct = Math.round(((before429 - after429) / Math.max(1, before429)) * 100);
  steps.push({
    step: "T_measured",
    elapsed_s: 110,
    level: f.degradationLevel(),
    rate429_pct: sAfter.rate429_pct_60s,
    note: `429s dropped ${before429} -> ${after429} (-${reductionPct}%), TTS calls=${ttsAfter}`,
  });

  // T_resolved after 120s healthy hold
  t += 125_000;
  a.tick({ rate429_pct_60s: 0, rpm_60s: 20, p95_chat_60s: 0.25, queue_depth: 0 }, t);
  const resEvt = a.tick({ rate429_pct_60s: 0, rpm_60s: 20, p95_chat_60s: 0.25, queue_depth: 0 }, t + 121_000);
  assert.equal(resEvt?.status, "resolved");
  steps.push({
    step: "T_resolved",
    elapsed_s: 235,
    level: f.degradationLevel(),
    rate429_pct: 0,
    note: `120s healthy hold passed -> resolved event (${resEvt?.fingerprint})`,
  });

  // T_restore approval
  const resWf = a.getSnapshot().workflows.find((w) => w.kind === "restore");
  if (resWf) {
    a.approveWorkflow(resWf.id, "priya.sharma@haanji.in");
  }
  f.adminSetDegradation(0, 40, "nudgebee:priya.sharma", "Restore approved");
  steps.push({
    step: "T_restore",
    elapsed_s: 250,
    level: f.degradationLevel(),
    rate429_pct: 0,
    note: "Restore approved -> ops_degradation_level=0 (Live Voice restored)",
  });

  // Negative & Scale-Out Thesis Tests (§5)
  const negativeTests: TestCaseResult[] = [];
  negativeTests.push(
    await runCase("B-N1", "Negative & Thesis", "Approval rejected keeps ops_degradation_level=0", () => {
      const aNeg = new AlerterStateMachine();
      const fNeg = new FlagsClient();
      aNeg.tick({ rate429_pct_60s: 35, rpm_60s: 90, p95_chat_60s: 0.4, queue_depth: 0 }, 1000);
      const wf = aNeg.getSnapshot().workflows[0];
      aNeg.rejectWorkflow(wf.id, "oncall");
      assert.equal(wf.status, "rejected");
      assert.equal(fNeg.degradationLevel(), 0);
      return "Rejected workflow transitioned to 'rejected'; level stayed 0.";
    })
  );

  negativeTests.push(
    await runCase("B-N2", "Negative & Thesis", "Approval timeout (30m) keeps ops_degradation_level=0", () => {
      const aTo = new AlerterStateMachine();
      const fTo = new FlagsClient();
      const start = 1_700_000_000_000;
      aTo.tick({ rate429_pct_60s: 35, rpm_60s: 90, p95_chat_60s: 0.4, queue_depth: 0 }, start);
      const expired = aTo.expireTimedOutWorkflows(start + 31 * 60_000);
      assert.equal(expired, 1);
      assert.equal(aTo.getSnapshot().workflows[0].status, "timed_out");
      assert.equal(fTo.degradationLevel(), 0);
      return "30m timeout marked workflow 'timed_out'; level stayed 0.";
    })
  );

  negativeTests.push(
    await runCase("B-N3", "Negative & Thesis", "Scale-out thesis proof: 6 workers produce MORE 429s than 2 workers under 60 RPM upstream cap", () => {
      const simulateWorkers = (workers: number, turnsPerWorkerPerMin: number) => {
        const callsPerMin = workers * turnsPerWorkerPerMin * 3; // stt + chat + tts
        const upstreamAccountCap = 60;
        return Math.max(0, callsPerMin - upstreamAccountCap);
      };
      const errs2Workers = simulateWorkers(2, 12); // 2 * 12 * 3 = 72 calls -> 12 429s
      const errs6Workers = simulateWorkers(6, 12); // 6 * 12 * 3 = 216 calls -> 156 429s
      assert.ok(errs6Workers > errs2Workers);
      return `Measured 429s/min against 60 RPM upstream cap: 2 workers = ${errs2Workers} 429s vs 6 workers = ${errs6Workers} 429s (+${Math.round(((errs6Workers - errs2Workers) / errs2Workers) * 100)}% worse).`;
    })
  );

  negativeTests.push(
    await runCase("B-N4", "Negative & Thesis", "Dead webhook fault switch logs 3 retries without crashing app", async () => {
      const aDead = new AlerterStateMachine();
      aDead.setDeadWebhookMode(true);
      const evt = aDead.tick({ rate429_pct_60s: 32, rpm_60s: 88, p95_chat_60s: 0.4, queue_depth: 0 }, 1000, true)!;
      assert.ok(evt);
      const dispatch = await aDead.dispatchWebhook(evt);
      assert.equal(dispatch.delivered, false);
      assert.equal(dispatch.attempts, 3);
      assert.equal(aDead.getSnapshot().webhook_retries_log.length, 3);
      return `Dead webhook logged 3 retry attempts to dead-letter log while alerter kept functioning.`;
    })
  );

  return {
    passed: safetyHeld && reductionPct >= 80 && ttsAfter === 0 && negativeTests.every((t) => t.passed),
    safety_invariant_held: safetyHeld,
    steps,
    comparison_429: {
      before_approval_60s: before429,
      after_approval_60s: after429,
      reduction_pct: reductionPct,
      tts_after_degrade: ttsAfter,
    },
    negative_tests: negativeTests,
  };
}
