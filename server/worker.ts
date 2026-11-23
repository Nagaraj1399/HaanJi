import {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
  TTS_SUPPORTED_LANGS,
} from "./config.ts";
import { flags } from "./flags.ts";
import { metrics } from "./metrics.ts";
import {
  runBrainLive,
  runBrainReplay,
  synthesizeSpeech,
  transcribeAudio,
} from "./brain.ts";
import { SarvamQuotaError, sharedLimiter } from "./limiter.ts";
import { store } from "./store.ts";
import { DegradationLevel, TurnJobResult } from "./types.ts";

export interface TurnEnqueueInput {
  gid: string;
  text?: string;
  audioBase64?: string;
  audioMime?: string;
  audioBytes?: number;
  audioDurationSeconds?: number;
  languageHint?: string;
  executionMode?: "live" | "replay";
}

export class AudioValidationError extends Error {
  status: number;
  constructor(message: string, status = 413) {
    super(message);
    this.name = "AudioValidationError";
    this.status = status;
  }
}

export class TurnWorker {
  private jobs = new Map<string, TurnJobResult>();
  private queuedIds: string[] = [];
  private drainRunning = false;

  enqueueTurn(input: TurnEnqueueInput): { job_id: string; level: DegradationLevel; status: "pending" | "queued" } {
    if (input.audioBytes !== undefined && input.audioBytes > MAX_AUDIO_BYTES) {
      throw new AudioValidationError(
        `Audio exceeds 2 MB limit (${input.audioBytes} bytes).`,
        413
      );
    }
    if (input.audioDurationSeconds !== undefined && input.audioDurationSeconds > MAX_AUDIO_SECONDS) {
      throw new AudioValidationError(
        `Audio exceeds 30 s limit (${input.audioDurationSeconds}s).`,
        413
      );
    }

    const level = flags.degradationLevel();
    const persona = flags.persona(input.gid);
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const job: TurnJobResult = {
      job_id: jobId,
      gid: input.gid,
      status: level === 2 ? "queued" : "pending",
      level,
      persona,
      transcript: input.text || "",
      detected_language: input.languageHint || "en-IN",
      answer_text: "",
      answer_language: input.languageHint || "en-IN",
      audio_base64: null,
      audio_mime: null,
      prerendered_clip:
        level === 1
          ? `/prerendered/${persona}_busy_${(input.languageHint || "en").slice(0, 2)}`
          : level === 2
            ? `/prerendered/${persona}_queued_${(input.languageHint || "en").slice(0, 2)}`
            : null,
      rsvp: store.getRsvp(input.gid),
      rsvp_warnings: [],
      grounding_violation: false,
      latency_ms: 0,
      stages: { stt_ms: 0, brain_ms: 0, tts_ms: 0 },
      created_at: new Date().toISOString(),
    };

    this.jobs.set(jobId, job);

    if (level === 2) {
      this.queuedIds.push(jobId);
      metrics.setQueueDepth(this.queuedIds.length);
      metrics.recordTurn(2, "queued");
      void this.scheduleDrain(input);
      return { job_id: jobId, level: 2, status: "queued" };
    }

    void this.processJob(jobId, input);
    return { job_id: jobId, level, status: "pending" };
  }

  private queuedInputs = new Map<string, TurnEnqueueInput>();

  private async scheduleDrain(input: TurnEnqueueInput): Promise<void> {
    const lastId = this.queuedIds[this.queuedIds.length - 1];
    if (lastId) this.queuedInputs.set(lastId, input);
    if (this.drainRunning) return;
    this.drainRunning = true;
    try {
      while (this.queuedIds.length > 0) {
        const nextId = this.queuedIds.shift()!;
        metrics.setQueueDepth(this.queuedIds.length);
        const inp = this.queuedInputs.get(nextId);
        this.queuedInputs.delete(nextId);
        if (inp) {
          // Wait for budget slot before draining queued job
          await new Promise((r) => setTimeout(r, 150));
          await this.processJob(nextId, inp);
        }
      }
    } finally {
      this.drainRunning = false;
    }
  }

  async processJob(jobId: string, input: TurnEnqueueInput): Promise<TurnJobResult> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} missing`);

    const tStart = Date.now();
    const level = flags.degradationLevel();
    const persona = flags.persona(input.gid);
    const mode = input.executionMode || "live";

    try {
      let transcript = (input.text || "").trim();
      let detectedLang = input.languageHint || "en-IN";

      // Stage 1: STT (if audio provided)
      if (!transcript && input.audioBase64) {
        const tStt = Date.now();
        if (mode === "replay") {
          await sharedLimiter.acquireSlot("stt");
          metrics.observeSarvam("stt", "200", 0.15);
          transcript = "Sangeet kitne baje hai?";
          detectedLang = "hi-IN";
        } else {
          const sttRes = await transcribeAudio(
            input.audioBase64,
            input.audioMime || "audio/webm"
          );
          transcript = sttRes.transcript;
          detectedLang = sttRes.language;
        }
        job.stages.stt_ms = Date.now() - tStt;
      }

      if (!transcript) {
        throw new Error("No speech or text was detected in your message.");
      }

      job.transcript = transcript;
      job.detected_language = detectedLang;

      // Stage 2: Brain + Grounding Check
      const tBrain = Date.now();
      const card = store.getCard();
      const currentRsvp = store.getRsvp(input.gid);

      const brainRes =
        mode === "replay"
          ? (() => {
              metrics.observeSarvam("chat", "200", 0.25);
              return runBrainReplay(transcript, detectedLang.slice(0, 2), card, persona);
            })()
          : await runBrainLive(transcript, detectedLang, card, currentRsvp, persona);

      job.stages.brain_ms = Date.now() - tBrain;
      job.answer_text = brainRes.answer_text;
      job.answer_language = brainRes.answer_language || detectedLang;
      job.grounding_violation = Boolean(brainRes.grounding_violation);

      // Apply RSVP patch deterministically
      if (brainRes.rsvp_patch && Object.keys(brainRes.rsvp_patch).length > 0) {
        const mergeRes = store.applyRsvpPatch(input.gid, brainRes.rsvp_patch);
        job.rsvp = mergeRes.rsvp;
        job.rsvp_warnings = mergeRes.warnings;
        if (mergeRes.becameCompleteFirstTime) {
          flags.trackRsvpCompleted(input.gid);
        }
      } else {
        job.rsvp = store.getRsvp(input.gid);
      }

      // Record unanswered question if applicable
      if (brainRes.unanswered_question) {
        store.addUnanswered(
          input.gid,
          brainRes.unanswered_question,
          job.answer_language,
          brainRes.grounding_violation ? "grounding_violation" : "unanswerable"
        );
      }

      // Stage 3: TTS (only at level == 0 AND voiceReplyEnabled AND supported language)
      const normalizedLang = normalizeBcp47(job.answer_language);
      if (
        level === 0 &&
        flags.voiceReplyEnabled(normalizedLang) &&
        TTS_SUPPORTED_LANGS.has(normalizedLang)
      ) {
        const tTts = Date.now();
        if (mode === "replay") {
          await sharedLimiter.acquireSlot("tts");
          metrics.observeSarvam("tts", "200", 0.2);
          job.audio_base64 = null;
        } else {
          try {
            const ttsRes = await synthesizeSpeech(job.answer_text, persona);
            job.audio_base64 = ttsRes.audioBase64;
            job.audio_mime = ttsRes.mimeType;
          } catch (ttsErr) {
            // If TTS hits quota or fails, gracefully return text answer without crashing turn
            job.error =
              ttsErr instanceof Error ? `Voice skipped: ${ttsErr.message}` : "Voice skipped";
          }
        }
        job.stages.tts_ms = Date.now() - tTts;
      } else if (level === 1) {
        job.prerendered_clip = `/prerendered/${persona}_busy_${normalizedLang.slice(0, 2)}`;
      }

      job.status = "done";
      job.latency_ms = Date.now() - tStart;
      job.finished_at = new Date().toISOString();
      metrics.recordTurn(level, "answered");
      return job;
    } catch (err: unknown) {
      job.latency_ms = Date.now() - tStart;
      job.finished_at = new Date().toISOString();
      if (err instanceof SarvamQuotaError) {
        job.status = "done";
        job.answer_text =
          "HaanJi is experiencing heavy wedding traffic right now. Please try again in a moment.";
        job.error = err.message;
        metrics.recordTurn(level, "busy");
      } else {
        job.status = "error";
        job.error = err instanceof Error ? err.message : String(err);
        metrics.recordTurn(level, "error");
      }
      return job;
    }
  }

  getJob(jobId: string): TurnJobResult | null {
    return this.jobs.get(jobId) ?? null;
  }
}

function normalizeBcp47(lang: string): string {
  const l = lang.trim().toLowerCase();
  if (l === "hi" || l === "hinglish" || l.startsWith("hi-")) return "hi-IN";
  if (l === "en" || l.startsWith("en-")) return "en-IN";
  if (l === "kn" || l.startsWith("kn-")) return "kn-IN";
  if (l === "ta" || l.startsWith("ta-")) return "ta-IN";
  if (l === "te" || l.startsWith("te-")) return "te-IN";
  if (l === "ml" || l.startsWith("ml-")) return "ml-IN";
  if (l === "bn" || l.startsWith("bn-")) return "bn-IN";
  if (l === "gu" || l.startsWith("gu-")) return "gu-IN";
  if (l === "mr" || l.startsWith("mr-")) return "mr-IN";
  if (l === "pa" || l.startsWith("pa-")) return "pa-IN";
  if (l === "od" || l.startsWith("od-")) return "od-IN";
  return lang;
}

export const worker = new TurnWorker();
