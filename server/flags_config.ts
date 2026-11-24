import type { DegradationLevel, PersonaArm } from "./types.ts";

export interface FlagDefinition {
  key: string;
  type: "integer" | "boolean" | "string" | "json";
  defaultValue: unknown;
  controls: string;
}

export const FLAG_DEFAULTS = {
  ops_degradation_level: 0 as DegradationLevel,
  ops_sarvam_rpm_budget: 40,
  exp_voice_persona: "formal" as PersonaArm,
  rel_voice_reply: {
    "hi-IN": true,
    "en-IN": true,
    "kn-IN": true,
    "ta-IN": true,
  } as Record<string, boolean>,
  rel_voice_rollout_pct: 100,
  rel_elder_mode_default: false,
  cfg_llm: {
    model: "gemini-3.1-flash-lite",
    prompt_version: "v2.1-grounded",
    temperature: 0.2,
    max_tokens: 450,
  },
};

export const FLAG_CATALOG_META: FlagDefinition[] = [
  {
    key: "ops_degradation_level",
    type: "integer",
    defaultValue: FLAG_DEFAULTS.ops_degradation_level,
    controls: "Guest experience cascade: 0 Live voice, 1 Text replies (0 TTS), 2 Queued async drain",
  },
  {
    key: "ops_sarvam_rpm_budget",
    type: "integer",
    defaultValue: FLAG_DEFAULTS.ops_sarvam_rpm_budget,
    controls: "Sliding-window upstream RPM budget (clamped between 5 and 55 RPM)",
  },
  {
    key: "exp_voice_persona",
    type: "string",
    defaultValue: FLAG_DEFAULTS.exp_voice_persona,
    controls: "50/50 multivariate A/B assignment per guest ID (formal vs warm)",
  },
  {
    key: "rel_voice_reply",
    type: "boolean",
    defaultValue: FLAG_DEFAULTS.rel_voice_reply,
    controls: "Per-language voice synthesis kill switch",
  },
  {
    key: "rel_voice_rollout_pct",
    type: "integer",
    defaultValue: FLAG_DEFAULTS.rel_voice_rollout_pct,
    controls: "Percentage rollout (0-100%) gating which guest IDs receive live voice replies",
  },
  {
    key: "rel_elder_mode_default",
    type: "boolean",
    defaultValue: FLAG_DEFAULTS.rel_elder_mode_default,
    controls: "Turns Elder Mode (large text, AAA contrast, 0.85x pace) on by default for elder households",
  },
  {
    key: "cfg_llm",
    type: "json",
    defaultValue: FLAG_DEFAULTS.cfg_llm,
    controls: "Model ID, grounded prompt version, temperature, and max response tokens",
  },
];
