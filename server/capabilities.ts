import { GoogleGenAI } from "@google/genai";

export interface CapabilitiesStatus {
  live_ai: boolean;
  live_ai_provider: "sarvam" | "gemini" | "none";
  live_ai_reason: string;
  sarvam: boolean;
  sarvam_reason: string;
  gemini: boolean;
  gemini_reason: string;
  flagsmith: boolean;
  flagsmith_reason: string;
  nudgebee: boolean;
  nudgebee_reason: string;
  checked_at: string;
  cache_ttl_seconds: number;
  last_events: {
    sarvam: { summary: string; ts: string | null };
    flagsmith: { summary: string; ts: string | null };
    nudgebee: { summary: string; ts: string | null };
  };
}

class CapabilitiesManager {
  private cached: CapabilitiesStatus | null = null;
  private cachedAtMs = 0;
  private readonly ttlMs = 60_000;
  private lastEvents = {
    sarvam: { summary: "No live AI turns handled yet", ts: null as string | null },
    flagsmith: { summary: "Using contract default flags", ts: null as string | null },
    nudgebee: { summary: "No incident alerts sent yet", ts: null as string | null },
  };

  recordEvent(source: "sarvam" | "flagsmith" | "nudgebee", summary: string): void {
    this.lastEvents[source] = {
      summary,
      ts: new Date().toISOString(),
    };
  }

  invalidateCache(): void {
    this.cached = null;
    this.cachedAtMs = 0;
  }

  private async probeSarvam(): Promise<{ ok: boolean; reason: string }> {
    const key = process.env.SARVAM_API_KEY?.trim();
    if (!key) {
      return { ok: false, reason: "SARVAM_API_KEY not set" };
    }
    try {
      const res = await fetch("https://api.sarvam.ai/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-subscription-key": key,
        },
        body: JSON.stringify({
          input: "Hello",
          source_language_code: "en-IN",
          target_language_code: "hi-IN",
          model: "mayura:v1",
        }),
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        return { ok: true, reason: "Sarvam translate check passed" };
      }
      return { ok: false, reason: `Sarvam returned HTTP ${res.status}` };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : "Sarvam unreachable",
      };
    }
  }

  private async probeGemini(): Promise<{ ok: boolean; reason: string }> {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key || key === "MY_GEMINI_API_KEY") {
      return { ok: false, reason: "GEMINI_API_KEY not set" };
    }
    try {
      const ai = new GoogleGenAI({
        apiKey: key,
        apiVersion: "v1beta",
        httpOptions: { headers: { "User-Agent": "aistudio-build" } },
      });
      await ai.models.get({ model: "gemini-3.1-flash-lite" });
      return { ok: true, reason: "Gemini AI verified" };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : "Gemini check failed",
      };
    }
  }

  private async probeFlagsmith(): Promise<{ ok: boolean; reason: string }> {
    const envKey = (process.env.FLAGSMITH_ENV_KEY || process.env.FLAGSMITH_SERVER_KEY || "").trim();
    if (!envKey) {
      return { ok: false, reason: "FLAGSMITH_ENV_KEY not set" };
    }
    try {
      const res = await fetch("https://edge.api.flagsmith.com/api/v1/flags/", {
        method: "GET",
        headers: {
          "X-Environment-Key": envKey,
        },
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        return { ok: true, reason: "Flagsmith environment API verified" };
      }
      return { ok: false, reason: `Flagsmith returned HTTP ${res.status}` };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : "Flagsmith unreachable",
      };
    }
  }

  private async probeNudgebee(): Promise<{ ok: boolean; reason: string }> {
    const webhookUrl = process.env.NUDGEBEE_EVENT_WEBHOOK_URL?.trim();
    if (!webhookUrl) {
      return { ok: false, reason: "NUDGEBEE_EVENT_WEBHOOK_URL not set" };
    }
    try {
      const parsed = new URL(webhookUrl);
      const token = process.env.NUDGEBEE_API_TOKEN?.trim();
      const res = await fetch(parsed.origin, {
        method: "HEAD",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(4000),
      });
      if (res.status < 500) {
        return {
          ok: true,
          reason: token
            ? "NudgeBee endpoint reachable & token configured"
            : "NudgeBee webhook endpoint reachable",
        };
      }
      return { ok: false, reason: `NudgeBee returned HTTP ${res.status}` };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : "NudgeBee unreachable",
      };
    }
  }

  async getCapabilities(forceRefresh = false): Promise<CapabilitiesStatus> {
    const now = Date.now();
    if (!forceRefresh && this.cached && now - this.cachedAtMs < this.ttlMs) {
      return {
        ...this.cached,
        last_events: { ...this.lastEvents },
      };
    }

    const [sarvamRes, geminiRes, flagsmithRes, nudgebeeRes] = await Promise.all([
      this.probeSarvam(),
      this.probeGemini(),
      this.probeFlagsmith(),
      this.probeNudgebee(),
    ]);

    const liveAi = sarvamRes.ok || geminiRes.ok;
    const provider: CapabilitiesStatus["live_ai_provider"] = sarvamRes.ok
      ? "sarvam"
      : geminiRes.ok
        ? "gemini"
        : "none";
    const liveReason = sarvamRes.ok
      ? sarvamRes.reason
      : geminiRes.ok
        ? `${geminiRes.reason} (SARVAM_API_KEY not set)`
        : `${sarvamRes.reason}; ${geminiRes.reason}`;

    const result: CapabilitiesStatus = {
      live_ai: liveAi,
      live_ai_provider: provider,
      live_ai_reason: liveReason,
      sarvam: sarvamRes.ok,
      sarvam_reason: sarvamRes.reason,
      gemini: geminiRes.ok,
      gemini_reason: geminiRes.reason,
      flagsmith: flagsmithRes.ok,
      flagsmith_reason: flagsmithRes.reason,
      nudgebee: nudgebeeRes.ok,
      nudgebee_reason: nudgebeeRes.reason,
      checked_at: new Date().toISOString(),
      cache_ttl_seconds: 60,
      last_events: { ...this.lastEvents },
    };

    this.cached = result;
    this.cachedAtMs = now;
    return result;
  }

  async logStartupCapabilities(): Promise<void> {
    const caps = await this.getCapabilities(true);
    console.log(
      `[HaanJi] Sarvam: ${caps.sarvam ? "ON" : `OFF (${caps.sarvam_reason})`}`
    );
    console.log(
      `[HaanJi] Gemini: ${caps.gemini ? "ON" : `OFF (${caps.gemini_reason})`}`
    );
    console.log(
      `[HaanJi] Flagsmith: ${caps.flagsmith ? "ON" : `OFF (${caps.flagsmith_reason})`}`
    );
    console.log(
      `[HaanJi] NudgeBee: ${caps.nudgebee ? "ON" : `OFF (${caps.nudgebee_reason})`}`
    );
  }
}

export const capabilities = new CapabilitiesManager();
