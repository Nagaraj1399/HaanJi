import { SARVAM_RPM_HARD_CAP } from "./config.ts";
import { metrics } from "./metrics.ts";
import { DegradationLevel, FlagAuditEntry, PersonaArm } from "./types.ts";

export interface FlagsState {
  ops_degradation_level: DegradationLevel;
  sarvam_rpm_budget: number;
  rel_voice_reply: Record<string, boolean>;
  llm_config: {
    model: string;
    temperature: number;
    max_tokens: number;
  };
  unreachable: boolean;
}

const CONTRACT_DEFAULTS: FlagsState = {
  ops_degradation_level: 0,
  sarvam_rpm_budget: 40,
  rel_voice_reply: {
    "hi-IN": true,
    "en-IN": true,
    "kn-IN": true,
    "ta-IN": true,
  },
  llm_config: {
    model: "gemini-4-hydrogen",
    temperature: 0.2,
    max_tokens: 450,
  },
  unreachable: false,
};

function fnv1aHash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class FlagsClient {
  private state: FlagsState = structuredClone(CONTRACT_DEFAULTS);
  private exposures = new Map<string, PersonaArm>();
  private conversions = new Set<string>();
  private armExposures: Record<PersonaArm, number> = { formal: 0, warm: 0 };
  private armConversions: Record<PersonaArm, number> = { formal: 0, warm: 0 };
  private auditLog: FlagAuditEntry[] = [];
  private featureIdCache = new Map<string, number>();

  setUnreachable(flag: boolean): void {
    this.state.unreachable = flag;
  }

  isUnreachable(): boolean {
    return this.state.unreachable;
  }

  degradationLevel(): DegradationLevel {
    const lvl: DegradationLevel = this.state.unreachable
      ? 0
      : this.state.ops_degradation_level;
    metrics.setDegradationLevel(lvl);
    return lvl;
  }

  rpmBudget(): number {
    if (this.state.unreachable) return CONTRACT_DEFAULTS.sarvam_rpm_budget;
    return Math.min(Math.max(this.state.sarvam_rpm_budget, 5), SARVAM_RPM_HARD_CAP);
  }

  rawBudget(): number {
    return this.state.unreachable
      ? CONTRACT_DEFAULTS.sarvam_rpm_budget
      : this.state.sarvam_rpm_budget;
  }

  voiceReplyEnabled(languageCode: string): boolean {
    if (this.state.unreachable) return true;
    const exact = this.state.rel_voice_reply[languageCode];
    if (typeof exact === "boolean") return exact;
    const prefix = languageCode.split("-")[0];
    const byPrefix = Object.entries(this.state.rel_voice_reply).find(([k]) =>
      k.startsWith(prefix)
    );
    return byPrefix ? byPrefix[1] : true;
  }

  setVoiceReplyForLang(languageCode: string, enabled: boolean): void {
    this.state.rel_voice_reply[languageCode] = enabled;
  }

  llmConfig(): FlagsState["llm_config"] {
    if (this.state.unreachable) return CONTRACT_DEFAULTS.llm_config;
    return this.state.llm_config;
  }

  persona(gid: string, _traits?: Record<string, string>): PersonaArm {
    if (this.state.unreachable) {
      return "formal";
    }
    // Load-test gids MUST NEVER trigger experiment exposure
    if (gid.startsWith("load-")) {
      return "formal";
    }
    const existing = this.exposures.get(gid);
    if (existing) {
      return existing;
    }
    // Deterministic 50/50 hash split per gid
    const bucket = fnv1aHash(`exp_voice_persona:${gid}`) % 2;
    const arm: PersonaArm = bucket === 0 ? "formal" : "warm";
    this.exposures.set(gid, arm);
    this.armExposures[arm] += 1;
    return arm;
  }

  trackRsvpCompleted(gid: string): boolean {
    if (this.state.unreachable || gid.startsWith("load-")) {
      return false;
    }
    // Track at most once per gid
    if (this.conversions.has(gid)) {
      return false;
    }
    // Ensure exposure exists for same gid
    const arm = this.exposures.get(gid) ?? this.persona(gid);
    this.conversions.add(gid);
    this.armConversions[arm] += 1;
    metrics.recordRsvpCompleted();
    return true;
  }

  getExperimentSummary(): {
    arms: Record<
      PersonaArm,
      { exposures: number; completions: number; conversion_rate_pct: number }
    >;
    flagsmith_note: string;
  } {
    const calc = (arm: PersonaArm) => {
      const exp = this.armExposures[arm];
      const conv = this.armConversions[arm];
      return {
        exposures: exp,
        completions: conv,
        conversion_rate_pct: exp > 0 ? Number(((conv / exp) * 100).toFixed(1)) : 0,
      };
    };
    return {
      arms: {
        formal: calc("formal"),
        warm: calc("warm"),
      },
      flagsmith_note:
        "Local Redis-equivalent counters; Flagsmith Bayesian engine is the production source of truth.",
    };
  }

  adminSetDegradation(
    level: number,
    rpmBudget: number | null,
    actor: string,
    reason: string,
    bypassRangeValidation = false
  ): { level: DegradationLevel; rpm_budget: number; cached_feature_ids: number } {
    if (level !== 0 && level !== 1 && level !== 2) {
      throw new Error(`Invalid degradation level: ${level}. Must be 0, 1, or 2.`);
    }
    if (rpmBudget !== null && !bypassRangeValidation) {
      if (rpmBudget < 5 || rpmBudget > 55) {
        throw new Error(`Invalid rpm_budget: ${rpmBudget}. Must be between 5 and 55.`);
      }
    }
    // Simulate caching Flagsmith feature ID lookup after first call
    if (!this.featureIdCache.has("ops_degradation_level")) {
      this.featureIdCache.set("ops_degradation_level", 104821);
      this.featureIdCache.set("sarvam_rpm_budget", 104822);
    }

    this.state.ops_degradation_level = level as DegradationLevel;
    if (rpmBudget !== null) {
      this.state.sarvam_rpm_budget = rpmBudget;
    }
    metrics.setDegradationLevel(this.state.ops_degradation_level);

    this.auditLog.unshift({
      id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      actor,
      reason,
      level: this.state.ops_degradation_level,
      rpm_budget: this.state.sarvam_rpm_budget,
    });
    if (this.auditLog.length > 50) {
      this.auditLog.length = 50;
    }

    return {
      level: this.state.ops_degradation_level,
      rpm_budget: this.state.sarvam_rpm_budget,
      cached_feature_ids: this.featureIdCache.size,
    };
  }

  getAuditLog(): FlagAuditEntry[] {
    return [...this.auditLog];
  }

  getFeatureCacheSize(): number {
    return this.featureIdCache.size;
  }

  resetForTests(): void {
    this.state = structuredClone(CONTRACT_DEFAULTS);
    this.exposures.clear();
    this.conversions.clear();
    this.armExposures = { formal: 0, warm: 0 };
    this.armConversions = { formal: 0, warm: 0 };
    this.auditLog = [];
    this.featureIdCache.clear();
    metrics.setDegradationLevel(0);
  }
}

export const flags = new FlagsClient();
