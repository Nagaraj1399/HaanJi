import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import express from "express";
import { createServer as createViteServer } from "vite";
import { alerter } from "./server/alerter.ts";
import { translateAnnouncement } from "./server/brain.ts";
import { HOST_KEY, OPS_TOKEN, PERSONAS } from "./server/config.ts";
import { flags } from "./server/flags.ts";
import { metrics } from "./server/metrics.ts";
import {
  createOpsRouter,
  getSanitizedOpsState,
  surgeController,
} from "./server/routes_ops.ts";
import { store } from "./server/store.ts";
import {
  runCausalLoopProof,
  runGoldenSetEvaluation,
  runTrackAUnitTests,
  runTrackBUnitTests,
} from "./server/tests/runner.ts";
import { FunctionId, RsvpPatch, TestCaseResult } from "./server/types.ts";
import { AudioValidationError, worker } from "./server/worker.ts";

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  // Start background alerter tick loop
  alerter.startBackgroundLoop(5000);

  // Healthz
  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      service: "haanji",
      level: flags.degradationLevel(),
      timestamp: new Date().toISOString(),
    });
  });

  // --- Guest Routes ---
  app.get("/api/card", (req, res) => {
    const gid = String(req.query.gid || "guest-anon");
    const card = store.getCard();
    const level = flags.degradationLevel();
    const persona = flags.persona(gid);
    res.json({
      card,
      level,
      persona,
      persona_label: PERSONAS[persona].label,
      rsvp: store.getRsvp(gid),
      announcements: store.getAnnouncements(),
    });
  });

  app.post("/api/turn", (req, res) => {
    try {
      const body = req.body as {
        gid?: string;
        text?: string;
        audioBase64?: string;
        audioMime?: string;
        audioBytes?: number;
        audioDurationSeconds?: number;
        languageHint?: string;
        executionMode?: "live" | "replay";
      };
      const gid = (body.gid || "").trim() || `anon-${Date.now()}`;
      if (!body.text && !body.audioBase64) {
        res.status(400).json({ error: "Either text or audioBase64 is required." });
        return;
      }
      const queued = worker.enqueueTurn({
        gid,
        text: body.text,
        audioBase64: body.audioBase64,
        audioMime: body.audioMime,
        audioBytes: body.audioBytes,
        audioDurationSeconds: body.audioDurationSeconds,
        languageHint: body.languageHint,
        executionMode: body.executionMode || "live",
      });
      res.json(queued);
    } catch (err) {
      if (err instanceof AudioValidationError) {
        res.status(413).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/turn/:jobId", (req, res) => {
    const job = worker.getJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json(job);
  });

  app.get("/api/rsvp/:gid", (req, res) => {
    res.json({ rsvp: store.getRsvp(req.params.gid) });
  });

  app.post("/api/rsvp/:gid", (req, res) => {
    try {
      const patch = req.body as RsvpPatch;
      const result = store.applyRsvpPatch(req.params.gid, patch);
      if (result.becameCompleteFirstTime) {
        flags.trackRsvpCompleted(req.params.gid);
      }
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // --- Host Routes (key-protected, returns 403 on wrong key) ---
  function checkHostKey(req: express.Request, res: express.Response): boolean {
    const key = String(req.query.k || req.header("x-host-key") || "");
    if (key !== HOST_KEY) {
      res.status(403).json({ error: "Forbidden: invalid host key" });
      return false;
    }
    return true;
  }

  app.get("/api/host/state", (req, res) => {
    if (!checkHostKey(req, res)) return;
    const ops = getSanitizedOpsState();
    res.json({
      caterer: store.getCatererSummary(),
      rsvps: store.getAllRsvps(),
      unanswered: store.getUnanswered(),
      experiment: flags.getExperimentSummary(),
      card: store.getCard(),
      announcements: store.getAnnouncements(),
      // Proxied ops summary (never exposes OPS_TOKEN)
      ops_chip: {
        level: ops.level,
        rpm_60s: ops.rpm_60s,
        sarvam_429_last_60s: ops.sarvam_429_last_60s,
        rate429_pct_60s: ops.rate429_pct_60s,
        alerter_status: ops.alerter.status,
      },
    });
  });

  app.post("/api/host/add-to-card", (req, res) => {
    if (!checkHostKey(req, res)) return;
    const { id, answer } = req.body as { id?: string; answer?: string };
    if (!id || !answer?.trim()) {
      res.status(400).json({ error: "id and answer are required" });
      return;
    }
    const updated = store.resolveUnansweredAndAddToCard(id, answer.trim());
    if (!updated) {
      res.status(404).json({ error: "Unanswered question not found" });
      return;
    }
    res.json({ ok: true, item: updated, faqs: store.getCard().faqs });
  });

  app.post("/api/host/announcement", async (req, res) => {
    if (!checkHostKey(req, res)) return;
    const { text } = req.body as { text?: string };
    if (!text?.trim()) {
      res.status(400).json({ error: "Announcement text is required" });
      return;
    }
    try {
      const translations = await translateAnnouncement(text.trim());
      const ann = store.addAnnouncement(text.trim(), translations);
      res.json({ ok: true, announcement: ann });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // --- Ops Routes (/ops/* requires X-Ops-Token except /ops/metrics) ---
  app.use("/ops", createOpsRouter());
  app.get("/metrics", (_req, res) => {
    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.send(metrics.exportPrometheusText());
  });

  // Server-side Ops Proxy for the in-app Ops Control Plane UI (keeps OPS_TOKEN off client)
  app.get("/api/ops-proxy/state", (_req, res) => {
    res.json({
      ...getSanitizedOpsState(),
      voice_reply: {
        "hi-IN": flags.voiceReplyEnabled("hi-IN"),
        "en-IN": flags.voiceReplyEnabled("en-IN"),
        "kn-IN": flags.voiceReplyEnabled("kn-IN"),
        "ta-IN": flags.voiceReplyEnabled("ta-IN"),
      },
    });
  });

  app.post("/api/ops-proxy/degrade", (req, res) => {
    try {
      const { level, rpm_budget, actor, reason } = req.body as {
        level?: number;
        rpm_budget?: number | null;
        actor?: string;
        reason?: string;
      };
      const out = flags.adminSetDegradation(
        Number(level ?? 0),
        rpm_budget === undefined ? null : rpm_budget,
        actor || "ops_ui",
        reason || "Manual control plane override"
      );
      res.json({ ok: true, ...out, state: getSanitizedOpsState() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/ops-proxy/surge", (req, res) => {
    try {
      const { rate_per_min, seconds } = (req.body || {}) as {
        rate_per_min?: number;
        seconds?: number;
      };
      const surge = surgeController.start(
        Number(rate_per_min || 100),
        Number(seconds || 180)
      );
      res.json({ ok: true, surge });
    } catch (err: unknown) {
      const code = (err as { status?: number })?.status || 500;
      res.status(code).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/ops-proxy/surge/stop", (_req, res) => {
    res.json({ ok: true, surge: surgeController.stop() });
  });

  app.post("/api/ops-proxy/approve", (req, res) => {
    const { workflow_id, approver } = (req.body || {}) as {
      workflow_id?: string;
      approver?: string;
    };
    if (!workflow_id) {
      res.status(400).json({ error: "workflow_id required" });
      return;
    }
    try {
      const wf = alerter.approveWorkflow(workflow_id, approver || "priya.sharma@haanji.in");
      res.json({ ok: true, workflow: wf, state: getSanitizedOpsState() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/ops-proxy/reject", (req, res) => {
    const { workflow_id, actor } = (req.body || {}) as {
      workflow_id?: string;
      actor?: string;
    };
    if (!workflow_id) {
      res.status(400).json({ error: "workflow_id required" });
      return;
    }
    try {
      const wf = alerter.rejectWorkflow(workflow_id, actor || "priya.sharma@haanji.in");
      res.json({ ok: true, workflow: wf, state: getSanitizedOpsState() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/ops-proxy/simulate-outage", (req, res) => {
    flags.setUnreachable(Boolean((req.body as { unreachable?: boolean })?.unreachable));
    res.json({ ok: true, flagsmith_unreachable: flags.isUnreachable() });
  });

  app.post("/api/ops-proxy/voice-toggle", (req, res) => {
    const { language, enabled } = req.body as { language?: string; enabled?: boolean };
    if (!language) {
      res.status(400).json({ error: "language required" });
      return;
    }
    flags.setVoiceReplyForLang(language, Boolean(enabled));
    res.json({ ok: true, language, enabled: Boolean(enabled) });
  });

  app.post("/api/ops-proxy/reset", (_req, res) => {
    surgeController.stop();
    metrics.reset();
    alerter.reset();
    flags.adminSetDegradation(0, 40, "ops_reset", "Reset to nominal baseline");
    res.json({ ok: true, state: getSanitizedOpsState() });
  });

  // --- Testing App Endpoints ---
  app.post("/api/tests/track-a-unit", async (_req, res) => {
    const results = await runTrackAUnitTests();
    res.json({
      suite: "Track A Unit",
      passed: results.filter((r) => r.passed).length,
      total: results.length,
      results,
    });
  });

  app.post("/api/tests/golden", async (req, res) => {
    try {
      const mode = (req.body as { mode?: "replay" | "live" })?.mode === "live" ? "live" : "replay";
      const report = await runGoldenSetEvaluation(mode);
      res.json(report);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/tests/track-b-unit", async (_req, res) => {
    const results = await runTrackBUnitTests();
    res.json({
      suite: "Track B Ops Unit",
      passed: results.filter((r) => r.passed).length,
      total: results.length,
      results,
    });
  });

  app.post("/api/tests/causal-loop", async (_req, res) => {
    const report = await runCausalLoopProof();
    res.json(report);
  });

  app.post("/api/tests/api-security", async (_req, res) => {
    const base = `http://127.0.0.1:${PORT}`;
    const results: TestCaseResult[] = [];

    const check = async (id: string, name: string, fn: () => Promise<string>) => {
      const t0 = performance.now();
      try {
        const details = await fn();
        results.push({
          id,
          suite: "API & Security Scan",
          name,
          passed: true,
          duration_ms: Number((performance.now() - t0).toFixed(2)),
          details,
        });
      } catch (err) {
        results.push({
          id,
          suite: "API & Security Scan",
          name,
          passed: false,
          duration_ms: Number((performance.now() - t0).toFixed(2)),
          details: err instanceof Error ? err.message : String(err),
        });
      }
    };

    await check("SEC-1", "POST /api/turn responds in < 300ms with {job_id, level}", async () => {
      const t0 = performance.now();
      const r = await fetch(`${base}/api/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gid: "sec-test-1",
          text: "Sangeet kitne baje hai?",
          executionMode: "replay",
        }),
      });
      const dt = performance.now() - t0;
      const j = (await r.json()) as { job_id?: string; level?: number };
      if (!r.ok || !j.job_id || typeof j.level !== "number" || dt >= 300) {
        throw new Error(`Unexpected response: status=${r.status}, dt=${dt.toFixed(1)}ms`);
      }
      return `Returned job_id=${j.job_id}, level=${j.level} in ${dt.toFixed(1)}ms.`;
    });

    await check("SEC-2", "GET /api/host/state returns 403 without valid key, 200 with valid key", async () => {
      const bad = await fetch(`${base}/api/host/state?k=wrong`);
      if (bad.status !== 403) throw new Error(`Expected 403, got ${bad.status}`);
      const good = await fetch(`${base}/api/host/state?k=${encodeURIComponent(HOST_KEY)}`);
      if (good.status !== 200) throw new Error(`Expected 200, got ${good.status}`);
      const txt = await good.text();
      if (txt.includes(OPS_TOKEN)) throw new Error("OPS_TOKEN leaked in /api/host/state!");
      return "403 on bad key; 200 on valid key; zero OPS_TOKEN in host proxy response.";
    });

    await check("SEC-3", "GET /ops/state returns 401 without X-Ops-Token; /ops/metrics stays open", async () => {
      const unauth = await fetch(`${base}/ops/state`);
      if (unauth.status !== 401) throw new Error(`Expected 401, got ${unauth.status}`);
      const auth = await fetch(`${base}/ops/state`, {
        headers: { "X-Ops-Token": OPS_TOKEN },
      });
      if (auth.status !== 200) throw new Error(`Expected 200 with token, got ${auth.status}`);
      const met = await fetch(`${base}/ops/metrics`);
      if (met.status !== 200) throw new Error(`Expected 200 on /ops/metrics, got ${met.status}`);
      return "Enforced 401 on /ops/state; authenticated 200; /ops/metrics reachable.";
    });

    await check("SEC-4", "Secret-leak scan across API responses & src/ client files", async () => {
      const secrets = [OPS_TOKEN, process.env.GEMINI_API_KEY].filter(
        (s): s is string => Boolean(s && s.length > 8 && s !== "MY_GEMINI_API_KEY")
      );
      const endpoints = [
        `${base}/healthz`,
        `${base}/api/card?gid=scan`,
        `${base}/api/host/state?k=${encodeURIComponent(HOST_KEY)}`,
        `${base}/api/ops-proxy/state`,
      ];
      for (const url of endpoints) {
        const txt = await (await fetch(url)).text();
        for (const sec of secrets) {
          if (txt.includes(sec)) throw new Error(`Secret leaked in ${url}`);
        }
      }
      // Scan client src/ directory for accidental API keys
      const srcDir = path.resolve(process.cwd(), "src");
      const files = fs.readdirSync(srcDir, { recursive: true }) as string[];
      for (const f of files) {
        const full = path.join(srcDir, f);
        if (fs.statSync(full).isFile() && /\.(ts|tsx)$/.test(full)) {
          const content = fs.readFileSync(full, "utf8");
          if (/sk_[A-Za-z0-9]{10,}|AIza[A-Za-z0-9_-]{10,}|ser\.[A-Za-z0-9]{10,}/.test(content)) {
            throw new Error(`Pattern matched potential key in src/${f}`);
          }
        }
      }
      return `Scanned ${endpoints.length} live endpoints and ${files.length} client files: 0 secret leaks.`;
    });

    res.json({
      suite: "API & Security Scan",
      passed: results.filter((r) => r.passed).length,
      total: results.length,
      results,
    });
  });

  // Vite middleware in dev, static dist in prod
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`HaanJi server listening on http://0.0.0.0:${PORT}`);
    console.log(`Host Dashboard key (?k=): ${HOST_KEY}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
