import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Check,
  Flame,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Terminal,
  Webhook,
  XCircle,
} from "lucide-react";

interface FlagCatalogRow {
  key: string;
  type: string;
  defaultValue: unknown;
  currentValue: unknown;
  controls: string;
  lastFetchedAt: string;
}

interface OpsState {
  level: 0 | 1 | 2;
  rpm_budget: number;
  hard_cap: number;
  flagsmith_unreachable: boolean;
  nudgebee_configured: boolean;
  flags_map: {
    exp_voice_persona: string;
    ops_degradation_level: number;
    ops_sarvam_rpm_budget: number;
    rel_voice_reply: Record<string, boolean>;
    rel_voice_rollout_pct: number;
    cfg_llm: { model: string; prompt_version: string; temperature: number; max_tokens: number };
    rel_elder_mode_default: boolean;
    last_fetched_at: string;
    source: string;
  };
  flags_catalog: FlagCatalogRow[];
  voice_rollout: {
    pct: number;
    guests: Array<{ gid: string; included: boolean; bucket: number }>;
  };
  experiment: {
    arms: Record<
      "formal" | "warm",
      {
        exposures: number;
        answers: number;
        completions: number;
        abandoned: number;
        conversion_rate_pct: number;
      }
    >;
    total_exposures: number;
    honest_reading: string;
    flagsmith_note: string;
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
      decided_at?: string;
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
    <div className="glass-card p-5">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <span className="text-[11px] uppercase tracking-[0.16em] text-[#E6CFA3]">{title}</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-[#F5EDE1]">
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
            stroke="#C98A8A"
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

export function OpsControlPlane({
  onDemoSignal,
  demoFocus,
}: {
  onDemoSignal?: (event: "ops_rush_done" | "ops_flags_checked") => void;
  demoFocus?: { section: "rush" | "flags"; nonce: number } | null;
}) {
  const [ops, setOps] = useState<OpsState | null>(null);
  const [metricsText, setMetricsText] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const [flagReadback, setFlagReadback] = useState<{
    beforeLevel: number | null;
    beforeSource: string | null;
    afterLevel: number | null;
    afterSource: string | null;
    investigating: boolean;
  }>({
    beforeLevel: null,
    beforeSource: null,
    afterLevel: null,
    afterSource: null,
    investigating: false,
  });

  const rushRef = useRef<HTMLDivElement | null>(null);
  const flagsRef = useRef<HTMLDivElement | null>(null);

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
    const id = window.setInterval(fetchState, 1800);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!demoFocus) return;
    if (demoFocus.section === "rush") {
      rushRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (demoFocus.section === "flags") {
      flagsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      onDemoSignal?.("ops_flags_checked");
    }
  }, [demoFocus?.nonce]);

  const callAction = async (path: string, body?: object) => {
    setErrMsg(null);
    setBusyAction(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await fetchState();
      return json;
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusyAction(false);
    }
  };

  const runMuhuratDemo = async () => {
    setFlagReadback({
      beforeLevel: 0,
      beforeSource: ops?.flags_map.source || "Flagsmith",
      afterLevel: null,
      afterSource: null,
      investigating: true,
    });
    const res = await callAction("/api/ops-proxy/muhurat-demo");
    if (res?.flagsmith_before) {
      setFlagReadback({
        beforeLevel: res.flagsmith_before.level,
        beforeSource: res.flagsmith_before.source,
        afterLevel: res.state?.level ?? 0,
        afterSource: res.state?.flags_map?.source ?? res.flagsmith_before.source,
        investigating: false,
      });
    } else {
      setFlagReadback((f) => ({ ...f, investigating: false }));
    }
  };

  const approveWorkflow = async (wfId: string) => {
    const res = await callAction("/api/ops-proxy/approve", {
      workflow_id: wfId,
      approver: "oncall-operator",
    });
    if (res?.ok) {
      const syncRes = await callAction("/api/ops-proxy/sync-flags");
      setFlagReadback((prev) => ({
        ...prev,
        afterLevel: syncRes?.level ?? res.state?.level ?? 1,
        afterSource: syncRes?.source ?? res.state?.flags_map?.source ?? prev.afterSource,
        investigating: false,
      }));
      onDemoSignal?.("ops_rush_done");
    }
  };

  const endSurge = async () => {
    await callAction("/api/ops-proxy/end-surge");
    const syncRes = await callAction("/api/ops-proxy/sync-flags");
    setFlagReadback((prev) => ({
      ...prev,
      afterLevel: syncRes?.level ?? 0,
      afterSource: syncRes?.source ?? prev.afterSource,
    }));
  };

  const loadPrometheusMetrics = async () => {
    const res = await fetch("/ops/metrics");
    setMetricsText(await res.text());
  };

  const pendingWorkflows =
    ops?.alerter.workflows.filter((w) => w.status === "awaiting_approval") || [];
  const latestApprovedDegrade = ops?.alerter.workflows.find(
    (w) => w.kind === "degrade" && w.status === "approved"
  );
  const latestAlert = ops?.alerter.events[0] || null;
  const latestAuditDegrade = ops?.audit_log.find((a) => a.level === 1);

  const timelineSteps = [
    {
      label: "1. Alert",
      done: Boolean(latestAlert || ops?.alerter.status === "firing"),
      ts: latestAlert?.timestamp || null,
      detail: latestAlert ? latestAlert.title : "Waiting for 429 > 10%",
    },
    {
      label: "2. Investigate",
      done: Boolean(pendingWorkflows.length > 0 || latestApprovedDegrade),
      ts: (pendingWorkflows[0] || latestApprovedDegrade)?.created_at || null,
      detail:
        pendingWorkflows.length > 0 || latestApprovedDegrade
          ? "NudgeBee diagnosis ready"
          : flagReadback.investigating
            ? "NudgeBee investigating..."
            : "Idle",
    },
    {
      label: "3. Approve",
      done: Boolean(latestApprovedDegrade),
      ts: latestApprovedDegrade?.decided_at || null,
      detail: latestApprovedDegrade
        ? `${ops?.nudgebee_configured ? "NudgeBee" : "Local rehearsal"} (${latestApprovedDegrade.decided_by || "human"})`
        : pendingWorkflows.length > 0
          ? ops?.nudgebee_configured
            ? "Awaiting NudgeBee approval"
            : "Awaiting local rehearsal approval"
          : "Pending surge",
    },
    {
      label: "4. Flag changed",
      done: Boolean(ops && (ops.level > 0 || latestAuditDegrade)),
      ts: latestAuditDegrade?.timestamp || null,
      detail:
        flagReadback.beforeLevel !== null && flagReadback.afterLevel !== null
          ? `Level ${flagReadback.beforeLevel} -> ${flagReadback.afterLevel} (${flagReadback.afterSource})`
          : `Current Level ${ops?.level ?? 0}`,
    },
    {
      label: "5. Guests protected",
      done: Boolean(ops && ops.level > 0),
      ts: ops && ops.level > 0 ? new Date().toISOString() : null,
      detail:
        ops && ops.level > 0
          ? "Voice paused, text answers ON, 0 TTS calls"
          : "Live voice nominal",
    },
  ];

  return (
    <div className="min-h-full text-[#F5EDE1]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 space-y-8">
        {/* Header */}
        <div
          ref={rushRef}
          className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b hairline-gold"
        >
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">
              Human-Approved Quota Protection
            </p>
            <h1 className="mt-1.5 font-display text-3xl sm:text-4xl font-light text-[#F5EDE1]">
              Ops Control Plane &amp; Incident Loop
            </h1>
            <p className="mt-1.5 text-sm text-[#F5EDE1]/70">
              Run a 60-second Muhurat Rush demo through the shared 60 RPM Sarvam cap. Flags mutate only after human approval.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {ops?.surge.running || (ops && ops.level > 0) ? (
              <button
                type="button"
                disabled={busyAction}
                onClick={endSurge}
                className="min-h-[44px] px-5 rounded-full bg-[#E6CFA3] text-[#14050A] text-xs font-semibold hover:bg-[#F5EDE1] whitespace-nowrap"
              >
                End surge (restore Level 0) {ops?.surge.running ? `· ${ops.surge.elapsed_seconds}s` : ""}
              </button>
            ) : null}

            <button
              type="button"
              disabled={busyAction}
              onClick={runMuhuratDemo}
              className="min-h-[44px] px-5 rounded-full bg-[#F5EDE1] text-[#14050A] text-xs font-semibold hover:bg-[#E6CFA3] inline-flex items-center gap-2 whitespace-nowrap"
            >
              <Flame className="w-4 h-4 text-[#2B0A12]" />
              <span>Run Muhurat Rush demo</span>
            </button>

            <button
              type="button"
              onClick={loadPrometheusMetrics}
              className="min-h-[44px] px-4 rounded-full border border-[#B8925A]/45 bg-[#14050A]/65 text-xs text-[#E6CFA3] hover:bg-[#B8925A]/15 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>/metrics</span>
            </button>

            <button
              type="button"
              disabled={busyAction}
              onClick={() => {
                setFlagReadback({
                  beforeLevel: null,
                  beforeSource: null,
                  afterLevel: null,
                  afterSource: null,
                  investigating: false,
                });
                void callAction("/api/ops-proxy/reset");
              }}
              className="min-h-[44px] px-4 rounded-full border border-[#B8925A]/45 bg-[#14050A]/65 text-xs text-[#F5EDE1] hover:bg-[#B8925A]/15 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </div>
        </div>

        {errMsg && (
          <div className="rounded-2xl border border-[#C98A8A]/50 bg-[#14050A]/80 px-4 py-3 text-sm text-[#C98A8A]">
            {errMsg}
          </div>
        )}

        {ops && (
          <>
            {/* 5-Step Timestamped Muhurat Rush Timeline */}
            <section className="glass-card p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-2xl font-light text-[#F5EDE1]">
                    Incident Loop Timeline (Alert &rarr; Investigate &rarr; Approve &rarr; Flag changed &rarr; Guests protected)
                  </h2>
                  <p className="text-xs text-[#F5EDE1]/65">
                    Approval channel:{" "}
                    <span className="text-[#E6CFA3] font-medium">
                      {ops.nudgebee_configured
                        ? "NudgeBee webhook live"
                        : "Local rehearsal (NudgeBee webhook not configured)"}
                    </span>
                  </p>
                </div>
                {flagReadback.beforeLevel !== null && (
                  <div className="font-mono text-xs px-3 py-1.5 rounded-full bg-[#14050A]/80 border border-[#B8925A]/30 text-[#E6CFA3]">
                    Flagsmith readback: before={flagReadback.beforeLevel} &rarr; after={flagReadback.afterLevel ?? ops.level} ({flagReadback.afterSource || ops.flags_map.source})
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                {timelineSteps.map((step) => (
                  <div
                    key={step.label}
                    className={`rounded-xl border p-3.5 ${
                      step.done
                        ? "border-[#8FB39A]/45 bg-[#8FB39A]/10"
                        : "border-[#B8925A]/20 bg-[#14050A]/55"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-xs font-semibold ${
                          step.done ? "text-[#8FB39A]" : "text-[#E6CFA3]"
                        }`}
                      >
                        {step.label}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-[#F5EDE1]/60">
                        {step.ts ? new Date(step.ts).toLocaleTimeString() : "--:--"}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-[#F5EDE1]/85">{step.detail}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* KPI Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              <div className="glass-card p-4">
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#E6CFA3]">
                  Degradation Level
                </p>
                <p className="mt-1.5 font-mono text-2xl font-light tabular-nums text-[#F5EDE1]">
                  Level {ops.level}
                </p>
                <p className="mt-0.5 text-xs text-[#F5EDE1]/65">
                  {ops.level === 0 ? "Live voice" : ops.level === 1 ? "Text mode (busy)" : "Queued"}
                </p>
              </div>
              <div className="glass-card p-4">
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#E6CFA3]">
                  RPM (last 60s)
                </p>
                <p className="mt-1.5 font-mono text-2xl font-light tabular-nums text-[#E6CFA3]">
                  {ops.rpm_60s}
                </p>
                <p className="mt-0.5 text-xs text-[#F5EDE1]/65">
                  Budget {ops.rpm_budget} / Cap {ops.hard_cap}
                </p>
              </div>
              <div className="glass-card p-4">
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#E6CFA3]">
                  429 Error Rate
                </p>
                <p
                  className={`mt-1.5 font-mono text-2xl font-light tabular-nums ${
                    ops.rate429_pct_60s > 10 ? "text-[#C98A8A]" : "text-[#8FB39A]"
                  }`}
                >
                  {ops.rate429_pct_60s}%
                </p>
                <p className="mt-0.5 text-xs text-[#F5EDE1]/65">
                  {ops.sarvam_429_last_60s} errors in 60s
                </p>
              </div>
              <div className="glass-card p-4">
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#E6CFA3]">
                  Alerter State
                </p>
                <p
                  className={`mt-1.5 font-mono text-2xl font-light uppercase ${
                    ops.alerter.status === "firing" ? "text-[#C98A8A]" : "text-[#8FB39A]"
                  }`}
                >
                  {ops.alerter.status}
                </p>
                <p className="mt-0.5 text-xs text-[#F5EDE1]/65 truncate">
                  Leader: {ops.alerter.active_leader_id}
                </p>
              </div>
              <div className="glass-card p-4">
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#E6CFA3]">
                  TTS Calls (60s)
                </p>
                <p className="mt-1.5 font-mono text-2xl font-light tabular-nums text-[#F5EDE1]">
                  {ops.tts_60s}
                </p>
                <p className="mt-0.5 text-xs text-[#F5EDE1]/65">Queue depth: {ops.queue_depth}</p>
              </div>
            </div>

            {/* Pending Human-in-the-Loop Approval Gate */}
            {pendingWorkflows.length > 0 && (
              <section className="glass-card border-[#E6CFA3]/55 p-6 space-y-4">
                {pendingWorkflows.map((wf) => (
                  <div key={wf.id} className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <ShieldAlert className="w-5 h-5 text-[#E6CFA3] mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs font-mono text-[#E6CFA3]">
                            {ops.nudgebee_configured
                              ? "NudgeBee Incident Workflow"
                              : "Local Rehearsal Approval (NudgeBee webhook not configured)"}{" "}
                            · Rule {wf.rule_name} · Timeout {wf.timeout_minutes}m
                          </p>
                          <h2 className="mt-0.5 font-display text-2xl font-light text-[#F5EDE1]">
                            Human Approval Required: {wf.proposed_action.summary}
                          </h2>
                        </div>
                      </div>
                      <span className="font-mono text-xs px-3 py-1 rounded-full bg-[#14050A]/80 border border-[#B8925A]/40 text-[#E6CFA3]">
                        Safety Check: Flag level is still {ops.level}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs bg-[#14050A]/65 border border-[#B8925A]/20 rounded-xl p-4">
                      <div>
                        <p className="font-semibold text-[#F5EDE1]">Cluster Evidence</p>
                        <p className="mt-1 text-[#E6CFA3]">Pods: {wf.evidence.pod_status}</p>
                        <p className="text-[#E6CFA3]">
                          CPU: {wf.evidence.cpu_usage} · Restarts: {wf.evidence.restarts}
                        </p>
                        <p className="mt-1 font-mono text-[#C98A8A]">{wf.evidence.worker_log_excerpt}</p>
                      </div>
                      <div>
                        <p className="font-semibold text-[#F5EDE1]">NudgeBee Diagnosis</p>
                        <p className="mt-1 text-[#F5EDE1]/75">{wf.evidence.recommendation}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() => approveWorkflow(wf.id)}
                        className="min-h-[44px] px-5 rounded-full bg-[#F5EDE1] text-[#14050A] text-xs font-semibold hover:bg-[#E6CFA3] inline-flex items-center gap-2"
                      >
                        <Check className="w-4 h-4" />
                        <span>
                          {ops.nudgebee_configured
                            ? `Approve Remediation (${wf.proposed_action.summary})`
                            : `Local Rehearsal: Approve (${wf.proposed_action.summary})`}
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() =>
                          callAction("/api/ops-proxy/reject", {
                            workflow_id: wf.id,
                            actor: "oncall-operator",
                          })
                        }
                        className="min-h-[44px] px-4 rounded-full border border-[#B8925A]/45 text-xs text-[#F5EDE1] hover:bg-[#B8925A]/15 inline-flex items-center gap-1.5"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>Reject (Keep Level {ops.level})</span>
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            )}

            {/* Live Charts (Restricted Palette: Gold, Light Gold, Ivory, Sage, Dusty Rose) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <DarkSeriesChart
                title="Upstream Request Rate (60 RPM Cap)"
                data={ops.timeseries}
                valueKey="rpm"
                maxVal={240}
                threshold={60}
                strokeColor="#E6CFA3"
                unit="RPM"
              />
              <DarkSeriesChart
                title="429 Quota Error Share (Alert > 10%)"
                data={ops.timeseries}
                valueKey="rate429Pct"
                maxVal={100}
                threshold={10}
                strokeColor="#C98A8A"
                unit="%"
              />
              <DarkSeriesChart
                title="TTS Voice Calls / 5s"
                data={ops.timeseries}
                valueKey="tts"
                maxVal={20}
                strokeColor="#8FB39A"
                unit="calls"
              />
            </div>

            {/* Flagsmith Showcase */}
            <section ref={flagsRef} className="glass-card p-6 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-2xl font-light text-[#F5EDE1]">
                    Flags (Flagsmith Control Plane)
                  </h2>
                  <p className="text-xs text-[#F5EDE1]/65">
                    Source: {ops.flags_map?.source || "Local Flag Store"} · Last fetched:{" "}
                    {ops.flags_map?.last_fetched_at
                      ? new Date(ops.flags_map.last_fetched_at).toLocaleTimeString()
                      : "--"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => {
                    onDemoSignal?.("ops_flags_checked");
                    void callAction("/api/ops-proxy/sync-flags");
                  }}
                  className="min-h-[44px] px-4 rounded-full border border-[#B8925A]/45 bg-[#14050A]/70 text-xs text-[#E6CFA3] hover:bg-[#B8925A]/15 inline-flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Sync Flags</span>
                </button>
              </div>

              <div className="overflow-x-auto border border-[#B8925A]/20 rounded-xl bg-[#14050A]/60">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#B8925A]/20 text-[11px] uppercase tracking-[0.14em] text-[#E6CFA3]">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Flag Key</th>
                      <th className="py-2.5 px-4 font-medium">Current Value</th>
                      <th className="py-2.5 px-4 font-medium">Default</th>
                      <th className="py-2.5 px-4 font-medium">What It Controls</th>
                      <th className="py-2.5 px-4 font-medium whitespace-nowrap">Last Fetched</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#B8925A]/15">
                    {(ops.flags_catalog || []).map((row) => (
                      <tr key={row.key}>
                        <td className="py-2.5 px-4 font-mono text-[#E6CFA3] whitespace-nowrap">
                          {row.key}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[#F5EDE1]">
                          {typeof row.currentValue === "object"
                            ? JSON.stringify(row.currentValue)
                            : String(row.currentValue)}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[#F5EDE1]/65">
                          {typeof row.defaultValue === "object"
                            ? "defaults"
                            : String(row.defaultValue)}
                        </td>
                        <td className="py-2.5 px-4 text-[#F5EDE1]/80">{row.controls}</td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-[#F5EDE1]/65 whitespace-nowrap">
                          {new Date(row.lastFetchedAt).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-xl border border-[#B8925A]/20 bg-[#14050A]/60 p-5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-mono text-[#E6CFA3]">rel_voice_rollout_pct</p>
                      <p className="text-xs text-[#F5EDE1]/65">
                        Percentage rollout across guest IDs (currently {ops.voice_rollout?.pct ?? 100}%)
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      {[0, 50, 100].map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => callAction("/api/ops-proxy/voice-rollout", { pct })}
                          className={`px-3 py-1.5 rounded-full text-xs font-mono border ${
                            ops.voice_rollout?.pct === pct
                              ? "border-[#F5EDE1] bg-[#F5EDE1] text-[#14050A] font-semibold"
                              : "border-[#B8925A]/35 text-[#F5EDE1]"
                          }`}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  </div>

                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={10}
                    value={ops.voice_rollout?.pct ?? 100}
                    onChange={(e) =>
                      callAction("/api/ops-proxy/voice-rollout", {
                        pct: Number(e.target.value),
                      })
                    }
                    className="w-full accent-[#B8925A]"
                  />

                  <div className="pt-1">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-[#E6CFA3] mb-1.5">
                      Recent Guest Rollout Assignment
                    </p>
                    {ops.voice_rollout?.guests.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {ops.voice_rollout.guests.map((g) => (
                          <span
                            key={g.gid}
                            className={`px-2 py-0.5 rounded-md font-mono text-[11px] border ${
                              g.included
                                ? "border-[#8FB39A]/40 bg-[#8FB39A]/10 text-[#8FB39A]"
                                : "border-[#B8925A]/40 bg-[#B8925A]/10 text-[#E6CFA3]"
                            }`}
                          >
                            {g.gid.slice(0, 10)}: {g.included ? "IN" : "PAUSED"} (b{g.bucket})
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-[#F5EDE1]/60">
                        Ask a question in Guest Concierge to record rollout assignments.
                      </p>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-[#B8925A]/20 bg-[#14050A]/60 p-5 space-y-3">
                  <div>
                    <p className="text-xs font-mono text-[#E6CFA3]">exp_voice_persona (50/50 split)</p>
                    <p className="text-xs text-[#F5EDE1]/65">
                      Guest IDs hash deterministically into formal vs warm arms
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono tabular-nums">
                      <thead className="border-b border-[#B8925A]/20 text-[#E6CFA3]">
                        <tr>
                          <th className="py-1.5 pr-3">Arm</th>
                          <th className="py-1.5 px-3">Guests</th>
                          <th className="py-1.5 px-3">Answers</th>
                          <th className="py-1.5 px-3">RSVPs</th>
                          <th className="py-1.5 pl-3">Conv %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#B8925A]/15 text-[#F5EDE1]">
                        {(["formal", "warm"] as const).map((arm) => {
                          const row = ops.experiment?.arms?.[arm];
                          return (
                            <tr key={arm}>
                              <td className="py-2 pr-3 capitalize text-[#E6CFA3]">{arm}</td>
                              <td className="py-2 px-3">{row?.exposures ?? 0}</td>
                              <td className="py-2 px-3">{row?.answers ?? 0}</td>
                              <td className="py-2 px-3">{row?.completions ?? 0}</td>
                              <td className="py-2 pl-3">{row?.conversion_rate_pct ?? 0}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-[#F5EDE1]/65">
                    Honest reading: {ops.experiment?.honest_reading}
                  </p>
                </div>
              </div>
            </section>

            {/* Runtime Overrides & Scale Comparison */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <section className="lg:col-span-5 glass-card p-6 space-y-5">
                <div>
                  <h2 className="font-display text-2xl font-light text-[#F5EDE1]">
                    Runtime Overrides &amp; Fault Switches
                  </h2>
                  <p className="text-xs text-[#F5EDE1]/65">
                    Test emergency level overrides, per-language voice toggles, and Flagsmith outage safety.
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium text-[#E6CFA3] mb-2">ops_degradation_level</p>
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
                        className={`min-h-[44px] rounded-full border text-xs font-semibold transition-colors ${
                          ops.level === lvl
                            ? "border-[#F5EDE1] bg-[#F5EDE1] text-[#14050A]"
                            : "border-[#B8925A]/35 bg-[#14050A]/60 text-[#F5EDE1] hover:bg-[#B8925A]/15"
                        }`}
                      >
                        Level {lvl}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="font-medium text-[#E6CFA3]">ops_sarvam_rpm_budget (5-55)</span>
                    <span className="font-mono tabular-nums text-[#E6CFA3]">{ops.rpm_budget} RPM</span>
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
                    className="w-full accent-[#B8925A]"
                  />
                </div>

                <div>
                  <p className="text-xs font-medium text-[#E6CFA3] mb-2">
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
                        className={`px-3 py-1.5 rounded-full border text-xs font-mono ${
                          enabled
                            ? "border-[#8FB39A]/45 bg-[#8FB39A]/10 text-[#8FB39A]"
                            : "border-[#B8925A]/25 bg-[#14050A]/60 text-[#F5EDE1]/45 line-through"
                        }`}
                      >
                        {lang}: {enabled ? "ON" : "OFF"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t hairline-gold space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-[#F5EDE1]">rel_elder_mode_default</p>
                      <p className="text-xs text-[#F5EDE1]/65">Global default (elder households override ON)</p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        callAction("/api/ops-proxy/elder-default", {
                          enabled: !ops.flags_map?.rel_elder_mode_default,
                        })
                      }
                      className={`px-3.5 py-1.5 rounded-full text-xs font-mono border ${
                        ops.flags_map?.rel_elder_mode_default
                          ? "bg-[#F5EDE1] text-[#14050A] border-[#F5EDE1] font-semibold"
                          : "bg-[#14050A]/60 text-[#E6CFA3] border-[#B8925A]/35"
                      }`}
                    >
                      {ops.flags_map?.rel_elder_mode_default ? "TRUE" : "FALSE"}
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-[#F5EDE1]">
                        Fault Switch: Flagsmith Unreachable
                      </p>
                      <p className="text-xs text-[#F5EDE1]/65">
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
                      className={`px-3.5 py-2 rounded-full text-xs font-medium border ${
                        ops.flagsmith_unreachable
                          ? "bg-[#C98A8A]/25 text-[#C98A8A] border-[#C98A8A]/60"
                          : "bg-[#14050A]/60 text-[#F5EDE1] border-[#B8925A]/35 hover:bg-[#B8925A]/15"
                      }`}
                    >
                      {ops.flagsmith_unreachable ? "Outage Active" : "Block Egress"}
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-[#F5EDE1]">
                        Fault Switch: Dead Alert Webhook
                      </p>
                      <p className="text-xs text-[#F5EDE1]/65">
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
                      className={`px-3.5 py-2 rounded-full text-xs font-medium border ${
                        ops.alerter.dead_webhook_mode
                          ? "bg-[#C98A8A]/25 text-[#C98A8A] border-[#C98A8A]/60"
                          : "bg-[#14050A]/60 text-[#F5EDE1] border-[#B8925A]/35 hover:bg-[#B8925A]/15"
                      }`}
                    >
                      {ops.alerter.dead_webhook_mode ? "Webhook Dead" : "Kill Webhook"}
                    </button>
                  </div>
                </div>
              </section>

              <div className="lg:col-span-7 space-y-6">
                {ops.scale_comparison && (
                  <section className="glass-card p-6">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h2 className="font-display text-2xl font-light text-[#F5EDE1]">
                          Why Not Just Scale Out Pods?
                        </h2>
                        <p className="mt-0.5 text-xs text-[#F5EDE1]/65">
                          {ops.scale_comparison.note}
                        </p>
                      </div>
                      <Activity className="w-5 h-5 text-[#E6CFA3] shrink-0" />
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-4 font-mono tabular-nums">
                      <div className="rounded-xl bg-[#14050A]/60 border border-[#B8925A]/20 p-4">
                        <p className="text-xs text-[#E6CFA3]">2 Workers @ 12 turns/min</p>
                        <p className="mt-1 text-2xl font-light text-[#E6CFA3]">
                          {ops.scale_comparison.two_workers_429_per_min}{" "}
                          <span className="text-xs">429s/min</span>
                        </p>
                      </div>
                      <div className="rounded-xl bg-[#14050A]/60 border border-[#C98A8A]/35 p-4">
                        <p className="text-xs text-[#C98A8A]">6 Workers @ 12 turns/min</p>
                        <p className="mt-1 text-2xl font-light text-[#C98A8A]">
                          {ops.scale_comparison.six_workers_429_per_min}{" "}
                          <span className="text-xs">429s/min</span>
                        </p>
                      </div>
                    </div>
                  </section>
                )}

                <section className="glass-card p-6 space-y-5">
                  <div>
                    <h2 className="font-display text-2xl font-light text-[#F5EDE1]">
                      Audit Log &amp; Alerter Events
                    </h2>
                    <p className="text-xs text-[#F5EDE1]/65">
                      Every flag write records actor attribution and timestamped causal transitions.
                    </p>
                  </div>

                  <div className="divide-y divide-[#B8925A]/15 border border-[#B8925A]/20 rounded-xl max-h-56 overflow-y-auto bg-[#14050A]/60">
                    {ops.audit_log.length === 0 ? (
                      <p className="p-4 text-xs text-[#F5EDE1]/60">
                        No flag mutations recorded yet. Run Muhurat Rush demo or toggle a flag to record audit entries.
                      </p>
                    ) : (
                      ops.audit_log.map((entry) => (
                        <div
                          key={entry.id}
                          className="px-4 py-2.5 flex flex-wrap items-baseline justify-between gap-2 text-xs"
                        >
                          <div>
                            <span className="font-mono font-semibold text-[#E6CFA3]">
                              {entry.actor}
                            </span>
                            <span className="text-[#F5EDE1]"> · {entry.reason}</span>
                          </div>
                          <span className="font-mono tabular-nums text-[#E6CFA3]/80">
                            L{entry.level} / {entry.rpm_budget}rpm ·{" "}
                            {new Date(entry.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                      ))
                    )}
                  </div>

                  {ops.alerter.events.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-[#E6CFA3] mb-2">Alerter Events</p>
                      <div className="divide-y divide-[#B8925A]/15 border border-[#B8925A]/20 rounded-xl bg-[#14050A]/60">
                        {ops.alerter.events.slice(0, 5).map((ev) => (
                          <div
                            key={ev.id}
                            className="px-4 py-2.5 flex items-center justify-between gap-2 text-xs"
                          >
                            <div>
                              <span
                                className={`font-mono font-semibold uppercase ${
                                  ev.status === "firing" ? "text-[#C98A8A]" : "text-[#8FB39A]"
                                }`}
                              >
                                {ev.status}
                              </span>
                              <span className="text-[#F5EDE1] ml-2">{ev.title}</span>
                            </div>
                            <span className="font-mono text-[#F5EDE1]/60">fp:{ev.fingerprint}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {ops.alerter.webhook_retries_log?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-[#C98A8A] mb-2 flex items-center gap-1.5">
                        <Webhook className="w-3.5 h-3.5" />
                        <span>Webhook Dead-Letter Retries</span>
                      </p>
                      <div className="divide-y divide-[#C98A8A]/20 border border-[#C98A8A]/35 rounded-xl bg-[#14050A]/60">
                        {ops.alerter.webhook_retries_log.slice(0, 6).map((w, i) => (
                          <div key={i} className="px-4 py-2 text-xs font-mono text-[#C98A8A]">
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
              <section className="glass-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-mono text-xs text-[#E6CFA3]">
                    GET /ops/metrics (Prometheus)
                  </span>
                  <button
                    type="button"
                    onClick={() => setMetricsText(null)}
                    className="text-xs text-[#E6CFA3] hover:text-[#F5EDE1]"
                  >
                    Close
                  </button>
                </div>
                <pre className="font-mono text-xs overflow-x-auto leading-relaxed text-[#F5EDE1]/85">
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
