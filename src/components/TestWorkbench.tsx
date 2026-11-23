import { useState } from "react";
import { Play, CheckCircle2, XCircle, Download, ShieldCheck } from "lucide-react";

interface TestCaseResult {
  id: string;
  suite: string;
  name: string;
  passed: boolean;
  duration_ms: number;
  details: string;
}

interface GoldenReport {
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
  cases: Array<{
    id: string;
    category: string;
    language: string;
    input: string;
    expected_intent: string;
    actual_intent: string;
    grounding_ok: boolean;
    injection_ok: boolean;
    language_ok: boolean;
    answer_text: string;
    latency_ms: number;
    passed: boolean;
    notes: string;
  }>;
}

interface CausalLoopReport {
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
}

export function TestWorkbench() {
  const [activeSuite, setActiveSuite] = useState<
    "a-unit" | "golden" | "b-unit" | "causal" | "security"
  >("a-unit");
  const [goldenMode, setGoldenMode] = useState<"replay" | "live">("replay");

  const [aUnit, setAUnit] = useState<TestCaseResult[] | null>(null);
  const [bUnit, setBUnit] = useState<TestCaseResult[] | null>(null);
  const [secTests, setSecTests] = useState<TestCaseResult[] | null>(null);
  const [golden, setGolden] = useState<GoldenReport | null>(null);
  const [causal, setCausal] = useState<CausalLoopReport | null>(null);

  const [running, setRunning] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [goldenFilter, setGoldenFilter] = useState<string>("all");

  const runTrackAUnit = async () => {
    setRunning("a-unit");
    setErrorMsg(null);
    try {
      const r = await fetch("/api/tests/track-a-unit", { method: "POST" });
      const j = await r.json();
      setAUnit(j.results);
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setRunning(null);
    }
  };

  const runGolden = async (modeOverride?: "replay" | "live") => {
    const m = modeOverride ?? goldenMode;
    setRunning("golden");
    setErrorMsg(null);
    try {
      const r = await fetch("/api/tests/golden", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: m }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setGolden(j);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
    }
  };

  const runTrackBUnit = async () => {
    setRunning("b-unit");
    setErrorMsg(null);
    try {
      const r = await fetch("/api/tests/track-b-unit", { method: "POST" });
      const j = await r.json();
      setBUnit(j.results);
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setRunning(null);
    }
  };

  const runCausalLoop = async () => {
    setRunning("causal");
    setErrorMsg(null);
    try {
      const r = await fetch("/api/tests/causal-loop", { method: "POST" });
      const j = await r.json();
      setCausal(j);
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setRunning(null);
    }
  };

  const runSecurityScan = async () => {
    setRunning("security");
    setErrorMsg(null);
    try {
      const r = await fetch("/api/tests/api-security", { method: "POST" });
      const j = await r.json();
      setSecTests(j.results);
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setRunning(null);
    }
  };

  const runAllSuites = async () => {
    setRunning("all");
    setErrorMsg(null);
    try {
      const [aRes, bRes, gRes, cRes, sRes] = await Promise.all([
        fetch("/api/tests/track-a-unit", { method: "POST" }).then((r) => r.json()),
        fetch("/api/tests/track-b-unit", { method: "POST" }).then((r) => r.json()),
        fetch("/api/tests/golden", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: goldenMode }),
        }).then((r) => r.json()),
        fetch("/api/tests/causal-loop", { method: "POST" }).then((r) => r.json()),
        fetch("/api/tests/api-security", { method: "POST" }).then((r) => r.json()),
      ]);
      setAUnit(aRes.results);
      setBUnit(bRes.results);
      if (gRes.cases) setGolden(gRes);
      setCausal(cRes);
      setSecTests(sRes.results);
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setRunning(null);
    }
  };

  const downloadReport = () => {
    const lines = [
      `# HaanJi Verification Report (${new Date().toISOString()})`,
      "",
      `## Track A Unit Tests (${aUnit ? `${aUnit.filter((x) => x.passed).length}/${aUnit.length}` : "Not run"})`,
      ...(aUnit || []).map((t) => `- [${t.passed ? "PASS" : "FAIL"}] ${t.id} ${t.name}: ${t.details}`),
      "",
      `## Track A Golden Set (${golden ? `mode=${golden.mode}, total=${golden.total}` : "Not run"})`,
      ...(golden
        ? [
            `- Intent Accuracy: ${golden.metrics.intent_accuracy_pct}%`,
            `- RSVP Field Accuracy: ${golden.metrics.rsvp_field_accuracy_pct}%`,
            `- Grounding Precision (Gate 100%): ${golden.metrics.grounding_precision_pct}%`,
            `- Unanswered Recall (Gate >=5/6): ${golden.metrics.unanswered_recall}`,
            `- Injection Resistance (Gate 4/4): ${golden.metrics.injection_resistance}`,
            `- Language Match (Gate >=90%): ${golden.metrics.language_match_pct}%`,
            `- Median / P95 Latency: ${golden.metrics.median_latency_ms}ms / ${golden.metrics.p95_latency_ms}ms`,
          ]
        : []),
      "",
      `## Track B Ops Unit Tests (${bUnit ? `${bUnit.filter((x) => x.passed).length}/${bUnit.length}` : "Not run"})`,
      ...(bUnit || []).map((t) => `- [${t.passed ? "PASS" : "FAIL"}] ${t.id} ${t.name}: ${t.details}`),
      "",
      `## Track B Causal Incident Loop`,
      ...(causal
        ? [
            `- Safety Invariant Held: ${causal.safety_invariant_held}`,
            `- 429 Reduction: ${causal.comparison_429.before_approval_60s} -> ${causal.comparison_429.after_approval_60s} (-${causal.comparison_429.reduction_pct}%)`,
            `- TTS After Degrade: ${causal.comparison_429.tts_after_degrade}`,
            ...causal.negative_tests.map((t) => `- [${t.passed ? "PASS" : "FAIL"}] ${t.id} ${t.name}: ${t.details}`),
          ]
        : []),
      "",
      `## API & Secret-Leak Scan (${secTests ? `${secTests.filter((x) => x.passed).length}/${secTests.length}` : "Not run"})`,
      ...(secTests || []).map((t) => `- [${t.passed ? "PASS" : "FAIL"}] ${t.id} ${t.name}: ${t.details}`),
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "HAANJI-TEST-REPORT.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderTestList = (list: TestCaseResult[] | null, onRun: () => void, emptyLabel: string) => {
    if (!list) {
      return (
        <div className="py-12 text-center border border-zinc-200 rounded-2xl bg-white">
          <p className="text-sm text-zinc-600">{emptyLabel}</p>
          <button
            type="button"
            onClick={onRun}
            disabled={running !== null}
            className="mt-4 h-10 px-5 rounded-lg bg-[#C2410C] text-white text-xs font-medium hover:bg-[#9A3412] inline-flex items-center gap-2"
          >
            <Play className="w-3.5 h-3.5" />
            Run Suite Now
          </button>
        </div>
      );
    }

    const passedCount = list.filter((x) => x.passed).length;
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
        <div className="px-6 py-4 bg-[#FAF9F6] border-b border-zinc-200 flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-900">
            {passedCount} / {list.length} assertions passed
          </span>
          <button
            type="button"
            onClick={onRun}
            disabled={running !== null}
            className="h-9 px-3.5 rounded-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-800 hover:bg-zinc-50 inline-flex items-center gap-1.5"
          >
            <Play className="w-3.5 h-3.5" />
            Re-run
          </button>
        </div>
        <div className="divide-y divide-zinc-200">
          {list.map((tc) => (
            <div key={tc.id} className="px-6 py-4 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                {tc.passed ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-700 mt-0.5 shrink-0" />
                )}
                <div>
                  <p className="text-sm font-medium text-zinc-900">
                    <span className="font-mono text-xs text-zinc-500 mr-2">{tc.id}</span>
                    {tc.name}
                  </p>
                  <p className="mt-1 text-xs text-zinc-600 font-mono">{tc.details}</p>
                </div>
              </div>
              <span className="font-mono text-xs tabular-nums text-zinc-500 whitespace-nowrap">
                {tc.duration_ms} ms
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-zinc-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-zinc-900">
            Automated Verification &amp; Golden Set Bench
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            Executes real assertions against HaanJi&rsquo;s brain, deterministic store, rate limiter, alerter state machine, and HTTP security boundaries.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={runAllSuites}
            disabled={running !== null}
            className="h-10 px-5 rounded-lg bg-[#C2410C] text-white text-xs font-medium hover:bg-[#9A3412] disabled:opacity-60 inline-flex items-center gap-2 whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{running === "all" ? "Running All Suites…" : "Run All 5 Suites"}</span>
          </button>

          <button
            type="button"
            onClick={downloadReport}
            disabled={!aUnit && !golden && !bUnit && !causal && !secTests}
            className="h-10 px-4 rounded-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Export REPORT.md
          </button>
        </div>
      </div>

      {/* Sub-navigation Segmented Control */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-zinc-100 rounded-xl">
          {[
            { id: "a-unit", label: `Track A Unit (${aUnit ? `${aUnit.filter((x) => x.passed).length}/${aUnit.length}` : "9"})` },
            { id: "golden", label: `Golden Set (${golden ? `${golden.cases.filter((x) => x.passed).length}/30` : "30"})` },
            { id: "b-unit", label: `Track B Ops Unit (${bUnit ? `${bUnit.filter((x) => x.passed).length}/${bUnit.length}` : "6"})` },
            { id: "causal", label: `Causal Incident Loop (${causal ? (causal.passed ? "PASS" : "FAIL") : "Proof"})` },
            { id: "security", label: `API & Secret Scan (${secTests ? `${secTests.filter((x) => x.passed).length}/${secTests.length}` : "4"})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSuite(tab.id as typeof activeSuite)}
              className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                activeSuite === tab.id
                  ? "bg-white text-zinc-900 shadow-sm"
                  : "text-zinc-600 hover:text-zinc-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeSuite === "golden" && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">Evaluator Mode:</span>
            <div className="flex items-center p-1 bg-zinc-100 rounded-lg">
              <button
                type="button"
                onClick={() => setGoldenMode("replay")}
                className={`px-2.5 py-1 text-xs font-medium rounded-md ${
                  goldenMode === "replay" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600"
                }`}
              >
                Replay (Offline)
              </button>
              <button
                type="button"
                onClick={() => setGoldenMode("live")}
                className={`px-2.5 py-1 text-xs font-medium rounded-md ${
                  goldenMode === "live" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600"
                }`}
              >
                Live Gemini API
              </button>
            </div>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {errorMsg}
        </div>
      )}

      {/* Suite Views */}
      {activeSuite === "a-unit" &&
        renderTestList(
          aUnit,
          runTrackAUnit,
          "Runs 9 Track A unit checks: schema warnings, RSVP merge, AST purity on 50 random rows, grounding guard, 1000-gid A/B split, 429/402 retry rules, L0/L1/L2 worker behavior, single-fire conversion, and 413 audio guard."
        )}

      {activeSuite === "b-unit" &&
        renderTestList(
          bUnit,
          runTrackBUnit,
          "Runs 6 Track B ops checks: sliding-window concurrency, alerter 119s/121s/5m state machine, single-leader 30s failover, admin bounds, timingSafeEqual AST check, and Prometheus exposition."
        )}

      {activeSuite === "security" &&
        renderTestList(
          secTests,
          runSecurityScan,
          "Fires live HTTP requests to verify <300ms /api/turn, 403 on bad Host key, 401 on missing X-Ops-Token, and scans every response + client file for secret leaks."
        )}

      {activeSuite === "golden" && (
        <div className="space-y-6">
          {!golden ? (
            <div className="py-12 text-center border border-zinc-200 rounded-2xl bg-white">
              <p className="text-sm text-zinc-600">
                Evaluates 30 labelled multilingual cases (8 factual, 6 RSVP, 6 unanswerable, 4 injection, 4 mixed, 2 off-topic) against the frozen wedding card.
              </p>
              <button
                type="button"
                onClick={() => runGolden()}
                disabled={running !== null}
                className="mt-4 h-10 px-5 rounded-lg bg-[#C2410C] text-white text-xs font-medium hover:bg-[#9A3412] inline-flex items-center gap-2"
              >
                <Play className="w-3.5 h-3.5" />
                {running === "golden" ? "Evaluating 30 Cases…" : `Run 30-Case Golden Set (${goldenMode})`}
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-4">
                {[
                  {
                    label: "Grounding Precision",
                    val: `${golden.metrics.grounding_precision_pct}%`,
                    sub: "Gate: 100%",
                    ok: golden.metrics.grounding_precision_pct === 100,
                  },
                  {
                    label: "Unanswered Recall",
                    val: golden.metrics.unanswered_recall,
                    sub: "Gate: ≥ 5/6",
                    ok: golden.metrics.unanswered_recall_pass,
                  },
                  {
                    label: "Injection Resistance",
                    val: golden.metrics.injection_resistance,
                    sub: "Gate: 4/4",
                    ok: golden.metrics.injection_resistance_pass,
                  },
                  {
                    label: "Language Match",
                    val: `${golden.metrics.language_match_pct}%`,
                    sub: "Gate: ≥ 90%",
                    ok: golden.metrics.language_match_pct >= 90,
                  },
                  {
                    label: "Intent / RSVP",
                    val: `${golden.metrics.intent_accuracy_pct}%`,
                    sub: `RSVP ${golden.metrics.rsvp_field_accuracy_pct}%`,
                    ok: true,
                  },
                  {
                    label: "Latency (p50 / p95)",
                    val: `${golden.metrics.median_latency_ms}ms`,
                    sub: `p95 ${golden.metrics.p95_latency_ms}ms (${golden.mode})`,
                    ok: true,
                  },
                ].map((kpi) => (
                  <div key={kpi.label} className="rounded-xl border border-zinc-200 bg-white p-4">
                    <p className="text-xs text-zinc-500">{kpi.label}</p>
                    <p
                      className={`mt-1 font-mono text-xl font-semibold tabular-nums ${
                        kpi.ok ? "text-emerald-700" : "text-red-700"
                      }`}
                    >
                      {kpi.val}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">{kpi.sub}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
                <div className="px-6 py-3.5 bg-[#FAF9F6] border-b border-zinc-200 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {["all", "factual", "rsvp", "unanswerable", "injection", "mixed", "off_topic"].map(
                      (cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setGoldenFilter(cat)}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize ${
                            goldenFilter === cat
                              ? "bg-zinc-900 text-white"
                              : "text-zinc-600 hover:bg-zinc-200/70"
                          }`}
                        >
                          {cat.replace("_", " ")}
                        </button>
                      )
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => runGolden()}
                    disabled={running !== null}
                    className="h-8 px-3 rounded-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-800 hover:bg-zinc-50"
                  >
                    Re-run ({goldenMode})
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 text-zinc-500">
                        <th className="py-2.5 px-4">ID</th>
                        <th className="py-2.5 px-3">Category</th>
                        <th className="py-2.5 px-3">Lang</th>
                        <th className="py-2.5 px-3">Input</th>
                        <th className="py-2.5 px-3">Intent</th>
                        <th className="py-2.5 px-3">Answer Excerpt</th>
                        <th className="py-2.5 px-4 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {golden.cases
                        .filter((c) => goldenFilter === "all" || c.category === goldenFilter)
                        .map((c) => (
                          <tr key={c.id} className="hover:bg-zinc-50/70 align-top">
                            <td className="py-3 px-4 font-mono text-zinc-500">{c.id}</td>
                            <td className="py-3 px-3 capitalize text-zinc-700">{c.category}</td>
                            <td className="py-3 px-3 font-mono text-zinc-600">{c.language}</td>
                            <td className="py-3 px-3 text-zinc-900 max-w-xs">{c.input}</td>
                            <td className="py-3 px-3 font-mono text-zinc-700">
                              {c.actual_intent}
                            </td>
                            <td className="py-3 px-3 text-zinc-600 max-w-sm">{c.answer_text}</td>
                            <td className="py-3 px-4 text-right font-mono font-semibold whitespace-nowrap">
                              {c.passed ? (
                                <span className="text-emerald-700">PASS</span>
                              ) : (
                                <span className="text-red-700">FAIL</span>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {activeSuite === "causal" && (
        <div className="space-y-6">
          {!causal ? (
            <div className="py-12 text-center border border-zinc-200 rounded-2xl bg-white">
              <p className="text-sm text-zinc-600">
                Proves the complete causal incident loop: surge → 429s → alert → pending human approval (3x safety checks confirm level=0) → approve → 429 drop ≥ 80% &amp; TTS=0 → resolved → restore + 2 vs 6 worker scale-out proof.
              </p>
              <button
                type="button"
                onClick={runCausalLoop}
                disabled={running !== null}
                className="mt-4 h-10 px-5 rounded-lg bg-[#C2410C] text-white text-xs font-medium hover:bg-[#9A3412] inline-flex items-center gap-2"
              >
                <ShieldCheck className="w-4 h-4" />
                Run Causal Loop &amp; Scale-Out Proof
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="rounded-xl border border-zinc-200 bg-white p-4">
                  <p className="text-xs text-zinc-500">Safety Invariant</p>
                  <p className="mt-1 font-mono text-lg font-semibold text-emerald-700">
                    {causal.safety_invariant_held ? "HELD (0 before approval)" : "VIOLATED"}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-white p-4">
                  <p className="text-xs text-zinc-500">429s Before Approval</p>
                  <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-red-700">
                    {causal.comparison_429.before_approval_60s}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-white p-4">
                  <p className="text-xs text-zinc-500">429s After Degrade</p>
                  <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-emerald-700">
                    {causal.comparison_429.after_approval_60s} (-{causal.comparison_429.reduction_pct}%)
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-white p-4">
                  <p className="text-xs text-zinc-500">TTS After Degrade</p>
                  <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-zinc-900">
                    {causal.comparison_429.tts_after_degrade} calls
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
                <div className="px-6 py-3.5 bg-[#FAF9F6] border-b border-zinc-200 flex items-center justify-between">
                  <span className="text-sm font-semibold text-zinc-900">
                    Causal Timeline Verification
                  </span>
                  <button
                    type="button"
                    onClick={runCausalLoop}
                    className="h-8 px-3 rounded-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-800 hover:bg-zinc-50"
                  >
                    Re-run Proof
                  </button>
                </div>
                <div className="divide-y divide-zinc-200">
                  {causal.steps.map((s) => (
                    <div key={s.step} className="px-6 py-3.5 flex flex-wrap items-center justify-between gap-4 text-xs">
                      <div className="flex items-center gap-3">
                        <span className="font-mono tabular-nums text-zinc-500 w-12">
                          +{s.elapsed_s}s
                        </span>
                        <span className="font-mono font-semibold text-zinc-900 w-36">
                          {s.step}
                        </span>
                        <span className="text-zinc-700">{s.note}</span>
                      </div>
                      <span className="font-mono tabular-nums text-zinc-600">
                        L{s.level} · {s.rate429_pct}% 429s
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {renderTestList(causal.negative_tests, runCausalLoop, "")}
            </>
          )}
        </div>
      )}
    </div>
  );
}
