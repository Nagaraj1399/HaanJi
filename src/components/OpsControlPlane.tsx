import { useEffect, useState } from "react";
import { Flame, ShieldAlert, Check, XCircle, RotateCcw, Terminal } from "lucide-react";

interface OpsState {
  level: 0 | 1 | 2;
  rpm_budget: number;
  hard_cap: number;
  flagsmith_unreachable: boolean;
  rpm_60s: number;
  sarvam_429_last_60s: number;
  rate429_pct_60s: number;
  p95_chat_60s: number;
  tts_60s: number;
  queue_depth: number;
  timeseries: Array<{ t: string; rpm: number; rate429Pct: number; tts: number }>;
  alerter: {
    status: "ok" | "firing";
    fingerprint: string | null;
    active_leader_id: string;
    events: Array<{
      id: string;
      fingerprint: string;
      status: "firing" | "resolved";
      title: string;
      severity: string;
      timestamp: string;
    }>;
    workflows: Array<{
      id: string;
      kind: "degrade" | "restore";
      fingerprint: string;
      status: string;
      rule_name: string;
      created_at: string;
      timeout_minutes: number;
      evidence: {
        pod_status: string;
        cpu_usage: string;
        restarts: number;
        worker_log_excerpt: string;
        recommendation: string;
      };
      proposed_action: {
        level: number;
        rpm_budget: number;
        summary: string;
      };
      decided_by?: string;
    }>;
  };
  surge: {
    running: boolean;
    rate_per_min: number;
    duration_seconds: number;
    turns_sent: number;
    calls_attempted: number;
    calls_429: number;
    elapsed_seconds: number;
  };
  audit_log: Array<{
    id: string;
    timestamp: string;
    actor: string;
    reason: string;
    level: number;
    rpm_budget: number;
  }>;
  voice_reply: Record<string, boolean>;
}

function MiniSeriesChart({
  title,
  data,
  valueKey,
  maxVal,
  strokeColor,
  threshold,
  unit,
}: {
  title: string;
  data: Array<{ t: string; rpm: number; rate429Pct: number; tts: number }>;
  valueKey: "rpm" | "rate429Pct" | "tts";
  maxVal: number;
  strokeColor: string;
  threshold?: number;
  unit: string;
}) {
  const width = 400;
  const height = 110;
  const pts = data.map((d, i) => {
    const x = data.length > 1 ? (i / (data.length - 1)) * width : width;
    const val = Math.min(maxVal, d[valueKey]);
    const y = height - (val / Math.max(1, maxVal)) * (height - 14) - 6;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const latest = data.length ? data[data.length - 1][valueKey] : 0;
  const thresholdY =
    threshold !== undefined
      ? height - (Math.min(maxVal, threshold) / Math.max(1, maxVal)) * (height - 14) - 6
      : null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="text-xs font-medium text-zinc-600">{title}</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-zinc-900">
          {latest} {unit}
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-24 overflow-visible">
        {thresholdY !== null && (
          <line
            x1={0}
            y1={thresholdY}
            x2={width}
            y2={thresholdY}
            stroke="#DC2626"
            strokeDasharray="4 4"
            strokeWidth={1}
          />
        )}
        <polyline
          fill="none"
          stroke={strokeColor}
          strokeWidth={2}
          strokeLinejoin="round"
          points={pts.join(" ")}
        />
      </svg>
    </div>
  );
}

export function OpsControlPlane() {
  const [ops, setOps] = useState<OpsState | null>(null);
  const [metricsText, setMetricsText] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const fetchState = async () => {
    try {
      const res = await fetch("/api/ops-proxy/state");
      if (!res.ok) return;
      const json: OpsState = await res.json();
      setOps(json);
    } catch {
      // ignore transient poll
    }
  };

  useEffect(() => {
    void fetchState();
    const id = window.setInterval(fetchState, 2000);
    return () => window.clearInterval(id);
  }, []);

  const callAction = async (path: string, body?: object) => {
    setErrMsg(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await fetchState();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const loadPrometheusMetrics = async () => {
    const res = await fetch("/ops/metrics");
    setMetricsText(await res.text());
  };

  const pendingWorkflows =
    ops?.alerter.workflows.filter((w) => w.status === "awaiting_approval") || [];

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-zinc-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-zinc-900">
            Ops Control Plane &amp; Incident Loop
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            Load is synthetic. Upstream 429s &amp; quota gating are enforced by the real sliding-window limiter. Nothing changes before human approval.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {ops?.surge.running ? (
            <button
              type="button"
              onClick={() => callAction("/api/ops-proxy/surge/stop")}
              className="h-10 px-4 rounded-lg bg-zinc-900 text-white text-xs font-medium hover:bg-zinc-800 whitespace-nowrap"
            >
              Stop Surge ({ops.surge.elapsed_seconds}s)
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                callAction("/api/ops-proxy/surge", { rate_per_min: 100, seconds: 180 })
              }
              className="h-10 px-4 rounded-lg bg-[#C2410C] text-white text-xs font-medium hover:bg-[#9A3412] inline-flex items-center gap-2 whitespace-nowrap"
            >
              <Flame className="w-4 h-4" />
              Start &ldquo;Muhurat Morning&rdquo; Surge (100/min)
            </button>
          )}

          <button
            type="button"
            onClick={loadPrometheusMetrics}
            className="h-10 px-3.5 rounded-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-700 hover:bg-zinc-50 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Terminal className="w-3.5 h-3.5" />
            /metrics
          </button>

          <button
            type="button"
            onClick={() => callAction("/api/ops-proxy/reset")}
            className="h-10 px-3.5 rounded-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-700 hover:bg-zinc-50 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
        </div>
      </div>

      {errMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {errMsg}
        </div>
      )}

      {ops && (
        <>
          {/* KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="text-xs text-zinc-500">Degradation Level</p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-zinc-900">
                Level {ops.level}
              </p>
              <p className="mt-0.5 text-xs text-zinc-600">
                {ops.level === 0 ? "Live voice" : ops.level === 1 ? "Text mode (busy)" : "Queued"}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="text-xs text-zinc-500">RPM (last 60s)</p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-zinc-900">
                {ops.rpm_60s}
              </p>
              <p className="mt-0.5 text-xs text-zinc-600">
                Budget {ops.rpm_budget} / Cap {ops.hard_cap}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="text-xs text-zinc-500">429 Error Rate</p>
              <p
                className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${
                  ops.rate429_pct_60s > 10 ? "text-red-700" : "text-emerald-700"
                }`}
              >
                {ops.rate429_pct_60s}%
              </p>
              <p className="mt-0.5 text-xs text-zinc-600">
                {ops.sarvam_429_last_60s} errors in 60s
              </p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="text-xs text-zinc-500">Alerter State</p>
              <p
                className={`mt-1 font-mono text-2xl font-semibold uppercase ${
                  ops.alerter.status === "firing" ? "text-red-700" : "text-emerald-700"
                }`}
              >
                {ops.alerter.status}
              </p>
              <p className="mt-0.5 text-xs text-zinc-600 truncate">
                Leader: {ops.alerter.active_leader_id}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="text-xs text-zinc-500">TTS Calls (60s)</p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-zinc-900">
                {ops.tts_60s}
              </p>
              <p className="mt-0.5 text-xs text-zinc-600">Queue depth: {ops.queue_depth}</p>
            </div>
          </div>

          {/* Pending Human-in-the-Loop Approval Gate */}
          {pendingWorkflows.length > 0 && (
            <section className="rounded-2xl border border-amber-300 bg-amber-50/70 p-6 space-y-4">
              {pendingWorkflows.map((wf) => (
                <div key={wf.id} className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <ShieldAlert className="w-5 h-5 text-amber-800 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs font-mono text-amber-900">
                          NudgeBee Investigation · Rule {wf.rule_name} · Timeout {wf.timeout_minutes}m
                        </p>
                        <h2 className="mt-0.5 text-lg font-semibold text-zinc-900">
                          Human Approval Required: {wf.proposed_action.summary}
                        </h2>
                      </div>
                    </div>
                    <span className="font-mono text-xs text-amber-900">
                      Safety Check: Flag level is still {ops.level}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs bg-white border border-amber-200 rounded-xl p-4">
                    <div>
                      <p className="font-semibold text-zinc-900">Cluster Evidence</p>
                      <p className="mt-1 text-zinc-700">Pods: {wf.evidence.pod_status}</p>
                      <p className="text-zinc-700">
                        CPU: {wf.evidence.cpu_usage} · Restarts: {wf.evidence.restarts}
                      </p>
                      <p className="mt-1 font-mono text-red-700">{wf.evidence.worker_log_excerpt}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-zinc-900">Agent Diagnosis</p>
                      <p className="mt-1 text-zinc-700">{wf.evidence.recommendation}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        callAction("/api/ops-proxy/approve", {
                          workflow_id: wf.id,
                          approver: "priya.sharma@haanji.in",
                        })
                      }
                      className="h-10 px-5 rounded-lg bg-emerald-700 text-white text-xs font-medium hover:bg-emerald-800 inline-flex items-center gap-2"
                    >
                      <Check className="w-4 h-4" />
                      Approve Remediation ({wf.proposed_action.summary})
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        callAction("/api/ops-proxy/reject", {
                          workflow_id: wf.id,
                          actor: "priya.sharma@haanji.in",
                        })
                      }
                      className="h-10 px-4 rounded-lg border border-zinc-300 bg-white text-xs font-medium text-zinc-700 hover:bg-zinc-50 inline-flex items-center gap-1.5"
                    >
                      <XCircle className="w-4 h-4" />
                      Reject (Keep Level {ops.level})
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* Live Charts */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MiniSeriesChart
              title="Upstream Request Rate (60 RPM Account Cap)"
              data={ops.timeseries}
              valueKey="rpm"
              maxVal={240}
              threshold={60}
              strokeColor="#18181B"
              unit="RPM"
            />
            <MiniSeriesChart
              title="429 Quota Error Share (Alert > 10%)"
              data={ops.timeseries}
              valueKey="rate429Pct"
              maxVal={100}
              threshold={10}
              strokeColor="#B91C1C"
              unit="%"
            />
            <MiniSeriesChart
              title="TTS Voice Synthesis Calls / 5s"
              data={ops.timeseries}
              valueKey="tts"
              maxVal={20}
              strokeColor="#C2410C"
              unit="calls"
            />
          </div>

          {/* Flagsmith Controls & Audit Log */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <section className="lg:col-span-5 rounded-2xl border border-zinc-200 bg-white p-6 space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900">Flagsmith Control Plane</h2>
                <p className="text-xs text-zinc-500">
                  Direct flag controls for testing Level 0/1/2, per-language TTS release flags, and outage fallback.
                </p>
              </div>

              <div>
                <p className="text-xs font-medium text-zinc-700 mb-2">ops_degradation_level</p>
                <div className="grid grid-cols-3 gap-2">
                  {([0, 1, 2] as const).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() =>
                        callAction("/api/ops-proxy/degrade", {
                          level: lvl,
                          rpm_budget: ops.rpm_budget,
                          actor: "ops_console",
                          reason: `Manual switch to level ${lvl}`,
                        })
                      }
                      className={`h-10 rounded-lg border text-xs font-medium transition-colors ${
                        ops.level === lvl
                          ? "border-amber-700 bg-amber-50 text-amber-900 font-semibold"
                          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                      }`}
                    >
                      Level {lvl}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="font-medium text-zinc-700">sarvam_rpm_budget (5–55)</span>
                  <span className="font-mono tabular-nums text-zinc-900">{ops.rpm_budget} RPM</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={55}
                  step={5}
                  value={ops.rpm_budget}
                  onChange={(e) =>
                    callAction("/api/ops-proxy/degrade", {
                      level: ops.level,
                      rpm_budget: Number(e.target.value),
                      actor: "ops_console",
                      reason: `Adjusted rpm_budget to ${e.target.value}`,
                    })
                  }
                  className="w-full accent-[#C2410C]"
                />
              </div>

              <div>
                <p className="text-xs font-medium text-zinc-700 mb-2">
                  rel_voice_reply (per language)
                </p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(ops.voice_reply || {}).map(([lang, enabled]) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() =>
                        callAction("/api/ops-proxy/voice-toggle", {
                          language: lang,
                          enabled: !enabled,
                        })
                      }
                      className={`px-3 py-1.5 rounded-lg border text-xs font-mono ${
                        enabled
                          ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                          : "border-zinc-200 bg-zinc-100 text-zinc-500 line-through"
                      }`}
                    >
                      {lang}: {enabled ? "ON" : "OFF"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-zinc-200 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-zinc-900">Simulate Flagsmith Unreachable</p>
                  <p className="text-xs text-zinc-500">
                    Reverts getters to contract defaults (Level 0, Formal)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    callAction("/api/ops-proxy/simulate-outage", {
                      unreachable: !ops.flagsmith_unreachable,
                    })
                  }
                  className={`px-3.5 py-2 rounded-lg text-xs font-medium border ${
                    ops.flagsmith_unreachable
                      ? "bg-red-700 text-white border-red-700"
                      : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50"
                  }`}
                >
                  {ops.flagsmith_unreachable ? "Outage Active" : "Trigger Outage"}
                </button>
              </div>
            </section>

            {/* Audit Log & Events */}
            <section className="lg:col-span-7 rounded-2xl border border-zinc-200 bg-white p-6 space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900">
                  Flagsmith Audit Log &amp; Alert Events
                </h2>
                <p className="text-xs text-zinc-500">
                  Immutable timestamped log proving actor attribution and human approval before flag mutations.
                </p>
              </div>

              <div className="divide-y divide-zinc-200 border border-zinc-200 rounded-xl max-h-72 overflow-y-auto">
                {ops.audit_log.length === 0 ? (
                  <p className="p-4 text-xs text-zinc-500">
                    No flag mutations recorded yet. Start a surge or adjust a flag to record audit entries.
                  </p>
                ) : (
                  ops.audit_log.map((entry) => (
                    <div
                      key={entry.id}
                      className="px-4 py-2.5 flex flex-wrap items-baseline justify-between gap-2 text-xs"
                    >
                      <div>
                        <span className="font-mono font-semibold text-zinc-900">
                          {entry.actor}
                        </span>
                        <span className="text-zinc-600"> — {entry.reason}</span>
                      </div>
                      <span className="font-mono tabular-nums text-zinc-500">
                        L{entry.level} / {entry.rpm_budget}rpm ·{" "}
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {ops.alerter.events.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-zinc-700 mb-2">
                    Recent Contract 7.5 Webhook Events
                  </p>
                  <div className="divide-y divide-zinc-200 border border-zinc-200 rounded-xl">
                    {ops.alerter.events.slice(0, 5).map((ev) => (
                      <div
                        key={ev.id}
                        className="px-4 py-2.5 flex items-center justify-between gap-2 text-xs"
                      >
                        <div>
                          <span
                            className={`font-mono font-semibold uppercase ${
                              ev.status === "firing" ? "text-red-700" : "text-emerald-700"
                            }`}
                          >
                            {ev.status}
                          </span>
                          <span className="text-zinc-800 ml-2">{ev.title}</span>
                        </div>
                        <span className="font-mono text-zinc-500">fp:{ev.fingerprint}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* Prometheus Raw Exposition Viewer */}
          {metricsText && (
            <section className="rounded-2xl border border-zinc-200 bg-zinc-950 text-zinc-100 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-xs text-zinc-400">GET /ops/metrics (Prometheus)</span>
                <button
                  type="button"
                  onClick={() => setMetricsText(null)}
                  className="text-xs text-zinc-400 hover:text-white"
                >
                  Close
                </button>
              </div>
              <pre className="font-mono text-xs overflow-x-auto leading-relaxed">
                {metricsText}
              </pre>
            </section>
          )}
        </>
      )}
    </div>
  );
}
