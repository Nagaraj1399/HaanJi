import { capabilities } from "./capabilities.ts";
import { SARVAM_RPM_HARD_CAP } from "./config.ts";
import { FLAG_CATALOG_META, FLAG_DEFAULTS, type FlagDefinition } from "./flags_config.ts";
import { metrics } from "./metrics.ts";
import type { DegradationLevel, FlagAuditEntry, PersonaArm } from "./types.ts";

export interface FlagsState {
  ops_degradation_level: DegradationLevel;
  sarvam_rpm_budget: number;
  rel_voice_reply: Record<string, boolean>;
  rel_voice_rollout_pct: number;
  rel_elder_mode_default: boolean;
  cfg_llm: {
    model: string;
    prompt_version: string;
    temperature: number;
    max_tokens: number;
  };
  unreachable: boolean;
}

const CONTRACT_DEFAULTS: FlagsState = {
  ops_degradation_level: FLAG_DEFAULTS.ops_degradation_level,
  sarvam_rpm_budget: FLAG_DEFAULTS.ops_sarvam_rpm_budget,
  rel_voice_reply: { ...FLAG_DEFAULTS.rel_voice_reply },
  rel_voice_rollout_pct: FLAG_DEFAULTS.rel_voice_rollout_pct,
  rel_elder_mode_default: FLAG_DEFAULTS.rel_elder_mode_default,
  cfg_llm: { ...FLAG_DEFAULTS.cfg_llm },
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

export interface FlagCatalogRow extends FlagDefinition {
  currentValue: unknown;
  lastFetchedAt: string;
}

export class FlagsClient {
  private state: FlagsState = structuredClone(CONTRACT_DEFAULTS);
  private exposures = new Map<string, PersonaArm>();
  private conversions = new Set<string>();
  private abandoned = new Set<string>();
  private armExposures: Record<PersonaArm, number> = { formal: 0, warm: 0 };
  private armAnswers: Record<PersonaArm, number> = { formal: 0, warm: 0 };
  private armConversions: Record<PersonaArm, number> = { formal: 0, warm: 0 };
  private armAbandoned: Record<PersonaArm, number> = { formal: 0, warm: 0 };
  private auditLog: FlagAuditEntry[] = [];
  private featureIdCache = new Map<string, number>();
  private lastFetchedAt: string = new Date().toISOString();
  private recentRolloutGuests = new Map<string, { gid: string; included: boolean; bucket: number }>();
  private localDegradeOverride = false;

  setUnreachable(flag: boolean): void {
    this.state.unreachable = flag;
    capabilities.recordEvent(
      "flagsmith",
      flag
        ? "Flagsmith unreachable simulation ON -> reverted to safe defaults (Level 0)"
        : "Flagsmith connectivity restored"
    );
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
    this.lastFetchedAt = new Date().toISOString();
    capabilities.recordEvent(
      "flagsmith",
      `rel_voice_reply[${languageCode}] = ${enabled ? "ON" : "OFF"}`
    );
  }

  isGuestInVoiceRollout(gid: string): boolean {
    if (this.state.unreachable) return true;
    const pct = this.state.rel_voice_rollout_pct;
    const bucket = fnv1aHash(`rel_voice_rollout:${gid}`) % 100;
    const included = pct >= 100 ? true : pct <= 0 ? false : bucket < pct;
    if (!gid.startsWith("load-") && gid !== "drawer" && gid !== "scan") {
      this.recentRolloutGuests.set(gid, { gid, included, bucket });
      if (this.recentRolloutGuests.size > 12) {
        const firstKey = this.recentRolloutGuests.keys().next().value;
        if (firstKey) this.recentRolloutGuests.delete(firstKey);
      }
    }
    return included;
  }

  setVoiceRolloutPct(pct: number): number {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    this.state.rel_voice_rollout_pct = clamped;
    this.lastFetchedAt = new Date().toISOString();
    // Re-evaluate tracked sample guests against new percentage
    for (const [gid, entry] of this.recentRolloutGuests.entries()) {
      this.recentRolloutGuests.set(gid, {
        gid,
        bucket: entry.bucket,
        included: clamped >= 100 ? true : clamped <= 0 ? false : entry.bucket < clamped,
      });
    }
    capabilities.recordEvent("flagsmith", `rel_voice_rollout_pct = ${clamped}%`);
    return clamped;
  }

  getVoiceRolloutState(): {
    pct: number;
    guests: Array<{ gid: string; included: boolean; bucket: number }>;
  } {
    const pct = this.state.unreachable ? 100 : this.state.rel_voice_rollout_pct;
    return {
      pct,
      guests: Array.from(this.recentRolloutGuests.values()),
    };
  }

  elderModeDefault(traits?: { age_band?: string }): boolean {
    if (this.state.unreachable) return false;
    if (traits?.age_band === "elder") return true;
    return this.state.rel_elder_mode_default;
  }

  setElderModeDefault(enabled: boolean): void {
    this.state.rel_elder_mode_default = enabled;
    this.lastFetchedAt = new Date().toISOString();
    capabilities.recordEvent(
      "flagsmith",
      `rel_elder_mode_default = ${enabled ? "TRUE" : "FALSE"}`
    );
  }

  llmConfig(): FlagsState["cfg_llm"] {
    if (this.state.unreachable) return CONTRACT_DEFAULTS.cfg_llm;
    return this.state.cfg_llm;
  }

  persona(gid: string, _traits?: Record<string, string>): PersonaArm {
    if (this.state.unreachable) {
      return "formal";
    }
    if (gid.startsWith("load-")) {
      return "formal";
    }
    const existing = this.exposures.get(gid);
    if (existing) {
      return existing;
    }
    const bucket = fnv1aHash(`exp_voice_persona:${gid}`) % 2;
    const arm: PersonaArm = bucket === 0 ? "formal" : "warm";
    this.exposures.set(gid, arm);
    this.armExposures[arm] += 1;
    capabilities.recordEvent(
      "flagsmith",
      `degradation level = ${this.state.ops_degradation_level}, tone = ${arm}`
    );
    return arm;
  }

  trackAnswerServed(gid: string): void {
    if (this.state.unreachable || gid.startsWith("load-")) {
      return;
    }
    const arm = this.exposures.get(gid) ?? this.persona(gid);
    this.armAnswers[arm] += 1;
  }

  trackRsvpCompleted(gid: string): boolean {
    if (this.state.unreachable || gid.startsWith("load-")) {
      return false;
    }
    if (this.conversions.has(gid)) {
      return false;
    }
    const arm = this.exposures.get(gid) ?? this.persona(gid);
    this.conversions.add(gid);
    this.armConversions[arm] += 1;
    metrics.recordRsvpCompleted();
    return true;
  }

  trackRsvpAbandoned(gid: string): boolean {
    if (this.state.unreachable || gid.startsWith("load-")) {
      return false;
    }
    if (this.abandoned.has(gid) || this.conversions.has(gid)) {
      return false;
    }
    const arm = this.exposures.get(gid) ?? this.persona(gid);
    this.abandoned.add(gid);
    this.armAbandoned[arm] += 1;
    return true;
  }

  getExperimentSummary(): {
    arms: Record<
      PersonaArm,
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
  } {
    const calc = (arm: PersonaArm) => {
      const exp = this.armExposures[arm];
      const conv = this.armConversions[arm];
      return {
        exposures: exp,
        answers: this.armAnswers[arm],
        completions: conv,
        abandoned: this.armAbandoned[arm],
        conversion_rate_pct: exp > 0 ? Number(((conv / exp) * 100).toFixed(1)) : 0,
      };
    };
    const totalExp = this.armExposures.formal + this.armExposures.warm;
    const honestReading =
      totalExp < 100
        ? `Inconclusive at n=${totalExp}. Reaching 95% confidence for a 10% lift typically requires ~380 exposures per arm.`
        : `Sample size n=${totalExp} collected; inspect Flagsmith Bayesian credible interval before rolling out.`;
    return {
      arms: {
        formal: calc("formal"),
        warm: calc("warm"),
      },
      total_exposures: totalExp,
      honest_reading: honestReading,
      flagsmith_note:
        process.env.FLAGSMITH_ENV_KEY || process.env.FLAGSMITH_SERVER_KEY
          ? "Connected to Flagsmith environment."
          : "Local flag evaluation store active; Flagsmith Bayesian engine is the production source of truth when FLAGSMITH_ENV_KEY is configured.",
    };
  }

  async syncFromFlagsmith(): Promise<{
    synced: boolean;
    source: string;
    last_fetched_at: string;
    level: DegradationLevel;
    rpm_budget: number;
  }> {
    if (this.state.unreachable) {
      return {
        synced: false,
        source: "Fallback Defaults (Outage Active)",
        last_fetched_at: this.lastFetchedAt,
        level: 0,
        rpm_budget: CONTRACT_DEFAULTS.sarvam_rpm_budget,
      };
    }

    const envKey = (process.env.FLAGSMITH_ENV_KEY || process.env.FLAGSMITH_SERVER_KEY || "").trim();
    if (!envKey) {
      this.lastFetchedAt = new Date().toISOString();
      capabilities.recordEvent(
        "flagsmith",
        `Local store read: level=${this.state.ops_degradation_level}, rollout=${this.state.rel_voice_rollout_pct}%`
      );
      return {
        synced: false,
        source: "Local Flag Store",
        last_fetched_at: this.lastFetchedAt,
        level: this.degradationLevel(),
        rpm_budget: this.rpmBudget(),
      };
    }

    try {
      const res = await fetch("https://edge.api.flagsmith.com/api/v1/flags/", {
        method: "GET",
        headers: { "X-Environment-Key": envKey },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const items = (await res.json()) as Array<{
        feature?: { id?: number; name?: string };
        enabled?: boolean;
        feature_state_value?: unknown;
      }>;
      for (const item of items) {
        const name = item.feature?.name;
        if (!name) continue;
        if (typeof item.feature?.id === "number") {
          this.featureIdCache.set(name, item.feature.id);
        }
        if (name === "ops_degradation_level" && item.feature_state_value !== null && !this.localDegradeOverride) {
          const n = Number(item.feature_state_value);
          if (n === 0 || n === 1 || n === 2) {
            this.state.ops_degradation_level = n;
            metrics.setDegradationLevel(n);
          }
        } else if (name === "ops_sarvam_rpm_budget" && item.feature_state_value !== null && !this.localDegradeOverride) {
          const n = Number(item.feature_state_value);
          if (Number.isFinite(n) && n >= 5 && n <= 55) {
            this.state.sarvam_rpm_budget = n;
          }
        } else if (name === "rel_elder_mode_default" && typeof item.enabled === "boolean") {
          this.state.rel_elder_mode_default = item.enabled;
        } else if (name === "rel_voice_rollout_pct" && item.feature_state_value !== null) {
          const pct = Number(item.feature_state_value);
          if (Number.isFinite(pct) && pct >= 0 && pct <= 100) {
            this.state.rel_voice_rollout_pct = Math.round(pct);
          }
        }
      }
      this.lastFetchedAt = new Date().toISOString();
      capabilities.recordEvent(
        "flagsmith",
        `Synced ${items.length} flags from Flagsmith Cloud (level=${this.state.ops_degradation_level})`
      );
      return {
        synced: true,
        source: "Flagsmith Cloud",
        last_fetched_at: this.lastFetchedAt,
        level: this.degradationLevel(),
        rpm_budget: this.rpmBudget(),
      };
    } catch (err) {
      capabilities.recordEvent(
        "flagsmith",
        `Flagsmith sync fell back to cached flags (${err instanceof Error ? err.message : "error"})`
      );
      return {
        synced: false,
        source: "Cached Flag Store (Remote Fetch Failed)",
        last_fetched_at: this.lastFetchedAt,
        level: this.degradationLevel(),
        rpm_budget: this.rpmBudget(),
      };
    }
  }

  getAllFlagValues() {
    return {
      exp_voice_persona: "50/50 multivariate (formal | warm)",
      ops_degradation_level: this.degradationLevel(),
      ops_sarvam_rpm_budget: this.rpmBudget(),
      rel_voice_reply: this.state.rel_voice_reply,
      rel_voice_rollout_pct: this.state.unreachable ? 100 : this.state.rel_voice_rollout_pct,
      cfg_llm: this.llmConfig(),
      rel_elder_mode_default: this.elderModeDefault(),
      last_fetched_at: this.lastFetchedAt,
      source: this.state.unreachable
        ? "Fallback Defaults (Outage Active)"
        : process.env.FLAGSMITH_ENV_KEY || process.env.FLAGSMITH_SERVER_KEY
          ? "Flagsmith Cloud"
          : "Local Flag Store",
    };
  }

  getFlagsCatalog(): FlagCatalogRow[] {
    const currentByKey: Record<string, unknown> = {
      ops_degradation_level: this.degradationLevel(),
      ops_sarvam_rpm_budget: this.rpmBudget(),
      exp_voice_persona: `50/50 split (n=${this.armExposures.formal + this.armExposures.warm})`,
      rel_voice_reply: Object.entries(this.state.rel_voice_reply)
        .filter(([, v]) => v)
        .map(([k]) => k.slice(0, 2))
        .join(",") || "none",
      rel_voice_rollout_pct: `${this.state.unreachable ? 100 : this.state.rel_voice_rollout_pct}%`,
      rel_elder_mode_default: this.elderModeDefault(),
      cfg_llm: `${this.llmConfig().model} (${this.llmConfig().prompt_version})`,
    };
    return FLAG_CATALOG_META.map((def) => ({
      ...def,
      currentValue: currentByKey[def.key] ?? def.defaultValue,
      lastFetchedAt: this.lastFetchedAt,
    }));
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
    if (!this.featureIdCache.has("ops_degradation_level")) {
      this.featureIdCache.set("ops_degradation_level", 104821);
      this.featureIdCache.set("ops_sarvam_rpm_budget", 104822);
    }

    this.state.ops_degradation_level = level as DegradationLevel;
    if (rpmBudget !== null) {
      this.state.sarvam_rpm_budget = rpmBudget;
    }
    this.localDegradeOverride =
      actor !== "muhurat_demo_reset" && actor !== "ops_reset";
    this.lastFetchedAt = new Date().toISOString();
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

    capabilities.recordEvent(
      "flagsmith",
      `ops_degradation_level = ${this.state.ops_degradation_level}, rpm_budget = ${this.state.sarvam_rpm_budget} (${actor})`
    );

    if (actor !== "muhurat_demo_reset" && actor !== "ops_reset") {
      void this.pushDegradationToFlagsmithAdmin(
        this.state.ops_degradation_level,
        this.state.sarvam_rpm_budget
      );
    }

    return {
      level: this.state.ops_degradation_level,
      rpm_budget: this.state.sarvam_rpm_budget,
      cached_feature_ids: this.featureIdCache.size,
    };
  }

  private async pushDegradationToFlagsmithAdmin(
    level: DegradationLevel,
    rpmBudget: number
  ): Promise<void> {
    const adminKey = process.env.FLAGSMITH_ADMIN_KEY?.trim();
    const envId = process.env.FLAGSMITH_ENV_ID?.trim();
    if (!adminKey || !envId) return;

    try {
      const listRes = await fetch(
        `https://api.flagsmith.com/api/v1/environments/${encodeURIComponent(envId)}/featurestates/`,
        {
          headers: { Authorization: `Api-Key ${adminKey}` },
          signal: AbortSignal.timeout(4000),
        }
      );
      if (!listRes.ok) return;
      const listJson = (await listRes.json()) as {
        results?: Array<{ id: number; feature?: number; feature_state_value?: unknown }>;
      };
      const results = listJson.results || [];
      const degId = this.featureIdCache.get("ops_degradation_level");
      const rpmId = this.featureIdCache.get("ops_sarvam_rpm_budget");

      for (const fsRow of results) {
        let nextVal: string | null = null;
        if (degId && fsRow.feature === degId) nextVal = String(level);
        if (rpmId && fsRow.feature === rpmId) nextVal = String(rpmBudget);
        if (nextVal !== null) {
          await fetch(
            `https://api.flagsmith.com/api/v1/environments/${encodeURIComponent(envId)}/featurestates/${fsRow.id}/`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Api-Key ${adminKey}`,
              },
              body: JSON.stringify({
                enabled: true,
                feature_state_value: nextVal,
              }),
              signal: AbortSignal.timeout(4000),
            }
          );
        }
      }
      this.localDegradeOverride = false;
      capabilities.recordEvent(
        "flagsmith",
        `Pushed Level ${level} (${rpmBudget} RPM) to Flagsmith Cloud`
      );
    } catch {
      // Keep local override safely if remote Admin API call fails
    }
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
    this.abandoned.clear();
    this.armExposures = { formal: 0, warm: 0 };
    this.armAnswers = { formal: 0, warm: 0 };
    this.armConversions = { formal: 0, warm: 0 };
    this.armAbandoned = { formal: 0, warm: 0 };
    this.auditLog = [];
    this.featureIdCache.clear();
    this.recentRolloutGuests.clear();
    this.localDegradeOverride = false;
    this.lastFetchedAt = new Date().toISOString();
    metrics.setDegradationLevel(0);
  }
}

export const flags = new FlagsClient();
