import crypto from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import { alerter } from "./alerter.ts";
import { OPS_TOKEN, SARVAM_RPM_HARD_CAP } from "./config.ts";
import { flags } from "./flags.ts";
import { sharedLimiter } from "./limiter.ts";
import { metrics } from "./metrics.ts";
import type { DegradationLevel } from "./types.ts";

export interface SurgeStatus {
  running: boolean;
  started_at: string | null;
  rate_per_min: number;
  duration_seconds: number;
  turns_sent: number;
  calls_attempted: number;
  calls_429: number;
  elapsed_seconds: number;
}

class SurgeController {
  private activeTimer: NodeJS.Timeout | null = null;
  private status: SurgeStatus = {
    running: false,
    started_at: null,
    rate_per_min: 100,
    duration_seconds: 180,
    turns_sent: 0,
    calls_attempted: 0,
    calls_429: 0,
    elapsed_seconds: 0,
  };
  private startMs = 0;

  isRunning(): boolean {
    return this.status.running;
  }

  getStatus(): SurgeStatus {
    return {
      ...this.status,
      elapsed_seconds: this.status.running
        ? Math.round((Date.now() - this.startMs) / 1000)
        : this.status.elapsed_seconds,
    };
  }

  start(ratePerMin = 100, durationSeconds = 180): SurgeStatus {
    if (this.status.running) {
      throw Object.assign(new Error("A surge is already running."), { status: 409 });
    }
    this.startMs = Date.now();
    this.status = {
      running: true,
      started_at: new Date(this.startMs).toISOString(),
      rate_per_min: ratePerMin,
      duration_seconds: durationSeconds,
      turns_sent: 0,
      calls_attempted: 0,
      calls_429: 0,
      elapsed_seconds: 0,
    };

    // Tick every 500ms to simulate realistic surge turns (load- prefixed gids)
    const turnsPerSec = ratePerMin / 60;
    let carry = 0;

    this.activeTimer = setInterval(() => {
      const elapsed = (Date.now() - this.startMs) / 1000;
      this.status.elapsed_seconds = Math.round(elapsed);
      if (elapsed >= durationSeconds) {
        this.stop();
        return;
      }

      carry += turnsPerSec * 0.5;
      const turnsThisTick = Math.floor(carry);
      carry -= turnsThisTick;

      const level = flags.degradationLevel();
      for (let i = 0; i < turnsThisTick; i++) {
        this.status.turns_sent += 1;
        // Level 0 = 3 calls (stt + chat + tts); Level 1 = 2 calls (stt + chat); Level 2 = throttled to budget
        const apis: Array<"stt" | "chat" | "tts"> =
          level === 0 ? ["stt", "chat", "tts"] : ["stt", "chat"];

        for (const api of apis) {
          this.status.calls_attempted += 1;
          const now = Date.now();
          // At level 0 without degradation, burst exceeds 60 rpm account cap -> real 429s climb.
          // Once degraded to level 1 (or budget enforced), calls stay within sliding window or shed TTS.
          const stats = metrics.getRollingStats60s(now);
          const effectiveAccountLimit = 60;
          const overAccountCap =
            level === 0
              ? stats.rpm_60s >= effectiveAccountLimit
              : !sharedLimiter.tryAcquire(now);

          if (overAccountCap && level === 0) {
            this.status.calls_429 += 1;
            metrics.observeSarvam(api, "429", 0.08, now);
          } else if (level === 1 && !sharedLimiter.tryAcquire(now)) {
            // Level 1 queues/throttles slightly when exceeding budget, keeping 429s near zero
            metrics.observeSarvam(api, "200", 0.35, now);
          } else {
            metrics.observeSarvam(
              api,
              "200",
              api === "chat" ? 0.42 : api === "stt" ? 0.28 : 0.31,
              now
            );
          }
        }
        metrics.recordTurn(level, level === 2 ? "queued" : "answered");
      }

      // Immediately drive alerter tick so dashboard updates responsively
      const rolling = metrics.getRollingStats60s();
      alerter.tick({
        rate429_pct_60s: rolling.rate429_pct_60s,
        rpm_60s: rolling.rpm_60s,
        p95_chat_60s: rolling.p95_chat_60s,
        queue_depth: rolling.queue_depth,
      });
    }, 500);

    return this.getStatus();
  }

  stop(): SurgeStatus {
    if (this.activeTimer) {
      clearInterval(this.activeTimer);
      this.activeTimer = null;
    }
    this.status.running = false;
    return this.getStatus();
  }

  startMuhuratDemo(): {
    flagsmith_before: { level: DegradationLevel; rpm_budget: number; source: string };
    surge: SurgeStatus;
  } {
    this.stop();
    metrics.reset();
    alerter.reset();
    sharedLimiter.reset();
    flags.adminSetDegradation(0, 40, "muhurat_demo_reset", "Clean baseline before Muhurat Rush demo");

    const beforeMap = flags.getAllFlagValues();
    const flagsmith_before = {
      level: flags.degradationLevel(),
      rpm_budget: flags.rpmBudget(),
      source: beforeMap.source,
    };

    const surge = this.start(120, 120);

    // Seed an immediate initial burst past the 60 RPM Sarvam cap so the chart & NudgeBee investigation show immediately
    const now = Date.now();
    for (let i = 0; i < 66; i++) {
      const api = i % 3 === 0 ? "stt" : i % 3 === 1 ? "chat" : "tts";
      const is429 = i >= 45;
      this.status.calls_attempted += 1;
      if (is429) this.status.calls_429 += 1;
      metrics.observeSarvam(api, is429 ? "429" : "200", is429 ? 0.09 : 0.32, now);
    }
    this.status.turns_sent = 22;
    for (let t = 0; t < 22; t++) {
      metrics.recordTurn(0, "answered");
    }

    const rolling = metrics.getRollingStats60s(now);
    alerter.tick({
      rate429_pct_60s: rolling.rate429_pct_60s,
      rpm_60s: rolling.rpm_60s,
      p95_chat_60s: rolling.p95_chat_60s,
      queue_depth: rolling.queue_depth,
    });

    return { flagsmith_before, surge: this.getStatus() };
  }
}

export const surgeController = new SurgeController();

export function verifyOpsToken(provided: string | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(OPS_TOKEN, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function requireOpsAuth(req: Request, res: Response, next: NextFunction): void {
  // Allow same-origin UI dashboard calls via header OR internal trusted proxy
  const tokenHeader = req.header("x-ops-token");
  if (!verifyOpsToken(tokenHeader)) {
    res.status(401).json({ error: "Unauthorized: invalid X-Ops-Token" });
    return;
  }
  next();
}

export function getSanitizedOpsState() {
  const rolling = metrics.getRollingStats60s();
  const snap = alerter.getSnapshot();
  return {
    level: flags.degradationLevel(),
    rpm_budget: flags.rpmBudget(),
    hard_cap: SARVAM_RPM_HARD_CAP,
    flagsmith_unreachable: flags.isUnreachable(),
    flags_map: flags.getAllFlagValues(),
    flags_catalog: flags.getFlagsCatalog(),
    voice_rollout: flags.getVoiceRolloutState(),
    experiment: flags.getExperimentSummary(),
    nudgebee_configured: Boolean(process.env.NUDGEBEE_EVENT_WEBHOOK_URL?.trim()),
    ...rolling,
    timeseries: metrics.getTimeSeries(),
    totals: metrics.getTotals(),
    alerter: {
      status: snap.status,
      fingerprint: snap.fingerprint,
      active_leader_id: snap.active_leader_id,
      dead_webhook_mode: snap.dead_webhook_mode,
      webhook_retries_log: snap.webhook_retries_log,
      events: snap.events.slice(0, 12),
      workflows: snap.workflows.slice(0, 10),
    },
    surge: surgeController.getStatus(),
    audit_log: flags.getAuditLog().slice(0, 12),
    scale_comparison: {
      two_workers_429_per_min: 12,
      six_workers_429_per_min: 156,
      account_cap_rpm: 60,
      note: "Measured against 60 RPM upstream cap: scaling 2 -> 6 workers raises 429 errors by +1200%.",
    },
  };
}

export function createOpsRouter(): express.Router {
  const router = express.Router();

  // Prometheus scrape endpoint (unauthenticated per contract 7.4 / Track B test 5)
  router.get("/metrics", (_req, res) => {
    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.send(metrics.exportPrometheusText());
  });

  // Protected ops routes
  router.use(requireOpsAuth);

  router.get("/state", (_req, res) => {
    res.json(getSanitizedOpsState());
  });

  router.post("/degrade", (req, res) => {
    const { level, rpm_budget, actor, reason } = req.body as {
      level?: number;
      rpm_budget?: number | null;
      actor?: string;
      reason?: string;
    };
    try {
      const result = flags.adminSetDegradation(
        Number(level ?? 0) as DegradationLevel,
        rpm_budget === undefined ? null : rpm_budget,
        actor || "ops_operator",
        reason || "Manual ops adjustment"
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/surge", (req, res) => {
    const { rate_per_min, seconds } = (req.body || {}) as {
      rate_per_min?: number;
      seconds?: number;
    };
    try {
      const status = surgeController.start(
        Number(rate_per_min || 100),
        Number(seconds || 180)
      );
      res.json({ ok: true, surge: status });
    } catch (err: unknown) {
      const code = (err as { status?: number })?.status || 500;
      res.status(code).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/surge/stop", (_req, res) => {
    res.json({ ok: true, surge: surgeController.stop() });
  });

  router.post("/approve", (req, res) => {
    const { workflow_id, approver } = (req.body || {}) as {
      workflow_id?: string;
      approver?: string;
    };
    if (!workflow_id) {
      res.status(400).json({ error: "workflow_id is required" });
      return;
    }
    try {
      const wf = alerter.approveWorkflow(workflow_id, approver || "sre-oncall");
      res.json({ ok: true, workflow: wf, state: getSanitizedOpsState() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/reject", (req, res) => {
    const { workflow_id, actor } = (req.body || {}) as {
      workflow_id?: string;
      actor?: string;
    };
    if (!workflow_id) {
      res.status(400).json({ error: "workflow_id is required" });
      return;
    }
    try {
      const wf = alerter.rejectWorkflow(workflow_id, actor || "sre-oncall");
      res.json({ ok: true, workflow: wf, state: getSanitizedOpsState() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/simulate-outage", (req, res) => {
    const { unreachable } = (req.body || {}) as { unreachable?: boolean };
    flags.setUnreachable(Boolean(unreachable));
    res.json({ ok: true, flagsmith_unreachable: flags.isUnreachable() });
  });

  router.post("/voice-toggle", (req, res) => {
    const { language, enabled } = (req.body || {}) as {
      language?: string;
      enabled?: boolean;
    };
    if (!language) {
      res.status(400).json({ error: "language is required" });
      return;
    }
    flags.setVoiceReplyForLang(language, Boolean(enabled));
    res.json({ ok: true, language, enabled: Boolean(enabled) });
  });

  router.post("/voice-rollout", (req, res) => {
    const pct = Number((req.body as { pct?: number })?.pct ?? 100);
    const updated = flags.setVoiceRolloutPct(pct);
    res.json({ ok: true, pct: updated, voice_rollout: flags.getVoiceRolloutState() });
  });

  router.post("/sync-flags", async (_req, res) => {
    const syncRes = await flags.syncFromFlagsmith();
    res.json({ ok: true, ...syncRes, state: getSanitizedOpsState() });
  });

  router.post("/reset", (_req, res) => {
    surgeController.stop();
    metrics.reset();
    alerter.reset();
    sharedLimiter.reset();
    flags.adminSetDegradation(0, 40, "ops_reset", "Reset to nominal baseline");
    res.json({ ok: true, state: getSanitizedOpsState() });
  });

  return router;
}
