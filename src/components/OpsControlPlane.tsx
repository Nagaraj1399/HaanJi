import { useEffect, useState } from "react";
import {
  Activity,
  Check,
  Flame,
  RotateCcw,
  ShieldAlert,
  Terminal,
  Webhook,
  XCircle,
} from "lucide-react";

interface OpsState {
  level: 0 | 1 | 2;
  rpm_budget: number;
  hard_cap: number;
  flagsmith_unreachable: boolean;
  flags_map: {
    exp_voice_persona: string;
    ops_degradation_level: number;
    ops_sarvam_rpm_budget: number;
    rel_voice_reply: Record<string, boolean>;
    cfg_llm: { model: string; prompt_version: string; temperature: number; max_tokens: number };
    rel_elder_mode_default: boolean;
    source: string;
  };
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
    dead_webhook_mode: boolean;
    webhook_retries_log: Array<{ ts: string; target: string; status: string; attempt: number }>;
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
  scale_comparison: {
    two_workers_429_per_min: number;
    six_workers_429_per_min: number;
    account_cap_rpm: number;
    note: string;
  };
  voice_reply: Record<string, boolean>;
}

function DarkSeriesChart({
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
    <div className="rounded-xl border border-[#C9A96E]/25 bg-[#1C1815] p-4">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="text-xs font-medium text-[#C9A96E]">{title}</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-[#FBF7F0]">
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
            stroke="#EF4444"
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
  const [surgeArmed, setSurgeArmed] = useState(false);
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
    <div className="min-h-full bg-[#14110F] text-[#FBF7F0]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-[#C9A96E]/25">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#FBF7F0]">
              Ops Control Plane &amp; Incident Loop
            </h1>
            <p className="mt-1 text-sm text-[#C9A96E]/90">
              Synthetic surge load vs live sliding-window quota limiter. Degradation flags never mutate before human approval.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {ops?.surge.running ? (
              <button
                type="button"
                onClick={() => callAction("/api/ops-proxy/surge/stop")}
                className="min-h-[44px] px-4 rounded-xl bg-[#F2A93B] text-[#14110F] text-xs font-semibold hover:bg-[#e59a28] whitespace-nowrap"
              >
                Stop Surge ({ops.surge.elapsed_seconds}s)
              </button>
            ) : surgeArmed ? (
              <div className="flex items-center gap-2 rounded-xl border border-[#F2A93B]/60 bg-[#1C1815] px-3 py-1.5">
                <span className="text-xs text-[#F2A93B]">
                  Confirm 100 turns/min synthetic burst (est. 300 calls/min vs 60 cap)?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSurgeArmed(false);
                    void callAction("/api/ops-proxy/surge", {
                      rate_per_min: 100,
                      seconds: 180,
                    });
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#6B1E2E] text-white text-xs font-semibold"
                >
                  Confirm Launch
                </button>
                <button
                  type="button"
                  onClick={() => setSurgeArmed(false)}
                  className="px-2 py-1.5 text-xs text-[#C9A96E]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSurgeArmed(true)}
                className="min-h-[44px] px-4 rounded-xl bg-[#6B1E2E] text-white text-xs font-semibold hover:bg-[#7d2437] inline-flex items-center gap-2 whitespace-nowrap"
              >
                <Flame className="w-4 h-4 text-[#F2A93B]" />
                <span>Start &ldquo;Muhurat Morning&rdquo; Surge (100/min)</span>
              </button>
            )}

            <button
              type="button"
              onClick={loadPrometheusMetrics}
              className="min-h-[44px] px-3.5 rounded-xl border border-[#C9A96E]/35 bg-[#1C1815] text-xs font-medium text-[#FBF7F0] hover:bg-[#26201C] inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Terminal className="w-3.5 h-3.5 text-[#F2A93B]" />
              <span>/metrics</span>
            </button>

            <button
              type="button"
              onClick={() => callAction("/api/ops-proxy/reset")}
              className="min-h-[44px] px-3.5 rounded-xl border border-[#C9A96E]/35 bg-[#1C1815] text-xs font-medium text-[#FBF7F0] hover:bg-[#26201C] inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </div>
        </div>

        {errMsg && (
          <div className="rounded-xl border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm text-red-200">
            {errMsg}
          </div>
        )}

        {ops && (
          <>
            {/* KPI Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              <div className="rounded-xl border border-[#C9A96E]/25 bg-[#1C1815] p-4">
                <p className="text-xs text-[#C9A96E]">Degradation Level</p>
                <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-[#FBF7F0]">
                  Level {ops.level}
                </p>
                <p className="mt-0.5 text-xs text-[#B6A89D]">
                  {ops.level === 0 ? "Live voice" : ops.level === 1 ? "Text mode (busy)" : "Queued"}
                </p>
              </div>
              <div className="rounded-xl border border-[#C9A96E]/25 bg-[#1C1815] p-4">
                <p className="text-xs text-[#C9A96E]">RPM (last 60s)</p>
                <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-[#F2A93B]">
                  {ops.rpm_60s}
                </p>
                <p className="mt-0.5 text-xs text-[#B6A89D]">
                  Budget {ops.rpm_budget} / Cap {ops.hard_cap}
                </p>
              </div>
              <div className="rounded-xl border border-[#C9A96E]/25 bg-[#1C1815] p-4">
                <p className="text-xs text-[#C9A96E]">429 Error Rate</p>
                <p
                  className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${
                    ops.rate429_pct_60s > 10 ? "text-red-400" : "text-emerald-400"
                  }`}
                >
                  {ops.rate429_pct_60s}%
                </p>
                <p className="mt-0.5 text-xs text-[#B6A89D]">
                  {ops.sarvam_429_last_60s} errors in 60s
                </p>
              </div>
              <div className="rounded-xl border border-[#C9A96E]/25 bg-[#1C1815] p-4">
                <p className="text-xs text-[#C9A96E]">Alerter State</p>
                <p
                  className={`mt-1 font-mono text-2xl font-semibold uppercase ${
                    ops.alerter.status === "firing" ? "text-red-400" : "text-emerald-400"
                  }`}
                >
                  {ops.alerter.status}
                </p>
                <p className="mt-0.5 text-xs text-[#B6A89D] truncate">
                  Leader: {ops.alerter.active_leader_id}
                </p>
              </div>
              <div className="rounded-xl border border-[#C9A96E]/25 bg-[#1C1815] p-4">
                <p className="text-xs text-[#C9A96E]">TTS Calls (60s)</p>
                <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-[#FBF7F0]">
                  {ops.tts_60s}
                </p>
                <p className="mt-0.5 text-xs text-[#B6A89D]">Queue depth: {ops.queue_depth}</p>
              </div>
            </div>

            {/* Pending Human-in-the-Loop Approval Gate */}
            {pendingWorkflows.length > 0 && (
              <section className="rounded-2xl border border-[#F2A93B]/60 bg-[#251A16] p-6 space-y-4">
                {pendingWorkflows.map((wf) => (
                  <div key={wf.id} className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <ShieldAlert className="w-5 h-5 text-[#F2A93B] mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs font-mono text-[#F2A93B]">
                            Incident Workflow · Rule {wf.rule_name} · Timeout {wf.timeout_minutes}m
                          </p>
                          <h2 className="mt-0.5 font-display text-lg font-semibold text-[#FBF7F0]">
                            Human Approval Required: {wf.proposed_action.summary}
                          </h2>
                        </div>
                      </div>
                      <span className="font-mono text-xs px-3 py-1 rounded-lg bg-[#14110F] border border-[#F2A93B]/40 text-[#F2A93B]">
                        Safety Check: Flag level is still {ops.level}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs bg-[#14110F] border border-[#C9A96E]/25 rounded-xl p-4">
                      <div>
                        <p className="font-semibold text-[#FBF7F0]">Cluster Evidence</p>
                        <p className="mt-1 text-[#C9A96E]">Pods: {wf.evidence.pod_status}</p>
                        <p className="text-[#C9A96E]">
                          CPU: {wf.evidence.cpu_usage} · Restarts: {wf.evidence.restarts}
                        </p>
                        <p className="mt-1 font-mono text-red-400">{wf.evidence.worker_log_excerpt}</p>
                      </div>
                      <div>
                        <p className="font-semibold text-[#FBF7F0]">Diagnosis</p>
                        <p className="mt-1 text-[#B6A89D]">{wf.evidence.recommendation}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          callAction("/api/ops-proxy/approve", {
                            workflow_id: wf.id,
                            approver: "oncall-operator",
                          })
                        }
                        className="min-h-[44px] px-5 rounded-xl bg-[#2F6B4F] text-white text-xs font-semibold hover:bg-[#24543e] inline-flex items-center gap-2"
                      >
                        <Check className="w-4 h-4" />
                        <span>Approve Remediation ({wf.proposed_action.summary})</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          callAction("/api/ops-proxy/reject", {
                            workflow_id: wf.id,
                            actor: "oncall-operator",
                          })
                        }
                        className="min-h-[44px] px-4 rounded-xl border border-[#C9A96E]/40 bg-[#1C1815] text-xs font-medium text-[#FBF7F0] hover:bg-[#26201C] inline-flex items-center gap-1.5"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>Reject (Keep Level {ops.level})</span>
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            )}

            {/* Live Charts */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <DarkSeriesChart
                title="Upstream Request Rate (60 RPM Cap)"
                data={ops.timeseries}
                valueKey="rpm"
                maxVal={240}
                threshold={60}
                strokeColor="#F2A93B"
                unit="RPM"
              />
              <DarkSeriesChart
                title="429 Quota Error Share (Alert > 10%)"
                data={ops.timeseries}
                valueKey="rate429Pct"
                maxVal={100}
                threshold={10}
                strokeColor="#EF4444"
                unit="%"
              />
              <DarkSeriesChart
                title="TTS Voice Calls / 5s"
                data={ops.timeseries}
                valueKey="tts"
                maxVal={20}
                strokeColor="#C9A96E"
                unit="calls"
              />
            </div>

            {/* Middle Row: Flag Map & Controls + Why Not Scale */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <section className="lg:col-span-5 rounded-2xl border border-[#C9A96E]/25 bg-[#1C1815] p-6 space-y-5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-lg font-semibold text-[#FBF7F0]">
                      Feature Flag Control Plane
                    </h2>
                    <p className="text-xs text-[#B6A89D]">
                      Source: {ops.flags_map?.source || "Local Flag Store"}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-medium text-[#C9A96E] mb-2">ops_degradation_level</p>
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
                        className={`min-h-[44px] rounded-xl border text-xs font-semibold transition-colors ${
                          ops.level === lvl
                            ? "border-[#F2A93B] bg-[#F2A93B] text-[#14110F]"
                            : "border-[#C9A96E]/30 bg-[#14110F] text-[#FBF7F0] hover:bg-[#26201C]"
                        }`}
                      >
                        Level {lvl}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="font-medium text-[#C9A96E]">ops_sarvam_rpm_budget (5-55)</span>
                    <span className="font-mono tabular-nums text-[#F2A93B]">{ops.rpm_budget} RPM</span>
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
                    className="w-full accent-[#F2A93B]"
                  />
                </div>

                <div>
                  <p className="text-xs font-medium text-[#C9A96E] mb-2">
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
                            ? "border-[#2F6B4F] bg-[#2F6B4F]/25 text-emerald-300"
                            : "border-[#C9A96E]/25 bg-[#14110F] text-[#8B7D72] line-through"
                        }`}
                      >
                        {lang}: {enabled ? "ON" : "OFF"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-[#C9A96E]/25 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-[#FBF7F0]">rel_elder_mode_default</p>
                      <p className="text-xs text-[#B6A89D]">Global default (elder traits override ON)</p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        callAction("/api/ops-proxy/elder-default", {
                          enabled: !ops.flags_map?.rel_elder_mode_default,
                        })
                      }
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono border ${
                        ops.flags_map?.rel_elder_mode_default
                          ? "bg-[#F2A93B] text-[#14110F] border-[#F2A93B] font-semibold"
                          : "bg-[#14110F] text-[#C9A96E] border-[#C9A96E]/30"
                      }`}
                    >
                      {ops.flags_map?.rel_elder_mode_default ? "TRUE" : "FALSE"}
                    </button>
                  </div>

                  {/* Fault switches */}
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-[#FBF7F0]">
                        Fault Switch: Flagsmith Unreachable
                      </p>
                      <p className="text-xs text-[#B6A89D]">
                        Reverts getters to contract defaults (Level 0)
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        callAction("/api/ops-proxy/simulate-outage", {
                          unreachable: !ops.flagsmith_unreachable,
                        })
                      }
                      className={`px-3.5 py-2 rounded-xl text-xs font-medium border ${
                        ops.flagsmith_unreachable
                          ? "bg-red-700 text-white border-red-600"
                          : "bg-[#14110F] text-[#FBF7F0] border-[#C9A96E]/30 hover:bg-[#26201C]"
                      }`}
                    >
                      {ops.flagsmith_unreachable ? "Outage Active" : "Block Egress"}
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-[#FBF7F0]">
                        Fault Switch: Dead Alert Webhook
                      </p>
                      <p className="text-xs text-[#B6A89D]">
                        Points webhook to unreachable port and logs 3 retries
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        callAction("/api/ops-proxy/dead-webhook", {
                          dead: !ops.alerter.dead_webhook_mode,
                        })
                      }
                      className={`px-3.5 py-2 rounded-xl text-xs font-medium border ${
                        ops.alerter.dead_webhook_mode
                          ? "bg-red-700 text-white border-red-600"
                          : "bg-[#14110F] text-[#FBF7F0] border-[#C9A96E]/30 hover:bg-[#26201C]"
                      }`}
                    >
                      {ops.alerter.dead_webhook_mode ? "Webhook Dead" : "Kill Webhook"}
                    </button>
                  </div>
                </div>
              </section>

              {/* Right Column: Audit Log, Flag Map, Why Not Scale */}
              <div className="lg:col-span-7 space-y-6">
                {/* Why Not Scale Card */}
                {ops.scale_comparison && (
                  <section className="rounded-2xl border border-[#C9A96E]/25 bg-[#1C1815] p-6">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h2 className="font-display text-lg font-semibold text-[#FBF7F0]">
                          Why Not Just Scale Out Pods?
                        </h2>
                        <p className="mt-0.5 text-xs text-[#B6A89D]">
                          {ops.scale_comparison.note}
                        </p>
                      </div>
                      <Activity className="w-5 h-5 text-[#F2A93B] shrink-0" />
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-4 font-mono tabular-nums">
                      <div className="rounded-xl bg-[#14110F] border border-[#C9A96E]/20 p-4">
                        <p className="text-xs text-[#C9A96E]">2 Workers @ 12 turns/min</p>
                        <p className="mt-1 text-2xl font-semibold text-[#F2A93B]">
                          {ops.scale_comparison.two_workers_429_per_min} <span className="text-xs">429s/min</span>
                        </p>
                      </div>
                      <div className="rounded-xl bg-[#14110F] border border-red-500/30 p-4">
                        <p className="text-xs text-red-300">6 Workers @ 12 turns/min</p>
                        <p className="mt-1 text-2xl font-semibold text-red-400">
                          {ops.scale_comparison.six_workers_429_per_min} <span className="text-xs">429s/min</span>
                        </p>
                      </div>
                    </div>
                  </section>
                )}

                {/* Audit Log & Incident Timeline */}
                <section className="rounded-2xl border border-[#C9A96E]/25 bg-[#1C1815] p-6 space-y-5">
                  <div>
                    <h2 className="font-display text-lg font-semibold text-[#FBF7F0]">
                      Incident Timeline &amp; Audit Log
                    </h2>
                    <p className="text-xs text-[#B6A89D]">
                      Every flag write records actor attribution and timestamped causal transitions.
                    </p>
                  </div>

                  <div className="divide-y divide-[#C9A96E]/20 border border-[#C9A96E]/25 rounded-xl max-h-56 overflow-y-auto bg-[#14110F]">
                    {ops.audit_log.length === 0 ? (
                      <p className="p-4 text-xs text-[#B6A89D]">
                        No flag mutations recorded yet. Trigger a surge or toggle a flag to record audit entries.
                      </p>
                    ) : (
                      ops.audit_log.map((entry) => (
                        <div
                          key={entry.id}
                          className="px-4 py-2.5 flex flex-wrap items-baseline justify-between gap-2 text-xs"
                        >
                          <div>
                            <span className="font-mono font-semibold text-[#F2A93B]">
                              {entry.actor}
                            </span>
                            <span className="text-[#FBF7F0]"> · {entry.reason}</span>
                          </div>
                          <span className="font-mono tabular-nums text-[#C9A96E]">
                            L{entry.level} / {entry.rpm_budget}rpm ·{" "}
                            {new Date(entry.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                      ))
                    )}
                  </div>

                  {ops.alerter.events.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-[#C9A96E] mb-2">
                        Alerter Events
                      </p>
                      <div className="divide-y divide-[#C9A96E]/20 border border-[#C9A96E]/25 rounded-xl bg-[#14110F]">
                        {ops.alerter.events.slice(0, 5).map((ev) => (
                          <div
                            key={ev.id}
                            className="px-4 py-2.5 flex items-center justify-between gap-2 text-xs"
                          >
                            <div>
                              <span
                                className={`font-mono font-semibold uppercase ${
                                  ev.status === "firing" ? "text-red-400" : "text-emerald-400"
                                }`}
                              >
                                {ev.status}
                              </span>
                              <span className="text-[#FBF7F0] ml-2">{ev.title}</span>
                            </div>
                            <span className="font-mono text-[#B6A89D]">fp:{ev.fingerprint}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {ops.alerter.webhook_retries_log?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-red-300 mb-2 flex items-center gap-1.5">
                        <Webhook className="w-3.5 h-3.5" />
                        <span>Webhook Dead-Letter Retries</span>
                      </p>
                      <div className="divide-y divide-red-500/20 border border-red-500/30 rounded-xl bg-[#14110F]">
                        {ops.alerter.webhook_retries_log.slice(0, 6).map((w, i) => (
                          <div key={i} className="px-4 py-2 text-xs font-mono text-red-300">
                            Attempt #{w.attempt} · {w.status} · {w.target} ({new Date(w.ts).toLocaleTimeString()})
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              </div>
            </div>

            {metricsText && (
              <section className="rounded-2xl border border-[#C9A96E]/35 bg-[#0D0B09] text-[#FBF7F0] p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-mono text-xs text-[#F2A93B]">
                    GET /ops/metrics (Prometheus)
                  </span>
                  <button
                    type="button"
                    onClick={() => setMetricsText(null)}
                    className="text-xs text-[#C9A96E] hover:text-white"
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
    </div>
  );
}
