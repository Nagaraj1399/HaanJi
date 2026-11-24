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
        <div className="py-12 text-center glass-card">
          <p className="text-sm text-[#F5EDE1]/70 max-w-2xl mx-auto px-4">{emptyLabel}</p>
          <button
            type="button"
            onClick={onRun}
            disabled={running !== null}
            className="mt-5 min-h-[44px] px-6 rounded-full bg-[#F5EDE1] text-[#14050A] text-xs font-semibold hover:bg-[#E6CFA3] inline-flex items-center gap-2"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Run Suite Now</span>
          </button>
        </div>
      );
    }

    const passedCount = list.filter((x) => x.passed).length;
    return (
      <div className="glass-card overflow-hidden">
        <div className="px-6 py-4 bg-[#14050A]/65 border-b hairline-gold flex items-center justify-between">
          <span className="text-sm font-medium text-[#F5EDE1]">
            {passedCount} / {list.length} assertions passed
          </span>
          <button
            type="button"
            onClick={onRun}
            disabled={running !== null}
            className="min-h-[36px] px-4 rounded-full border border-[#B8925A]/45 text-xs text-[#E6CFA3] hover:bg-[#B8925A]/15 inline-flex items-center gap-1.5"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Re-run</span>
          </button>
        </div>
        <div className="divide-y divide-[#B8925A]/15">
          {list.map((tc) => (
            <div key={tc.id} className="px-6 py-4 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                {tc.passed ? (
                  <CheckCircle2 className="w-4 h-4 text-[#8FB39A] mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-[#C98A8A] mt-0.5 shrink-0" />
                )}
                <div>
                  <p className="text-sm font-medium text-[#F5EDE1]">
                    <span className="font-mono text-xs text-[#E6CFA3] mr-2">{tc.id}</span>
                    {tc.name}
                  </p>
                  <p className="mt-1 text-xs text-[#F5EDE1]/65 font-mono">{tc.details}</p>
                </div>
              </div>
              <span className="font-mono text-xs tabular-nums text-[#F5EDE1]/65 whitespace-nowrap">
                {tc.duration_ms} ms
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 space-y-8 text-[#F5EDE1]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b hairline-gold">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">
            Verification &amp; Golden Set
          </p>
          <h1 className="mt-1.5 font-display text-3xl sm:text-4xl font-light text-[#F5EDE1]">
            Automated Verification &amp; Test Bench
          </h1>
          <p className="mt-1.5 text-sm text-[#F5EDE1]/70">
            Executes real assertions against HaanJi&rsquo;s brain, deterministic store, rate limiter, alerter state machine, and HTTP security boundaries.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={runAllSuites}
            disabled={running !== null}
            className="min-h-[44px] px-5 rounded-full bg-[#F5EDE1] text-[#14050A] text-xs font-semibold hover:bg-[#E6CFA3] disabled:opacity-55 inline-flex items-center gap-2 whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{running === "all" ? "Running All Suites..." : "Run All 5 Suites"}</span>
          </button>

          <button
            type="button"
            onClick={downloadReport}
            disabled={!aUnit && !golden && !bUnit && !causal && !secTests}
            className="min-h-[44px] px-4 rounded-full border border-[#B8925A]/45 text-xs text-[#E6CFA3] hover:bg-[#B8925A]/15 disabled:opacity-40 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export REPORT.md</span>
          </button>
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-2xl border border-[#B8925A]/20 bg-[#14050A]/60">
          {[
            { id: "a-unit", label: `Track A Unit (${aUnit ? `${aUnit.filter((x) => x.passed).length}/${aUnit.length}` : "11"})` },
            { id: "golden", label: `Golden Set (${golden ? `${golden.cases.filter((x) => x.passed).length}/30` : "30"})` },
            { id: "b-unit", label: `Track B Ops Unit (${bUnit ? `${bUnit.filter((x) => x.passed).length}/${bUnit.length}` : "6"})` },
            { id: "causal", label: `Causal Incident Loop (${causal ? (causal.passed ? "PASS" : "FAIL") : "Proof"})` },
            { id: "security", label: `API & Secret Scan (${secTests ? `${secTests.filter((x) => x.passed).length}/${secTests.length}` : "6"})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSuite(tab.id as typeof activeSuite)}
              className={`px-3.5 py-2 text-xs font-medium rounded-xl transition-colors whitespace-nowrap shrink-0 ${
                activeSuite === tab.id
                  ? "bg-[#F5EDE1] text-[#14050A] font-semibold"
                  : "text-[#F5EDE1]/70 hover:text-[#E6CFA3]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeSuite === "golden" && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#F5EDE1]/65">Evaluator Mode:</span>
            <div className="flex items-center p-1 rounded-xl border border-[#B8925A]/20 bg-[#14050A]/60">
              <button
                type="button"
                onClick={() => setGoldenMode("replay")}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
                  goldenMode === "replay"
                    ? "bg-[#F5EDE1] text-[#14050A]"
                    : "text-[#F5EDE1]/70"
                }`}
              >
                Offline Fallback
              </button>
              <button
                type="button"
                onClick={() => setGoldenMode("live")}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
                  goldenMode === "live"
                    ? "bg-[#F5EDE1] text-[#14050A]"
                    : "text-[#F5EDE1]/70"
                }`}
              >
                Live Gemini API
              </button>
            </div>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="rounded-2xl border border-[#C98A8A]/50 bg-[#14050A]/80 px-4 py-3 text-sm text-[#C98A8A]">
          {errorMsg}
        </div>
      )}

      {activeSuite === "a-unit" &&
        renderTestList(
          aUnit,
          runTrackAUnit,
          "Runs 11 Track A unit checks: schema warnings, RSVP merge, AST purity on 50 random rows, grounding guard (Latin/Kannada/Tamil), 1000-gid A/B split, 429/402 retry rules, L0/L1/L2 worker behavior, single-fire conversion, 413 audio guard, 2-step confirmation, and non-TTS language isolation."
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
          "Fires live HTTP requests to verify <300ms /api/turn, 403 on bad Host key, 401 on missing X-Ops-Token, scans client & bundle files for secret/token leaks, and verifies zero dev terms in GuestConcierge."
        )}

      {activeSuite === "golden" && (
        <div className="space-y-6">
          {!golden ? (
            <div className="py-12 text-center glass-card">
              <p className="text-sm text-[#F5EDE1]/70">
                Evaluates 30 labelled multilingual cases (8 factual, 6 RSVP, 6 unanswerable, 4 injection, 4 mixed, 2 off-topic) against the frozen wedding card.
              </p>
              <button
                type="button"
                onClick={() => runGolden()}
                disabled={running !== null}
                className="mt-5 min-h-[44px] px-6 rounded-full bg-[#F5EDE1] text-[#14050A] text-xs font-semibold hover:bg-[#E6CFA3] inline-flex items-center gap-2"
              >
                <Play className="w-3.5 h-3.5" />
                <span>{running === "golden" ? "Evaluating 30 Cases..." : `Run 30-Case Golden Set (${goldenMode})`}</span>
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
                  <div key={kpi.label} className="glass-card p-4">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-[#E6CFA3]">{kpi.label}</p>
                    <p
                      className={`mt-1.5 font-mono text-xl font-semibold tabular-nums ${
                        kpi.ok ? "text-[#8FB39A]" : "text-[#C98A8A]"
                      }`}
                    >
                      {kpi.val}
                    </p>
                    <p className="mt-0.5 text-xs text-[#F5EDE1]/65">{kpi.sub}</p>
                  </div>
                ))}
              </div>

              <div className="glass-card overflow-hidden">
                <div className="px-6 py-4 bg-[#14050A]/65 border-b hairline-gold flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {["all", "factual", "rsvp", "unanswerable", "injection", "mixed", "off_topic"].map(
                      (cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setGoldenFilter(cat)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize ${
                            goldenFilter === cat
                              ? "bg-[#F5EDE1] text-[#14050A]"
                              : "text-[#F5EDE1]/70 hover:text-[#E6CFA3]"
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
                    className="h-9 px-4 rounded-full border border-[#B8925A]/45 text-xs text-[#E6CFA3] hover:bg-[#B8925A]/15"
                  >
                    Re-run ({goldenMode})
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b hairline-gold text-[11px] uppercase tracking-[0.14em] text-[#E6CFA3]">
                        <th className="py-2.5 px-4">ID</th>
                        <th className="py-2.5 px-3">Category</th>
                        <th className="py-2.5 px-3">Lang</th>
                        <th className="py-2.5 px-3">Input</th>
                        <th className="py-2.5 px-3">Intent</th>
                        <th className="py-2.5 px-3">Answer Excerpt</th>
                        <th className="py-2.5 px-4 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#B8925A]/15">
                      {golden.cases
                        .filter((c) => goldenFilter === "all" || c.category === goldenFilter)
                        .map((c) => (
                          <tr key={c.id} className="hover:bg-[#B8925A]/5 align-top">
                            <td className="py-3 px-4 font-mono text-[#E6CFA3]">{c.id}</td>
                            <td className="py-3 px-3 capitalize text-[#F5EDE1]/75">{c.category}</td>
                            <td className="py-3 px-3 font-mono text-[#F5EDE1]/75">{c.language}</td>
                            <td className="py-3 px-3 text-[#F5EDE1] max-w-xs">{c.input}</td>
                            <td className="py-3 px-3 font-mono text-[#E6CFA3]">{c.actual_intent}</td>
                            <td className="py-3 px-3 text-[#F5EDE1]/75 max-w-sm">{c.answer_text}</td>
                            <td className="py-3 px-4 text-right font-mono font-semibold whitespace-nowrap">
                              {c.passed ? (
                                <span className="text-[#8FB39A]">PASS</span>
                              ) : (
                                <span className="text-[#C98A8A]">FAIL</span>
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
            <div className="py-12 text-center glass-card">
              <p className="text-sm text-[#F5EDE1]/70 max-w-2xl mx-auto px-4">
                Proves the complete causal incident loop: surge &rarr; 429s &rarr; alert &rarr; pending human approval (3x safety checks confirm level=0) &rarr; approve &rarr; 429 drop &ge; 80% &amp; TTS=0 &rarr; resolved &rarr; restore + 2 vs 6 worker scale-out proof.
              </p>
              <button
                type="button"
                onClick={runCausalLoop}
                disabled={running !== null}
                className="mt-5 min-h-[44px] px-6 rounded-full bg-[#F5EDE1] text-[#14050A] text-xs font-semibold hover:bg-[#E6CFA3] inline-flex items-center gap-2"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Run Causal Loop &amp; Scale-Out Proof</span>
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="glass-card p-4">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-[#E6CFA3]">Safety Invariant</p>
                  <p className="mt-1.5 font-mono text-lg font-semibold text-[#8FB39A]">
                    {causal.safety_invariant_held ? "HELD (0 before approval)" : "VIOLATED"}
                  </p>
                </div>
                <div className="glass-card p-4">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-[#E6CFA3]">429s Before Approval</p>
                  <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-[#C98A8A]">
                    {causal.comparison_429.before_approval_60s}
                  </p>
                </div>
                <div className="glass-card p-4">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-[#E6CFA3]">429s After Degrade</p>
                  <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-[#8FB39A]">
                    {causal.comparison_429.after_approval_60s} (-{causal.comparison_429.reduction_pct}%)
                  </p>
                </div>
                <div className="glass-card p-4">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-[#E6CFA3]">TTS After Degrade</p>
                  <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-[#F5EDE1]">
                    {causal.comparison_429.tts_after_degrade} calls
                  </p>
                </div>
              </div>

              <div className="glass-card overflow-hidden">
                <div className="px-6 py-4 bg-[#14050A]/65 border-b hairline-gold flex items-center justify-between">
                  <span className="text-sm font-medium text-[#F5EDE1]">
                    Causal Timeline Verification
                  </span>
                  <button
                    type="button"
                    onClick={runCausalLoop}
                    className="min-h-[36px] px-4 rounded-full border border-[#B8925A]/45 text-xs text-[#E6CFA3] hover:bg-[#B8925A]/15"
                  >
                    Re-run Proof
                  </button>
                </div>
                <div className="divide-y divide-[#B8925A]/15">
                  {causal.steps.map((s) => (
                    <div
                      key={s.step}
                      className="px-6 py-3.5 flex flex-wrap items-center justify-between gap-4 text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono tabular-nums text-[#E6CFA3] w-12">
                          +{s.elapsed_s}s
                        </span>
                        <span className="font-mono font-semibold text-[#F5EDE1] w-36">
                          {s.step}
                        </span>
                        <span className="text-[#F5EDE1]/75">{s.note}</span>
                      </div>
                      <span className="font-mono tabular-nums text-[#E6CFA3]">
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
