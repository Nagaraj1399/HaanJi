import crypto from "node:crypto";
import { capabilities } from "./capabilities.ts";
import { flags } from "./flags.ts";
import { metrics } from "./metrics.ts";
import type { AlertEvent, ApprovalWorkflowRun } from "./types.ts";

export type AlerterStatus = "ok" | "firing";

export interface AlerterTickInput {
  rate429_pct_60s: number;
  rpm_60s: number;
  p95_chat_60s: number;
  queue_depth: number;
}

export interface AlerterSnapshot {
  status: AlerterStatus;
  fingerprint: string | null;
  healthy_since_ms: number | null;
  last_fire_ms: number | null;
  events: AlertEvent[];
  workflows: ApprovalWorkflowRun[];
  active_leader_id: string;
  dead_webhook_mode: boolean;
  webhook_retries_log: Array<{ ts: string; target: string; status: string; attempt: number }>;
}

export class AlerterStateMachine {
  private status: AlerterStatus = "ok";
  private fingerprint: string | null = null;
  private healthySinceMs: number | null = null;
  private lastFireMs: number | null = null;
  private events: AlertEvent[] = [];
  private workflows: ApprovalWorkflowRun[] = [];
  private leaderId = "api-replica-1";
  private leaderLeaseUntilMs = Date.now() + 30_000;
  private timer: NodeJS.Timeout | null = null;
  private deadWebhookMode = false;
  private webhookRetriesLog: Array<{ ts: string; target: string; status: string; attempt: number }> = [];

  setDeadWebhookMode(enabled: boolean): void {
    this.deadWebhookMode = enabled;
  }

  isDeadWebhookMode(): boolean {
    return this.deadWebhookMode;
  }

  async dispatchWebhook(evt: AlertEvent): Promise<{ delivered: boolean; attempts: number }> {
    const targetUrl = this.deadWebhookMode
      ? "http://127.0.0.1:59999/dead-nudgebee-hook"
      : process.env.NUDGEBEE_EVENT_WEBHOOK_URL;
    if (!targetUrl) return { delivered: false, attempts: 0 };

    let attempts = 0;
    for (let attempt = 1; attempt <= 3; attempt++) {
      attempts = attempt;
      try {
        const res = await fetch(targetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(evt),
          signal: AbortSignal.timeout(1500),
        });
        this.webhookRetriesLog.unshift({
          ts: new Date().toISOString(),
          target: targetUrl,
          status: `HTTP ${res.status}`,
          attempt,
        });
        if (res.ok) return { delivered: true, attempts };
      } catch (err) {
        this.webhookRetriesLog.unshift({
          ts: new Date().toISOString(),
          target: targetUrl,
          status: err instanceof Error ? err.message : "Network error",
          attempt,
        });
      }
      if (this.webhookRetriesLog.length > 20) this.webhookRetriesLog.length = 20;
      await new Promise((r) => setTimeout(r, 150 * attempt));
    }
    return { delivered: false, attempts };
  }

  shouldFire(m: AlerterTickInput): boolean {
    return (
      m.rate429_pct_60s > 10 ||
      m.p95_chat_60s > 6.0 ||
      m.queue_depth > 30
    );
  }

  tick(
    m: AlerterTickInput,
    nowMs = Date.now(),
    skipWorkflowCreation = false
  ): AlertEvent | null {
    const unhealthy = this.shouldFire(m);

    if (this.status === "ok") {
      if (unhealthy) {
        this.status = "firing";
        this.healthySinceMs = null;
        this.lastFireMs = nowMs;
        this.fingerprint = crypto
          .createHash("sha256")
          .update(`haanji_sarvam_quota:${nowMs}`)
          .digest("hex")
          .slice(0, 12);

        const evt = this.buildEvent("firing", this.fingerprint, m, nowMs);
        this.events.unshift(evt);
        if (!skipWorkflowCreation) {
          this.openDegradeWorkflow(this.fingerprint, m, nowMs);
          capabilities.recordEvent(
            "nudgebee",
            `1 incident awaiting human approval (fp:${this.fingerprint})`
          );
          void this.dispatchWebhook(evt);
        }
        return evt;
      }
      return null;
    }

    // Currently firing
    if (unhealthy) {
      // Reset healthy hold on any flap back to bad
      this.healthySinceMs = null;
      // 5-minute re-fire while still firing
      if (this.lastFireMs !== null && nowMs - this.lastFireMs >= 5 * 60_000) {
        this.lastFireMs = nowMs;
        const evt = this.buildEvent("firing", this.fingerprint!, m, nowMs);
        this.events.unshift(evt);
        return evt;
      }
      return null;
    }

    // Healthy while firing: track 120s healthy hold
    if (this.healthySinceMs === null) {
      this.healthySinceMs = nowMs;
      return null;
    }

    if (nowMs - this.healthySinceMs >= 120_000) {
      const fp = this.fingerprint!;
      this.status = "ok";
      this.healthySinceMs = null;
      this.lastFireMs = null;
      this.fingerprint = null;

      const evt = this.buildEvent("resolved", fp, m, nowMs);
      this.events.unshift(evt);
      if (!skipWorkflowCreation && flags.degradationLevel() > 0) {
        this.openRestoreWorkflow(fp, nowMs);
        capabilities.recordEvent(
          "nudgebee",
          `Incident fp:${fp} resolved after 120s healthy window`
        );
      }
      return evt;
    }

    return null;
  }

  private buildEvent(
    status: "firing" | "resolved",
    fingerprint: string,
    m: AlerterTickInput,
    nowMs: number
  ): AlertEvent {
    return {
      id: `evt_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
      fingerprint,
      status,
      title:
        status === "firing"
          ? "Sarvam 429 quota surge on haanji-worker"
          : "Sarvam quota pressure resolved on haanji-worker",
      rule_name: "haanji_sarvam_quota",
      severity: "high",
      subject: {
        name: "haanji-worker",
        type: "Deployment",
        namespace: "haanji",
      },
      labels: {
        service: "haanji-worker",
        upstream: "sarvam",
        degradation_level: String(flags.degradationLevel()),
        rpm_60s: String(m.rpm_60s),
      },
      annotations: {
        rate429_pct_60s: String(m.rate429_pct_60s),
        p95_chat_60s: String(m.p95_chat_60s),
        queue_depth: String(m.queue_depth),
        summary:
          "Pods healthy (low CPU, 0 restarts). Errors are upstream 429 quota limits. Do NOT scale haanji-worker.",
      },
      timestamp: new Date(nowMs).toISOString(),
    };
  }

  private openDegradeWorkflow(
    fingerprint: string,
    m: AlerterTickInput,
    nowMs: number
  ): void {
    // Do not open duplicate active degrade workflows for same fingerprint
    const existing = this.workflows.find(
      (w) =>
        w.kind === "degrade" &&
        (w.status === "awaiting_approval" || w.status === "investigation_ready")
    );
    if (existing) return;

    this.workflows.unshift({
      id: `wf_deg_${nowMs}`,
      kind: "degrade",
      fingerprint,
      status: "awaiting_approval",
      rule_name: "haanji_sarvam_quota",
      created_at: new Date(nowMs).toISOString(),
      timeout_minutes: 30,
      evidence: {
        pod_status: "2/2 Running (haanji-api), 2/2 Running (haanji-worker)",
        cpu_usage: "14% avg (100m limit)",
        restarts: 0,
        worker_log_excerpt: `SarvamQuotaError(429): rate429_pct_60s=${m.rate429_pct_60s}%, rpm_60s=${m.rpm_60s} > 60 account limit`,
        recommendation:
          "Set ops_degradation_level=1 and rpm_budget=40 (sheds TTS, ~33% fewer upstream calls). Do NOT scale haanji-worker: more workers would raise the request rate.",
      },
      proposed_action: {
        level: 1,
        rpm_budget: 40,
        summary: "Degrade to Text Mode (Level 1) + cap budget at 40 RPM",
      },
    });
  }

  private openRestoreWorkflow(fingerprint: string, nowMs: number): void {
    const existing = this.workflows.find(
      (w) => w.kind === "restore" && w.status === "awaiting_approval"
    );
    if (existing) return;

    this.workflows.unshift({
      id: `wf_res_${nowMs}`,
      kind: "restore",
      fingerprint,
      status: "awaiting_approval",
      rule_name: "haanji_sarvam_quota_resolved",
      created_at: new Date(nowMs).toISOString(),
      timeout_minutes: 30,
      evidence: {
        pod_status: "2/2 Running (haanji-api), 2/2 Running (haanji-worker)",
        cpu_usage: "8% avg",
        restarts: 0,
        worker_log_excerpt: "429 rate held at 0% for 120s healthy window.",
        recommendation:
          "Restore ops_degradation_level=0 (Live Voice) and rpm_budget=40.",
      },
      proposed_action: {
        level: 0,
        rpm_budget: 40,
        summary: "Restore Live Voice (Level 0)",
      },
    });
  }

  approveWorkflow(workflowId: string, approver: string): ApprovalWorkflowRun {
    const wf = this.workflows.find((w) => w.id === workflowId);
    if (!wf) {
      throw new Error(`Workflow ${workflowId} not found.`);
    }
    if (wf.status !== "awaiting_approval" && wf.status !== "investigation_ready") {
      throw new Error(`Workflow ${workflowId} is already ${wf.status}.`);
    }
    wf.status = "approved";
    wf.decided_by = approver;
    wf.decided_at = new Date().toISOString();

    flags.adminSetDegradation(
      wf.proposed_action.level,
      wf.proposed_action.rpm_budget,
      `nudgebee:${approver}`,
      `${wf.kind} approved for incident ${wf.fingerprint}`
    );
    capabilities.recordEvent(
      "nudgebee",
      `Approved ${wf.kind} (${approver}) -> Flagsmith Level ${wf.proposed_action.level}`
    );
    return wf;
  }

  rejectWorkflow(workflowId: string, actor: string): ApprovalWorkflowRun {
    const wf = this.workflows.find((w) => w.id === workflowId);
    if (!wf) {
      throw new Error(`Workflow ${workflowId} not found.`);
    }
    wf.status = "rejected";
    wf.decided_by = actor;
    wf.decided_at = new Date().toISOString();
    capabilities.recordEvent(
      "nudgebee",
      `Rejected ${wf.kind} (${actor}) -> Flagsmith unchanged`
    );
    // SAFETY INVARIANT: Flagsmith state does NOT change on reject
    return wf;
  }

  expireTimedOutWorkflows(nowMs = Date.now()): number {
    let count = 0;
    for (const wf of this.workflows) {
      if (wf.status === "awaiting_approval") {
        const ageMs = nowMs - new Date(wf.created_at).getTime();
        if (ageMs >= wf.timeout_minutes * 60_000) {
          wf.status = "timed_out";
          count += 1;
        }
      }
    }
    return count;
  }

  tryClaimLeader(replicaId: string, nowMs = Date.now()): boolean {
    if (replicaId === this.leaderId || nowMs > this.leaderLeaseUntilMs) {
      this.leaderId = replicaId;
      this.leaderLeaseUntilMs = nowMs + 30_000;
      return true;
    }
    return false;
  }

  releaseLeader(): void {
    this.leaderLeaseUntilMs = 0;
  }

  getSnapshot(): AlerterSnapshot {
    return {
      status: this.status,
      fingerprint: this.fingerprint,
      healthy_since_ms: this.healthySinceMs,
      last_fire_ms: this.lastFireMs,
      events: [...this.events],
      workflows: [...this.workflows],
      active_leader_id: this.leaderId,
      dead_webhook_mode: this.deadWebhookMode,
      webhook_retries_log: [...this.webhookRetriesLog],
    };
  }

  startBackgroundLoop(intervalMs = 5000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const s = metrics.getRollingStats60s();
      this.tick({
        rate429_pct_60s: s.rate429_pct_60s,
        rpm_60s: s.rpm_60s,
        p95_chat_60s: s.p95_chat_60s,
        queue_depth: s.queue_depth,
      });
    }, intervalMs);
  }

  stopBackgroundLoop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  reset(): void {
    this.status = "ok";
    this.fingerprint = null;
    this.healthySinceMs = null;
    this.lastFireMs = null;
    this.events = [];
    this.workflows = [];
    this.leaderId = "api-replica-1";
    this.leaderLeaseUntilMs = Date.now() + 30_000;
  }
}

export const alerter = new AlerterStateMachine();
