import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronUp,
  MapPin,
  Mic,
  MicOff,
  Send,
  Square,
  Volume2,
} from "lucide-react";
import { downloadFunctionIcs } from "../utils/calendar";
import {
  CapabilitiesSummary,
  GuestRsvp,
  HouseholdInfo,
  WeddingCardData,
} from "../types/haanji";

interface TurnResult {
  job_id: string;
  status: "pending" | "queued" | "done" | "error";
  level: 0 | 1 | 2;
  transcript: string;
  detected_language: string;
  answer_text: string;
  answer_language: string;
  language_label?: string;
  voice_paused?: boolean;
  behind_answer?: {
    provider: string;
    stt: string;
    chat: string;
    tts: string;
    language: string;
    tone: string;
    level: number;
    offline_fallback: boolean;
  };
  audio_base64: string | null;
  audio_mime: string | null;
  prerendered_clip: string | null;
  rsvp: GuestRsvp | null;
  rsvp_needs_confirmation: boolean;
  rsvp_warnings: string[];
  matched_function: {
    id: string;
    name: string;
    date: string;
    time: string;
    venue: string;
    maps_url?: string;
  } | null;
  grounding_violation: boolean;
  latency_ms: number;
  error?: string;
}

const GUEST_QUICK_QUESTIONS = [
  { label: "Sangeet time & venue", text: "Sangeet kitne baje start hoga aur kahan hai?" },
  { label: "4 guests, 2 Jain, Shaadi", text: "Hum 4 log aayenge, 2 Jain, sirf shaadi." },
  { label: "ಕನ್ನಡದಲ್ಲಿ ಮುಹೂರ್ತ", text: "ಮುಹೂರ್ತ ಮತ್ತು ಮದುವೆ ಎಷ್ಟು ಗಂಟೆಗೆ ಮತ್ತು ಎಲ್ಲಿ ನಡೆಯುತ್ತದೆ?" },
  { label: "தமிழில் முகூர்த்தம்", text: "முகூர்த்தம் எத்தனை மணிக்கு எங்கே நடைபெறும்?" },
  { label: "Valet parking details", text: "Where is parking available?" },
];

const THINKING_STAGES_BY_LANG: Record<string, [string, string, string]> = {
  hinglish: ["Sun raha hoon...", "Samajh raha hoon...", "Bol raha hoon..."],
  hi: ["सुन रहा हूँ...", "समझ रहा हूँ...", "बोल रहा हूँ..."],
  kn: ["ಕೇಳಿಸಿಕೊಳ್ಳುತ್ತಿದ್ದೇನೆ...", "ಅರ್ಥಮಾಡಿಕೊಳ್ಳುತ್ತಿದ್ದೇನೆ...", "ಹೇಳುತ್ತಿದ್ದೇನೆ..."],
  ta: ["கேட்கிறேன்...", "புரிந்துகொள்கிறேன்...", "பதில் சொல்கிறேன்..."],
  en: ["Listening...", "Checking the card...", "Preparing reply..."],
};

const MIC_FALLBACK_BY_LANG: Record<string, string> = {
  hinglish:
    "Microphone permission nahi mili. Koi baat nahi, aap niche Hinglish, Hindi, Kannada, Tamil ya English mein type kar sakte hain.",
  hi: "माइक्रोफ़ोन उपलब्ध नहीं है। कोई बात नहीं, आप नीचे अपना सवाल टाइप कर सकते हैं।",
  kn: "ಮೈಕ್ರೊಫೋನ್ ಲಭ್ಯವಿಲ್ಲ. ದಯವಿಟ್ಟು ಕೆಳಗೆ ನಿಮ್ಮ ಪ್ರಶ್ನೆಯನ್ನು ಟೈಪ್ ಮಾಡಿ.",
  ta: "மைக்ரோஃபோன் கிடைக்கவில்லை. கீழே உங்கள் கேள்வியை தட்டச்சு செய்யலாம்.",
  en: "Microphone permission was declined. Please type your question below.",
};

function langDisplayName(lang?: string): string {
  const l = (lang || "").toLowerCase();
  if (l === "hinglish") return "Hinglish";
  if (l.startsWith("kn")) return "ಕನ್ನಡ";
  if (l.startsWith("ta")) return "தமிழ்";
  if (l.startsWith("hi")) return "हिन्दी";
  return "English";
}

function speechBcpCode(lang?: string): string {
  const l = (lang || "").toLowerCase();
  if (l.startsWith("kn")) return "kn-IN";
  if (l.startsWith("ta")) return "ta-IN";
  if (l.startsWith("hi") || l === "hinglish") return "hi-IN";
  return "en-IN";
}

function playStatusTone(level: 1 | 2) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = level === 1 ? 520 : 420;
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    // Ignore browser audio context restrictions
  }
}

export type GuestDemoEvent =
  | "hinglish"
  | "kannada"
  | "tamil"
  | "rsvp_confirmed"
  | "elder_mode";

export function GuestConcierge({
  gid,
  householdCode,
  household,
  card,
  level,
  voicePausedFlag,
  caps,
  rsvp,
  languageHint,
  elderMode,
  onLanguageHintChange,
  onToggleElderMode,
  onRsvpChange,
  onRotateGid,
  onRefreshState,
  onOpenRsvpEdit,
  onDemoSignal,
  demoCommand,
  externalQuestion,
  focusNonce,
}: {
  gid: string;
  householdCode?: string | null;
  household: HouseholdInfo | null;
  card: WeddingCardData | null;
  level: 0 | 1 | 2;
  voicePausedFlag: boolean;
  caps: CapabilitiesSummary | null;
  rsvp: GuestRsvp | null;
  languageHint: string;
  elderMode: boolean;
  onLanguageHintChange: (lang: string) => void;
  onToggleElderMode: () => void;
  onRsvpChange: (next: GuestRsvp) => void;
  onRotateGid: () => void;
  onRefreshState: () => void;
  onOpenRsvpEdit: () => void;
  onDemoSignal?: (event: GuestDemoEvent) => void;
  demoCommand?: {
    action: "ask" | "elder" | "focus_mic";
    text?: string;
    lang?: string;
    nonce: number;
  } | null;
  externalQuestion?: { text: string; autoSubmit?: boolean; nonce: number } | null;
  focusNonce?: number;
}) {
  const [textInput, setTextInput] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [countdown, setCountdown] = useState(25);
  const [micDeniedMsg, setMicDeniedMsg] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [thinkingStep, setThinkingStep] = useState(0);
  const [lastResult, setLastResult] = useState<TurnResult | null>(null);
  const [traceExpanded, setTraceExpanded] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [confirmSaving, setConfirmSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const recordStartRef = useRef<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const micSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!submitting) {
      setThinkingStep(0);
      return;
    }
    const id = window.setInterval(() => {
      setThinkingStep((s) => (s + 1) % 3);
    }, 850);
    return () => window.clearInterval(id);
  }, [submitting]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = elderMode ? 0.85 : 1.0;
    }
  }, [elderMode]);

  useEffect(() => {
    if (!focusNonce) return;
    window.setTimeout(() => {
      textInputRef.current?.focus();
    }, 280);
  }, [focusNonce]);

  useEffect(() => {
    if (!externalQuestion?.text) return;
    setTextInput(externalQuestion.text);
    textInputRef.current?.focus();
    if (externalQuestion.autoSubmit) {
      void submitTurn({ text: externalQuestion.text });
    }
  }, [externalQuestion?.nonce]);

  useEffect(() => {
    if (!demoCommand) return;
    if (demoCommand.action === "elder") {
      if (!elderMode) {
        onToggleElderMode();
      }
      onDemoSignal?.("elder_mode");
      if (lastResult && !voicePausedFlag) {
        speakResult(lastResult, true);
      }
    } else if (demoCommand.action === "ask" && demoCommand.text) {
      const nextLang = demoCommand.lang || "auto";
      onLanguageHintChange(nextLang);
      setTextInput(demoCommand.text);
      void submitTurn({ text: demoCommand.text }, nextLang);
    } else if (demoCommand.action === "focus_mic") {
      if (demoCommand.lang) onLanguageHintChange(demoCommand.lang);
      micSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (demoCommand.text) {
        setTextInput(demoCommand.text);
        void submitTurn({ text: demoCommand.text }, demoCommand.lang);
      }
    }
  }, [demoCommand?.nonce]);

  const stopPlayback = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  };

  const speakResult = (job: TurnResult, forceElderPace?: boolean) => {
    stopPlayback();
    const slow = forceElderPace ?? elderMode;
    if (job.audio_base64 && audioRef.current) {
      audioRef.current.src = `data:${job.audio_mime || "audio/wav"};base64,${job.audio_base64}`;
      audioRef.current.playbackRate = slow ? 0.85 : 1.0;
      setIsSpeaking(true);
      audioRef.current.play().catch(() => {
        setIsSpeaking(false);
      });
      return;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window && job.answer_text) {
      const utter = new SpeechSynthesisUtterance(job.answer_text);
      utter.lang = speechBcpCode(job.answer_language);
      utter.rate = slow ? 0.85 : 1.0;
      utter.onstart = () => setIsSpeaking(true);
      utter.onend = () => setIsSpeaking(false);
      utter.onerror = () => setIsSpeaking(false);
      setIsSpeaking(true);
      window.speechSynthesis.speak(utter);
    }
  };

  const pollJobUntilDone = async (jobId: string) => {
    const start = Date.now();
    while (Date.now() - start < 45_000) {
      const res = await fetch(`/api/turn/${encodeURIComponent(jobId)}`);
      if (!res.ok) throw new Error("Unable to reach the concierge right now.");
      const job: TurnResult = await res.json();
      if (job.status === "done" || job.status === "error") {
        setLastResult(job);
        setTraceExpanded(false);
        onRefreshState();
        if (job.rsvp) {
          onRsvpChange(job.rsvp);
        }
        setPendingConfirm(Boolean(job.rsvp_needs_confirmation && !job.rsvp?.confirmed));
        if (job.status === "error") {
          setErrorMsg("Koi baat nahi, thodi der mein dobara poochiye.");
        } else {
          const al = (job.answer_language || "").toLowerCase();
          if (al === "hinglish") onDemoSignal?.("hinglish");
          if (al.startsWith("kn")) onDemoSignal?.("kannada");
          if (al.startsWith("ta")) onDemoSignal?.("tamil");

          const paused = Boolean(job.voice_paused) || job.level > 0;
          if (!paused && (job.audio_base64 || elderMode)) {
            speakResult(job);
          } else if (job.prerendered_clip) {
            playStatusTone(job.level === 2 ? 2 : 1);
          }
        }
        return;
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    throw new Error("Awaaz aane mein thoda waqt lag raha hai, kripya dobara poochiye.");
  };

  const submitTurn = async (
    payload: {
      text?: string;
      audioBase64?: string;
      audioMime?: string;
      audioBytes?: number;
      audioDurationSeconds?: number;
    },
    overrideLangHint?: string
  ) => {
    setSubmitting(true);
    setErrorMsg(null);
    stopPlayback();
    try {
      const effectiveHint = overrideLangHint ?? languageHint;
      const res = await fetch("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gid,
          householdCode: household?.code || householdCode || undefined,
          ...payload,
          languageHint: effectiveHint === "auto" ? undefined : effectiveHint,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Koi baat nahi, dobara boliye.");
      }
      if (data.status === "queued") {
        playStatusTone(2);
      }
      await pollJobUntilDone(data.job_id);
    } catch (err) {
      setErrorMsg(
        err instanceof Error && err.message.includes("2 MB")
          ? "Recording 25 seconds se chhoti rakhiye."
          : "Koi baat nahi, kripya dobara poochiye ya niche likhiye."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const startRecording = async () => {
    if (isRecording || submitting || voiceOffline || voicePaused) return;
    setMicDeniedMsg(null);
    setErrorMsg(null);
    stopPlayback();
    try {
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(15);
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chosenMime =
        typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : undefined;
      const recorder = chosenMime
        ? new MediaRecorder(stream, { mimeType: chosenMime })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      recordStartRef.current = Date.now();

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recordTimerRef.current) {
          window.clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;
        }
        setIsRecording(false);
        const durationSec = Math.round((Date.now() - recordStartRef.current) / 1000);
        const actualMime = recorder.mimeType || chosenMime || "audio/ogg";
        const blob = new Blob(chunksRef.current, { type: actualMime });
        if (blob.size < 200) return;
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = String(reader.result || "");
          const base64 = dataUrl.split(",")[1] || "";
          void submitTurn({
            audioBase64: base64,
            audioMime: actualMime,
            audioBytes: blob.size,
            audioDurationSeconds: Math.max(1, durationSec),
          });
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setCountdown(25);

      recordTimerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordStartRef.current) / 1000);
        const rem = Math.max(0, 25 - elapsed);
        setCountdown(rem);
        if (rem <= 0 && mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      }, 250);
    } catch {
      const k = languageHint === "auto" ? "hinglish" : languageHint.split("-")[0];
      setMicDeniedMsg(MIC_FALLBACK_BY_LANG[k] || MIC_FALLBACK_BY_LANG.hinglish);
      textInputRef.current?.focus();
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  };

  const handleConfirmRsvp = async () => {
    if (confirmSaving) return;
    setConfirmSaving(true);
    try {
      const res = await fetch(`/api/rsvp/${encodeURIComponent(gid)}/confirm`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        onRsvpChange(data.rsvp);
        setPendingConfirm(false);
        onDemoSignal?.("rsvp_confirmed");
      }
    } finally {
      setConfirmSaving(false);
    }
  };

  const voiceOffline = caps !== null && !caps.live_ai;
  const voicePaused = !voiceOffline && (level > 0 || voicePausedFlag);

  const statusChipLabel =
    level === 0
      ? voiceOffline
        ? "Voice off"
        : voicePaused
          ? "Voice paused"
          : "Live voice"
      : level === 1
        ? "Text replies (very busy)"
        : "Queued, answer shortly";

  const statusToneClass =
    level === 0 && !voiceOffline && !voicePaused
      ? "text-[#8FB39A] border-[#8FB39A]/35 bg-[#8FB39A]/10"
      : level === 2
        ? "text-[#C98A8A] border-[#C98A8A]/35 bg-[#C98A8A]/10"
        : "text-[#E6CFA3] border-[#B8925A]/35 bg-[#B8925A]/10";

  const langKey =
    languageHint === "auto" ? "hinglish" : languageHint.split("-")[0];
  const activeThinkingText = (THINKING_STAGES_BY_LANG[langKey] || THINKING_STAGES_BY_LANG.hinglish)[
    thinkingStep
  ];

  const ringRadius = 56;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference * (1 - countdown / 25);

  const canSpeakLastResult =
    Boolean(lastResult?.answer_text) &&
    (Boolean(lastResult?.audio_base64) ||
      (!voicePaused &&
        typeof window !== "undefined" &&
        "speechSynthesis" in window));

  const btnHeightClass = elderMode ? "min-h-[56px]" : "min-h-[44px]";

  return (
    <div className="glass-card p-6 sm:p-10 space-y-8">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b hairline-gold">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">
            {household ? `Welcome, ${household.family_name}` : "Multilingual Concierge"}
          </p>
          <h2
            className={`mt-2 font-display font-light text-[#F5EDE1] ${
              elderMode ? "text-3xl sm:text-4xl" : "text-2xl sm:text-4xl"
            }`}
          >
            Poochiye, HaanJi sun raha hai
          </h2>
          <p className={`mt-1.5 text-[#F5EDE1]/70 indic-relaxed ${elderMode ? "text-lg" : "text-sm"}`}>
            Speak or type in Hindi, Hinglish, English, ಕನ್ನಡ or தமிழ்.
            {card?.wedding?.title ? ` Answers follow the ${card.wedding.title} card.` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-[11px] uppercase tracking-[0.2em] ${statusToneClass}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                level === 0 && !voiceOffline && !voicePaused
                  ? "bg-[#8FB39A]"
                  : level === 2
                    ? "bg-[#C98A8A]"
                    : "bg-[#E6CFA3]"
              }`}
            />
            <span>{statusChipLabel}</span>
          </span>

          <select
            aria-label="Preferred concierge language"
            value={languageHint}
            onChange={(e) => onLanguageHintChange(e.target.value)}
            className={`${btnHeightClass} rounded-full border border-[#B8925A]/45 bg-[#14050A]/80 px-4 text-xs uppercase tracking-[0.14em] text-[#E6CFA3]`}
          >
            <option value="auto">Auto Language</option>
            <option value="hinglish">Hinglish</option>
            <option value="hi-IN">हिन्दी</option>
            <option value="kn-IN">ಕನ್ನಡ</option>
            <option value="ta-IN">தமிழ்</option>
            <option value="en-IN">English</option>
          </select>
        </div>
      </div>

      {/* Hold-to-ask Round Voice Button */}
      <div
        ref={micSectionRef}
        className="flex flex-col items-center justify-center py-6 text-center rounded-2xl border border-[#B8925A]/20 bg-[#14050A]/45 px-4"
      >
        {voiceOffline || voicePaused ? (
          <div className="py-3 space-y-2">
            <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full border border-[#B8925A]/30 text-xs uppercase tracking-[0.16em] text-[#E6CFA3]">
              <MicOff className="w-4 h-4 text-[#B8925A] shrink-0" strokeWidth={1.5} />
              <span>
                {voiceOffline
                  ? "Voice is off on this demo. Please type your question below."
                  : "Voice is paused right now, please type"}
              </span>
            </div>
          </div>
        ) : (
          <>
            <div className="relative inline-flex items-center justify-center">
              {isRecording && (
                <>
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -inset-3 rounded-full border border-[#B8925A]/70 animate-mic-ring"
                  />
                  <svg
                    className="pointer-events-none absolute -inset-2.5 w-[144px] h-[144px] -rotate-90"
                    viewBox="0 0 128 128"
                    aria-hidden="true"
                  >
                    <circle
                      cx="64"
                      cy="64"
                      r={ringRadius}
                      fill="none"
                      stroke="#B8925A"
                      strokeWidth="1.5"
                      opacity="0.25"
                    />
                    <circle
                      cx="64"
                      cy="64"
                      r={ringRadius}
                      fill="none"
                      stroke="#E6CFA3"
                      strokeWidth="2"
                      strokeDasharray={ringCircumference}
                      strokeDashoffset={ringOffset}
                      strokeLinecap="round"
                    />
                  </svg>
                </>
              )}

              <button
                type="button"
                aria-label={isRecording ? "Release to send voice question" : "Hold to ask by voice"}
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onMouseLeave={() => {
                  if (isRecording) stopRecording();
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  void startRecording();
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  stopRecording();
                }}
                disabled={submitting}
                className={`h-[124px] w-[124px] rounded-full border-2 flex flex-col items-center justify-center gap-1.5 transition-colors active:scale-[0.98] disabled:opacity-55 ${
                  isRecording
                    ? "border-[#E6CFA3] bg-[#2B0A12] text-[#F5EDE1]"
                    : "border-[#F5EDE1] bg-[#14050A] text-[#F5EDE1] hover:border-[#E6CFA3]"
                }`}
              >
                {isRecording ? (
                  <>
                    <MicOff className="w-6 h-6 text-[#E6CFA3]" strokeWidth={1.5} />
                    <span className="font-mono text-xs tabular-nums text-[#E6CFA3]">{countdown}s</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-6 h-6 text-[#E6CFA3]" strokeWidth={1.5} />
                    <span className="text-[11px] uppercase tracking-[0.16em] text-[#F5EDE1]">
                      {submitting ? "Wait" : "Hold to ask"}
                    </span>
                  </>
                )}
              </button>
            </div>

            <p className={`mt-4 text-[#F5EDE1]/70 ${elderMode ? "text-base" : "text-xs"}`}>
              {isRecording
                ? "Listening carefully, release to send."
                : submitting
                  ? activeThinkingText
                  : "Press and hold up to 25 seconds, or tap a sample question below."}
            </p>
          </>
        )}

        {micDeniedMsg && (
          <p className="mt-3 text-xs text-[#E6CFA3] border border-[#B8925A]/35 rounded-xl px-4 py-2.5 bg-[#14050A]/80">
            {micDeniedMsg}
          </p>
        )}
      </div>

      {/* Sample Question Chips */}
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]/85 mb-3">
          Sample questions
        </p>
        <div className="flex flex-wrap gap-2.5">
          {GUEST_QUICK_QUESTIONS.map((sp) => (
            <button
              key={sp.label}
              type="button"
              disabled={submitting}
              onClick={() => {
                setTextInput(sp.text);
                void submitTurn({ text: sp.text });
              }}
              className={`${btnHeightClass} px-4 py-2 rounded-full border border-[#B8925A]/45 bg-transparent text-xs text-[#F5EDE1] hover:bg-[#B8925A]/15 transition-colors indic-relaxed`}
            >
              {sp.label}
            </button>
          ))}
        </div>
      </div>

      {/* Answer Card */}
      <div aria-live="polite" className="space-y-4">
        {errorMsg && (
          <div className="flex items-start gap-2.5 rounded-2xl border border-[#C98A8A]/45 bg-[#14050A]/75 px-4 py-3.5 text-sm text-[#C98A8A]">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <p>{errorMsg}</p>
          </div>
        )}

        {lastResult && !errorMsg && (
          <div className="rounded-2xl border border-[#B8925A]/30 bg-[#14050A]/70 p-6 sm:p-7 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {lastResult.transcript ? (
                <p className="text-xs text-[#F5EDE1]/70">
                  Heard: &ldquo;{lastResult.transcript}&rdquo;
                </p>
              ) : (
                <span />
              )}
              <span className="px-3 py-1 rounded-full border border-[#B8925A]/45 text-[11px] uppercase tracking-[0.18em] text-[#E6CFA3]">
                {lastResult.language_label || langDisplayName(lastResult.answer_language)}
              </span>
            </div>

            <p
              className={`font-display font-light text-[#F5EDE1] indic-relaxed ${
                elderMode ? "text-2xl sm:text-3xl" : "text-xl sm:text-2xl"
              }`}
            >
              {lastResult.answer_text}
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              {canSpeakLastResult && (
                <button
                  type="button"
                  onClick={() => {
                    if (isSpeaking) {
                      stopPlayback();
                    } else {
                      speakResult(lastResult);
                    }
                  }}
                  className={`${btnHeightClass} px-4 rounded-full border border-[#B8925A]/55 text-xs uppercase tracking-[0.15em] text-[#E6CFA3] hover:bg-[#B8925A]/15 inline-flex items-center gap-2`}
                >
                  {isSpeaking ? (
                    <>
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span>Stop</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-4 h-4" strokeWidth={1.5} />
                      <span>Play{elderMode ? " (0.85x)" : ""}</span>
                    </>
                  )}
                </button>
              )}

              {lastResult.matched_function?.maps_url && (
                <a
                  href={lastResult.matched_function.maps_url}
                  target="_blank"
                  rel="noreferrer"
                  className={`${btnHeightClass} px-4 rounded-full border border-[#B8925A]/40 text-xs text-[#F5EDE1] hover:bg-[#B8925A]/15 inline-flex items-center gap-1.5`}
                >
                  <MapPin className="w-3.5 h-3.5 text-[#E6CFA3]" strokeWidth={1.5} />
                  <span>Directions: {lastResult.matched_function.name}</span>
                </a>
              )}

              {lastResult.matched_function && (
                <button
                  type="button"
                  onClick={() => downloadFunctionIcs(lastResult.matched_function!)}
                  className={`${btnHeightClass} px-4 rounded-full border border-[#B8925A]/40 text-xs text-[#F5EDE1] hover:bg-[#B8925A]/15 inline-flex items-center gap-1.5`}
                >
                  <CalendarPlus className="w-3.5 h-3.5 text-[#8FB39A]" strokeWidth={1.5} />
                  <span>Add to calendar</span>
                </button>
              )}

              {lastResult.grounding_violation && (
                <span className="px-3 py-1 rounded-full border border-[#B8925A]/35 text-[11px] uppercase tracking-[0.16em] text-[#E6CFA3]">
                  Sent to the family
                </span>
              )}
            </div>

            {lastResult.behind_answer && (
              <div className="pt-2 border-t hairline-gold">
                <button
                  type="button"
                  onClick={() => setTraceExpanded((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-[#F5EDE1]/70 hover:text-[#E6CFA3]"
                >
                  <span>Behind this answer</span>
                  {traceExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
                {traceExpanded && (
                  <p className="mt-2 rounded-xl bg-[#14050A]/80 border border-[#B8925A]/20 px-3.5 py-2.5 text-xs text-[#F5EDE1]/75 font-mono">
                    {lastResult.behind_answer.stt} &rarr; {lastResult.behind_answer.chat} &rarr;{" "}
                    {lastResult.behind_answer.tts} · Tone: {lastResult.behind_answer.tone} · Level{" "}
                    {lastResult.behind_answer.level}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* 2-step Confirmation Card when voice/text proposes an RSVP update */}
        {pendingConfirm && rsvp && (
          <div className="rounded-2xl border border-[#B8925A]/55 bg-[#2B0A12]/70 p-5 sm:p-6 space-y-4">
            <div>
              <p className={`font-medium text-[#F5EDE1] ${elderMode ? "text-lg" : "text-sm"}`}>
                {rsvp.headcount
                  ? `${rsvp.headcount} guests, ${rsvp.functions.join(", ") || "functions pending"}${
                      rsvp.diet.jain > 0 ? `, ${rsvp.diet.jain} Jain` : ""
                    }${rsvp.diet.veg > 0 ? `, ${rsvp.diet.veg} Veg` : ""}. Confirm this RSVP?`
                  : rsvp.headcount_range
                    ? `${rsvp.headcount_range[0]}-${rsvp.headcount_range[1]} tentative guests, ${
                        rsvp.functions.join(", ") || "Shaadi"
                      }. Set exact count to confirm?`
                    : "Please confirm your RSVP details."}
              </p>
              <p className="mt-1 text-xs text-[#E6CFA3]/85">
                Your RSVP reaches the caterer only after you confirm.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {rsvp.headcount && (
                <button
                  type="button"
                  disabled={confirmSaving}
                  onClick={handleConfirmRsvp}
                  className={`${btnHeightClass} px-5 rounded-full bg-[#F5EDE1] text-[#14050A] text-xs font-semibold hover:bg-[#E6CFA3] inline-flex items-center gap-1.5`}
                >
                  <Check className="w-4 h-4" />
                  <span>Yes, confirm RSVP</span>
                </button>
              )}
              <button
                type="button"
                onClick={onOpenRsvpEdit}
                className={`${btnHeightClass} px-5 rounded-full border border-[#B8925A] text-[#F5EDE1] text-xs hover:bg-[#B8925A]/15`}
              >
                Edit details
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Text Input Bar (sticky/reachable at bottom of concierge card on mobile) */}
      <div className="sticky bottom-3 z-10 md:static bg-[#14050A]/90 md:bg-transparent backdrop-blur-md md:backdrop-blur-none rounded-2xl p-2 md:p-0 border border-[#B8925A]/25 md:border-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!textInput.trim() || submitting) return;
            void submitTurn({ text: textInput.trim() });
          }}
          className="flex flex-col sm:flex-row gap-2.5"
        >
          <input
            ref={textInputRef}
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Ask about timings, venue, menu, or RSVP..."
            aria-label="Ask HaanJi a question"
            className={`flex-1 ${elderMode ? "min-h-[56px] text-lg" : "min-h-[48px] text-sm"} rounded-xl border border-[#B8925A]/35 bg-[#14050A]/80 px-4 text-[#F5EDE1] placeholder:text-[#F5EDE1]/45`}
          />
          <button
            type="submit"
            disabled={submitting || !textInput.trim()}
            className={`${btnHeightClass} px-6 rounded-xl bg-[#F5EDE1] text-[#14050A] text-xs font-semibold uppercase tracking-[0.14em] hover:bg-[#E6CFA3] disabled:opacity-45 inline-flex items-center justify-center gap-2 shrink-0`}
          >
            <Send className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span>{submitting ? "Sending" : "Send"}</span>
          </button>
        </form>
      </div>

      {/* Calm capability & guest session footer */}
      <div className="pt-4 border-t hairline-gold flex flex-wrap items-center justify-between gap-3 text-xs text-[#F5EDE1]/65">
        <span>
          {caps?.sarvam
            ? "Live AI by Sarvam is ON · Grounded in the wedding card."
            : caps?.live_ai
              ? "Live AI is ON · Grounded in the wedding card."
              : "Offline card fallback active in all 5 languages (no live AI keys set)."}
        </span>
        <button
          type="button"
          onClick={() => {
            setLastResult(null);
            setPendingConfirm(false);
            stopPlayback();
            onRotateGid();
          }}
          className="text-[11px] uppercase tracking-[0.18em] text-[#E6CFA3] hover:underline"
        >
          Switch Guest
        </button>
      </div>

      <audio
        ref={audioRef}
        onEnded={() => setIsSpeaking(false)}
        onPause={() => setIsSpeaking(false)}
        className="hidden"
      />
    </div>
  );
}
