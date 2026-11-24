import type { DegradationLevel } from "./types.ts";

interface SarvamBucketEntry {
  ts: number; // ms
  api: "stt" | "chat" | "tts" | "translate";
  status: string; // "200" | "429" | "402" | "500"
  seconds: number;
}

export class MetricsRegistry {
  private sarvamEvents: SarvamBucketEntry[] = [];
  private sarvamTotals = new Map<string, number>();
  private turnsTotals = new Map<string, number>();
  private rsvpCompletedCount = 0;
  private groundingViolationsCount = 0;
  private currentQueueDepth = 0;
  private currentDegradationLevel: DegradationLevel = 0;

  observeSarvam(
    api: "stt" | "chat" | "tts" | "translate",
    status: string,
    seconds: number,
    nowMs = Date.now()
  ): void {
    const key = `${api}|${status}`;
    this.sarvamTotals.set(key, (this.sarvamTotals.get(key) ?? 0) + 1);
    this.sarvamEvents.push({ ts: nowMs, api, status, seconds });
    this.pruneOld(nowMs);
  }

  recordTurn(level: DegradationLevel, outcome: "answered" | "queued" | "busy" | "error"): void {
    const key = `${level}|${outcome}`;
    this.turnsTotals.set(key, (this.turnsTotals.get(key) ?? 0) + 1);
  }

  recordRsvpCompleted(): void {
    this.rsvpCompletedCount += 1;
  }

  recordGroundingViolation(): void {
    this.groundingViolationsCount += 1;
  }

  setQueueDepth(depth: number): void {
    this.currentQueueDepth = Math.max(0, depth);
  }

  setDegradationLevel(level: DegradationLevel): void {
    this.currentDegradationLevel = level;
  }

  private pruneOld(nowMs = Date.now()): void {
    const cutoff = nowMs - 10 * 60 * 1000; // keep 10 min history
    if (this.sarvamEvents.length > 5000) {
      this.sarvamEvents = this.sarvamEvents.filter((e) => e.ts >= cutoff);
    }
  }

  getRollingStats60s(nowMs = Date.now()): {
    rpm_60s: number;
    sarvam_429_last_60s: number;
    rate429_pct_60s: number;
    p95_chat_60s: number;
    tts_60s: number;
    queue_depth: number;
    degradation_level: DegradationLevel;
  } {
    const cutoff = nowMs - 60_000;
    const recent = this.sarvamEvents.filter((e) => e.ts >= cutoff && e.ts <= nowMs);
    const total = recent.length;
    const count429 = recent.filter((e) => e.status === "429").length;
    const pct429 = total > 0 ? Number(((count429 / total) * 100).toFixed(1)) : 0;
    const chatLatencies = recent
      .filter((e) => e.api === "chat")
      .map((e) => e.seconds)
      .sort((a, b) => a - b);
    const p95Chat =
      chatLatencies.length > 0
        ? chatLatencies[Math.min(chatLatencies.length - 1, Math.floor(chatLatencies.length * 0.95))]
        : 0;
    const ttsCount = recent.filter((e) => e.api === "tts").length;

    return {
      rpm_60s: total,
      sarvam_429_last_60s: count429,
      rate429_pct_60s: pct429,
      p95_chat_60s: Number(p95Chat.toFixed(3)),
      tts_60s: ttsCount,
      queue_depth: this.currentQueueDepth,
      degradation_level: this.currentDegradationLevel,
    };
  }

  getTimeSeries(nowMs = Date.now(), seconds = 120): Array<{
    t: string;
    rpm: number;
    rate429Pct: number;
    tts: number;
  }> {
    const bucketSizeMs = 5000;
    const numBuckets = Math.floor((seconds * 1000) / bucketSizeMs);
    const result: Array<{ t: string; rpm: number; rate429Pct: number; tts: number }> = [];
    for (let i = numBuckets - 1; i >= 0; i--) {
      const end = nowMs - i * bucketSizeMs;
      const start = end - bucketSizeMs;
      const slice = this.sarvamEvents.filter((e) => e.ts > start && e.ts <= end);
      const count429 = slice.filter((e) => e.status === "429").length;
      const tts = slice.filter((e) => e.api === "tts").length;
      const extrapolatedRpm = slice.length * (60_000 / bucketSizeMs);
      const rate429Pct = slice.length > 0 ? Math.round((count429 / slice.length) * 100) : 0;
      const d = new Date(end);
      const label = `${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
      result.push({ t: label, rpm: extrapolatedRpm, rate429Pct, tts });
    }
    return result;
  }

  getTotals(): {
    sarvam: Record<string, number>;
    turns: Record<string, number>;
    rsvp_completed: number;
    grounding_violations: number;
  } {
    return {
      sarvam: Object.fromEntries(this.sarvamTotals.entries()),
      turns: Object.fromEntries(this.turnsTotals.entries()),
      rsvp_completed: this.rsvpCompletedCount,
      grounding_violations: this.groundingViolationsCount,
    };
  }

  exportPrometheusText(): string {
    const lines: string[] = [
      "# HELP haanji_sarvam_requests_total Total upstream AI/Sarvam API attempts by api and status",
      "# TYPE haanji_sarvam_requests_total counter",
    ];
    for (const [k, v] of this.sarvamTotals.entries()) {
      const [api, status] = k.split("|");
      lines.push(`haanji_sarvam_requests_total{api="${api}",status="${status}"} ${v.toFixed(1)}`);
    }
    lines.push("# HELP haanji_turns_total Guest turns processed by degradation level and outcome");
    lines.push("# TYPE haanji_turns_total counter");
    for (const [k, v] of this.turnsTotals.entries()) {
      const [level, outcome] = k.split("|");
      lines.push(`haanji_turns_total{level="${level}",outcome="${outcome}"} ${v.toFixed(1)}`);
    }
    lines.push("# HELP haanji_rsvp_completed_total Total guests who completed RSVP");
    lines.push("# TYPE haanji_rsvp_completed_total counter");
    lines.push(`haanji_rsvp_completed_total ${this.rsvpCompletedCount.toFixed(1)}`);
    lines.push("# HELP haanji_grounding_violations_total Total answers blocked by grounding guard");
    lines.push("# TYPE haanji_grounding_violations_total counter");
    lines.push(`haanji_grounding_violations_total ${this.groundingViolationsCount.toFixed(1)}`);
    lines.push("# HELP haanji_queue_depth Current queued guest turns");
    lines.push("# TYPE haanji_queue_depth gauge");
    lines.push(`haanji_queue_depth ${this.currentQueueDepth}`);
    lines.push("# HELP haanji_degradation_level Current ops degradation level (0, 1, or 2)");
    lines.push("# TYPE haanji_degradation_level gauge");
    lines.push(`haanji_degradation_level ${this.currentDegradationLevel}`);
    return lines.join("\n") + "\n";
  }

  reset(): void {
    this.sarvamEvents = [];
    this.sarvamTotals.clear();
    this.turnsTotals.clear();
    this.rsvpCompletedCount = 0;
    this.groundingViolationsCount = 0;
    this.currentQueueDepth = 0;
  }
}

export const metrics = new MetricsRegistry();
