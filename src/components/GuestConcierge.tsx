import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarPlus,
  Check,
  Edit3,
  HelpCircle,
  MapPin,
  Mic,
  MicOff,
  Send,
  Volume2,
  X,
} from "lucide-react";
import { downloadFunctionIcs } from "../utils/calendar";
import { WeddingCardData } from "./WeddingCardDrawer";

interface GuestRsvp {
  gid: string;
  household_code?: string | null;
  household_name?: string | null;
  attending: boolean | null;
  headcount: number | null;
  headcount_range: [number, number] | null;
  functions: string[];
  diet: { veg: number; jain: number; nonveg: number; no_onion_garlic: number };
  needs_room: boolean | null;
  confirmed: boolean;
  rsvp_complete: boolean;
  warnings: string[];
}

interface HouseholdInfo {
  code: string;
  family_name: string;
  preferred_language: string;
  age_band: "standard" | "elder";
}

interface TurnResult {
  job_id: string;
  status: "pending" | "queued" | "done" | "error";
  level: 0 | 1 | 2;
  transcript: string;
  detected_language: string;
  answer_text: string;
  answer_language: string;
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

interface Announcement {
  id: string;
  english: string;
  translations: Record<string, string>;
  created_at: string;
}

const GUEST_QUICK_QUESTIONS = [
  { label: "Sangeet time & venue", text: "Sangeet kitne baje start hoga aur kahan hai?" },
  { label: "Hum 4 log, 2 Jain, shaadi", text: "Hum 4 log aayenge, 2 Jain, sirf shaadi." },
  { label: "ಕನ್ನಡದಲ್ಲಿ ಮುಹೂರ್ತ", text: "ಮುಹೂರ್ತ ಮತ್ತು ಮದುವೆ ಎಷ್ಟು ಗಂಟೆಗೆ?" },
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

function getOrCreateGid(): string {
  const existingLs = localStorage.getItem("haanji_gid");
  if (existingLs) {
    document.cookie = `haanji_gid=${encodeURIComponent(existingLs)}; path=/; max-age=31536000; SameSite=Lax`;
    return existingLs;
  }
  const cookieMatch = document.cookie.match(/(?:^|; )haanji_gid=([^;]+)/);
  if (cookieMatch) {
    const val = decodeURIComponent(cookieMatch[1]);
    localStorage.setItem("haanji_gid", val);
    return val;
  }
  const fresh =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `gid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem("haanji_gid", fresh);
  document.cookie = `haanji_gid=${encodeURIComponent(fresh)}; path=/; max-age=31536000; SameSite=Lax`;
  return fresh;
}

function playStatusTone(level: 1 | 2) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = level === 1 ? 520 : 420;
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    // Ignore audio context restriction
  }
}

export function GuestConcierge({
  householdCode,
  onCardLoaded,
}: {
  householdCode?: string | null;
  onCardLoaded?: (card: WeddingCardData) => void;
}) {
  const [gid, setGid] = useState<string>(() => getOrCreateGid());
  const [card, setCard] = useState<WeddingCardData | null>(null);
  const [household, setHousehold] = useState<HouseholdInfo | null>(null);
  const [level, setLevel] = useState<0 | 1 | 2>(0);
  const [rsvp, setRsvp] = useState<GuestRsvp | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [readAnnouncementId, setReadAnnouncementId] = useState<string | null>(() =>
    localStorage.getItem("haanji_read_ann")
  );
  const [imageError, setImageError] = useState(false);

  const [elderMode, setElderMode] = useState<boolean>(
    () => localStorage.getItem("haanji_elder_mode") === "true"
  );
  const [languageHint, setLanguageHint] = useState("auto");
  const [textInput, setTextInput] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [countdown, setCountdown] = useState(25);
  const [micDeniedMsg, setMicDeniedMsg] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [thinkingStep, setThinkingStep] = useState(0);
  const [lastResult, setLastResult] = useState<TurnResult | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [confirmSaving, setConfirmSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    attending: true,
    headcount: 2,
    functions: ["shaadi"] as string[],
    jain: 0,
    veg: 2,
    nonveg: 0,
    needs_room: false,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const recordStartRef = useRef<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);

  const fetchCardAndState = async (currentGid: string, hCode?: string | null) => {
    try {
      const qs = new URLSearchParams({ gid: currentGid });
      if (hCode) qs.set("h", hCode);
      const res = await fetch(`/api/card?${qs.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      setCard(data.card);
      onCardLoaded?.(data.card);
      setLevel(data.level);
      setAnnouncements(data.announcements || []);
      if (data.household) {
        setHousehold(data.household);
      }
      if (
        data.elder_mode_default &&
        localStorage.getItem("haanji_elder_mode") === null
      ) {
        setElderMode(true);
      }
      if (data.rsvp) {
        setRsvp(data.rsvp);
        syncEditForm(data.rsvp);
      }
    } catch {
      // ignore background poll error
    }
  };

  useEffect(() => {
    void fetchCardAndState(gid, householdCode);
    const id = window.setInterval(() => {
      void fetchCardAndState(gid, householdCode);
    }, 4000);
    return () => window.clearInterval(id);
  }, [gid, householdCode]);

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

  const toggleElderMode = () => {
    const next = !elderMode;
    setElderMode(next);
    localStorage.setItem("haanji_elder_mode", String(next));
  };

  const syncEditForm = (r: GuestRsvp) => {
    setEditForm({
      attending: r.attending !== false,
      headcount: r.headcount ?? 2,
      functions: r.functions?.length ? r.functions : ["shaadi"],
      jain: r.diet?.jain ?? 0,
      veg: r.diet?.veg ?? 0,
      nonveg: r.diet?.nonveg ?? 0,
      needs_room: Boolean(r.needs_room),
    });
  };

  const playAnswerAudio = (base64: string, mime: string | null) => {
    if (!audioRef.current) return;
    audioRef.current.src = `data:${mime || "audio/wav"};base64,${base64}`;
    audioRef.current.playbackRate = elderMode ? 0.85 : 1.0;
    audioRef.current.play().catch(() => {});
  };

  const pollJobUntilDone = async (jobId: string) => {
    const start = Date.now();
    while (Date.now() - start < 45_000) {
      const res = await fetch(`/api/turn/${encodeURIComponent(jobId)}`);
      if (!res.ok) throw new Error("Unable to reach the concierge right now.");
      const job: TurnResult = await res.json();
      setLevel(job.level);
      if (job.status === "done" || job.status === "error") {
        setLastResult(job);
        if (job.rsvp) {
          setRsvp(job.rsvp);
          syncEditForm(job.rsvp);
        }
        setPendingConfirm(Boolean(job.rsvp_needs_confirmation && !job.rsvp?.confirmed));
        if (job.status === "error") {
          setErrorMsg("Koi baat nahi, thodi der mein dobara poochiye.");
        }
        if (job.audio_base64) {
          playAnswerAudio(job.audio_base64, job.audio_mime);
        } else if (job.prerendered_clip) {
          playStatusTone(job.level === 2 ? 2 : 1);
        }
        return;
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    throw new Error("Awaaz aane mein thoda waqt lag raha hai, kripya dobara poochiye.");
  };

  const submitTurn = async (payload: {
    text?: string;
    audioBase64?: string;
    audioMime?: string;
    audioBytes?: number;
    audioDurationSeconds?: number;
  }) => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gid,
          householdCode: household?.code || householdCode || undefined,
          ...payload,
          languageHint: languageHint === "auto" ? undefined : languageHint,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Koi baat nahi, dobara boliye.");
      }
      setLevel(data.level);
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
    if (isRecording || submitting) return;
    setMicDeniedMsg(null);
    setErrorMsg(null);
    try {
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(15);
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
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
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size < 200) return;
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = String(reader.result || "");
          const base64 = dataUrl.split(",")[1] || "";
          void submitTurn({
            audioBase64: base64,
            audioMime: mimeType,
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
      setMicDeniedMsg(
        "Microphone available nahi hai. Koi baat nahi, aap niche Hindi, English, Kannada ya Tamil mein type kar sakte hain."
      );
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
        setRsvp(data.rsvp);
        setPendingConfirm(false);
      }
    } finally {
      setConfirmSaving(false);
    }
  };

  const handleSaveManualRsvp = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`/api/rsvp/${encodeURIComponent(gid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          householdCode: household?.code || householdCode || undefined,
          attending: editForm.attending,
          headcount: editForm.attending ? Number(editForm.headcount) : 0,
          functions: editForm.attending ? editForm.functions : [],
          diet: {
            veg: Number(editForm.veg),
            jain: Number(editForm.jain),
            nonveg: Number(editForm.nonveg),
            no_onion_garlic: 0,
          },
          needs_room: editForm.needs_room,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update RSVP");
      setRsvp(data.rsvp);
      setPendingConfirm(false);
      setEditOpen(false);
    } catch {
      setErrorMsg("Koi baat nahi, RSVP save nahi ho paaya. Dobara try karein.");
    }
  };

  const rotateSession = () => {
    const fresh = crypto.randomUUID ? crypto.randomUUID() : `gid-${Date.now()}`;
    localStorage.setItem("haanji_gid", fresh);
    document.cookie = `haanji_gid=${encodeURIComponent(fresh)}; path=/; max-age=31536000; SameSite=Lax`;
    setGid(fresh);
    setRsvp(null);
    setLastResult(null);
    setPendingConfirm(false);
  };

  const statusChipLabel =
    level === 0
      ? "Live voice"
      : level === 1
        ? "Text replies (very busy)"
        : "Queued, answer in about a minute";

  const statusChipClass =
    level === 0
      ? "text-[#2F6B4F] border-[#2F6B4F]/30 bg-[#2F6B4F]/10"
      : level === 1
        ? "text-[#8A4F09] border-[#F2A93B]/50 bg-[#F2A93B]/15"
        : "text-[#6B1E2E] border-[#6B1E2E]/30 bg-[#6B1E2E]/10";

  const langKey =
    languageHint === "auto"
      ? "hinglish"
      : languageHint.split("-")[0];
  const activeThinkingText = (THINKING_STAGES_BY_LANG[langKey] || THINKING_STAGES_BY_LANG.hinglish)[thinkingStep];

  const topAnnouncement = announcements[0];
  const hasUnreadAnnouncement =
    Boolean(topAnnouncement) && topAnnouncement.id !== readAnnouncementId;

  const speakAnnouncement = (text: string) => {
    if (!topAnnouncement) return;
    setReadAnnouncementId(topAnnouncement.id);
    localStorage.setItem("haanji_read_ann", topAnnouncement.id);
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = elderMode ? 0.82 : 0.96;
      window.speechSynthesis.speak(u);
    }
  };

  const ringRadius = 42;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference * (1 - countdown / 25);

  return (
    <div className={`mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8 ${elderMode ? "text-base" : ""}`}>
      {/* Host Announcement Banner */}
      {topAnnouncement && (
        <div
          onClick={() => {
            setReadAnnouncementId(topAnnouncement.id);
            localStorage.setItem("haanji_read_ann", topAnnouncement.id);
          }}
          className="mb-6 rounded-2xl border border-[#C9A96E]/60 bg-white px-5 py-4 text-[#1F1A17] shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {hasUnreadAnnouncement && (
                <span className="h-2.5 w-2.5 rounded-full bg-[#6B1E2E]" aria-label="Unread update" />
              )}
              <span className="font-semibold text-sm text-[#6B1E2E]">Family Update</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const spoken =
                    topAnnouncement.translations?.[langKey] ||
                    topAnnouncement.english;
                  speakAnnouncement(spoken);
                }}
                className="min-h-[36px] px-3 rounded-lg border border-[#C9A96E]/50 text-xs font-medium text-[#6B1E2E] hover:bg-[#FBF7F0] inline-flex items-center gap-1.5"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>Listen</span>
              </button>
              <span className="text-xs text-[#6F6259]">
                {new Date(topAnnouncement.created_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          </div>
          <p className={`mt-1.5 ${elderMode ? "text-lg font-medium" : "text-sm"} text-[#1F1A17]`}>
            {topAnnouncement.translations?.[langKey] || topAnnouncement.english}
          </p>
          {topAnnouncement.translations?.hi && langKey === "hinglish" && (
            <p className="mt-1 text-xs text-[#6F6259]">
              {topAnnouncement.translations.hi} · {topAnnouncement.translations.kn} ·{" "}
              {topAnnouncement.translations.ta}
            </p>
          )}
        </div>
      )}

      {/* Main Split Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-stretch">
        {/* Left: Wedding Invitation Hero Card */}
        <div className="lg:col-span-5 flex flex-col justify-between rounded-2xl border border-[#C9A96E]/45 bg-white overflow-hidden">
          <div>
            {/* Subtle inline rangoli header motif (<4 KB) */}
            <div className="relative bg-[#6B1E2E] text-[#FBF7F0] px-5 py-3 flex items-center justify-between overflow-hidden">
              <svg
                aria-hidden="true"
                viewBox="0 0 240 40"
                className="pointer-events-none absolute inset-0 w-full h-full opacity-20"
                preserveAspectRatio="none"
              >
                <path
                  d="M0 20 Q20 4 40 20 T80 20 T120 20 T160 20 T200 20 T240 20"
                  fill="none"
                  stroke="#F2A93B"
                  strokeWidth="1.2"
                />
                <circle cx="40" cy="20" r="3" fill="#C9A96E" />
                <circle cx="120" cy="20" r="3" fill="#C9A96E" />
                <circle cx="200" cy="20" r="3" fill="#C9A96E" />
              </svg>
              <span className="relative text-xs font-medium tracking-wide text-[#F2A93B]">
                {household ? `Welcome, ${household.family_name}` : "Shubh Vivah Concierge"}
              </span>
              <span className="relative text-xs text-[#FBF7F0]/90">Bengaluru</span>
            </div>

            <div className="relative h-52 sm:h-60 w-full bg-[#FBF7F0] overflow-hidden">
              {!imageError ? (
                <img
                  src="/src/assets/images/sharma_reddy_venue_1795418307752.jpg"
                  alt="Tamarind Tree wedding garden pavilion with marigold garlands"
                  referrerPolicy="no-referrer"
                  onError={() => setImageError(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="h-full w-full flex flex-col items-center justify-center bg-[#FBF7F0] p-6 text-center">
                  <span className="font-display text-xl font-semibold text-[#6B1E2E]">
                    Tamarind Tree &amp; Leela Palace
                  </span>
                  <span className="mt-1 text-xs text-[#6F6259]">Bengaluru, Karnataka</span>
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[#1F1A17]/80 via-[#1F1A17]/20 to-transparent" />
              <div className="absolute bottom-4 left-5 right-5 text-white">
                <p className="text-xs text-[#F2A93B]">
                  {card?.wedding.dates || "28-29 November 2026"} · {card?.wedding.subtitle || "Aarav & Ananya"}
                </p>
                <h1 className={`mt-0.5 font-display font-semibold tracking-tight text-white ${elderMode ? "text-3xl" : "text-2xl sm:text-3xl"}`}>
                  {card?.wedding.title || "Sharma & Reddy Wedding"}
                </h1>
              </div>
            </div>

            <div className="p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#C9A96E]/35">
                <span className={`inline-flex items-center px-3 py-1 rounded-full border text-xs font-medium ${statusChipClass}`}>
                  {statusChipLabel}
                </span>

                <button
                  type="button"
                  onClick={toggleElderMode}
                  aria-pressed={elderMode}
                  className={`min-h-[44px] px-3.5 py-2 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    elderMode
                      ? "bg-[#1F1A17] text-[#FBF7F0] border-[#1F1A17]"
                      : "bg-[#FBF7F0] text-[#1F1A17] border-[#C9A96E]/60 hover:bg-[#F3EADF]"
                  }`}
                >
                  Elder Mode: {elderMode ? "ON" : "OFF"}
                </button>
              </div>

              <div>
                <h2 className={`font-display font-semibold text-[#6B1E2E] ${elderMode ? "text-lg" : "text-sm"}`}>
                  Celebration Schedule
                </h2>
                <div className="mt-3 divide-y divide-[#C9A96E]/30">
                  {(card?.functions || []).map((f) => (
                    <div key={f.id} className="py-2.5 flex items-baseline justify-between gap-3">
                      <div>
                        <p className={`font-medium text-[#1F1A17] ${elderMode ? "text-base" : "text-sm"}`}>
                          {f.name}
                        </p>
                        <p className={`${elderMode ? "text-sm" : "text-xs"} text-[#5C4F46]`}>{f.venue}</p>
                      </div>
                      <span className={`${elderMode ? "text-sm" : "text-xs"} font-medium tabular-nums text-[#6B1E2E] whitespace-nowrap`}>
                        {f.date.replace(" 2026", "")} · {f.time}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 bg-[#FBF7F0] border-t border-[#C9A96E]/35 flex flex-wrap items-center justify-between gap-3 text-xs text-[#5C4F46]">
            <button
              type="button"
              onClick={() => setHowItWorksOpen(true)}
              className="min-h-[36px] inline-flex items-center gap-1.5 font-medium text-[#6B1E2E] hover:underline"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>How HaanJi works</span>
            </button>
            <button
              type="button"
              onClick={rotateSession}
              className="min-h-[36px] text-[#6B1E2E] font-medium hover:underline whitespace-nowrap shrink-0"
            >
              Switch Guest
            </button>
          </div>
        </div>

        {/* Right: Voice & Text Concierge */}
        <div className="lg:col-span-7 flex flex-col justify-between rounded-2xl border border-[#C9A96E]/45 bg-white p-6 sm:p-8">
          <div>
            {/* Controls Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-[#C9A96E]/35">
              <div>
                <h2 className={`font-display font-semibold text-[#1F1A17] ${elderMode ? "text-2xl" : "text-xl"}`}>
                  Poochiye, HaanJi sun raha hai
                </h2>
                <p className={`mt-0.5 text-[#5C4F46] ${elderMode ? "text-base" : "text-sm"}`}>
                  Speak or write in Hindi, Hinglish, English, ಕನ್ನಡ or தமிழ்.
                </p>
              </div>
              <select
                aria-label="Preferred language"
                value={languageHint}
                onChange={(e) => setLanguageHint(e.target.value)}
                className="min-h-[44px] rounded-xl border border-[#C9A96E]/60 bg-[#FBF7F0] px-3 text-xs font-medium text-[#1F1A17] focus:outline-none focus:ring-2 focus:ring-[#6B1E2E]"
              >
                <option value="auto">Auto Language</option>
                <option value="hinglish">Hinglish</option>
                <option value="hi-IN">Hindi (हिन्दी)</option>
                <option value="kn-IN">Kannada (ಕನ್ನಡ)</option>
                <option value="ta-IN">Tamil (தமிழ்)</option>
                <option value="en-IN">English (India)</option>
              </select>
            </div>

            {/* Hold-to-ask Voice Zone (Thumb-reachable, >= 88px target, 25s ring) */}
            <div className="my-6 flex flex-col items-center justify-center rounded-2xl border border-[#C9A96E]/40 bg-[#FBF7F0] p-6 text-center">
              <div className="relative inline-flex items-center justify-center">
                {isRecording && (
                  <svg
                    className="pointer-events-none absolute -inset-2 w-[112px] h-[112px] -rotate-90"
                    viewBox="0 0 96 96"
                  >
                    <circle
                      cx="48"
                      cy="48"
                      r={ringRadius}
                      fill="none"
                      stroke="#C9A96E"
                      strokeWidth="3"
                      opacity="0.3"
                    />
                    <circle
                      cx="48"
                      cy="48"
                      r={ringRadius}
                      fill="none"
                      stroke="#6B1E2E"
                      strokeWidth="3.5"
                      strokeDasharray={ringCircumference}
                      strokeDashoffset={ringOffset}
                      strokeLinecap="round"
                    />
                  </svg>
                )}

                <button
                  type="button"
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
                  className={`min-h-[88px] min-w-[220px] px-7 py-4 rounded-full font-semibold text-base flex items-center justify-center gap-3 transition-transform active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6B1E2E] ${
                    isRecording
                      ? "bg-[#6B1E2E] text-white shadow-md"
                      : "bg-[#F2A93B] text-[#1F1A17] hover:bg-[#e59a28] shadow-sm marigold-pulse"
                  } disabled:opacity-60`}
                >
                  {isRecording ? (
                    <>
                      <MicOff className="w-6 h-6" />
                      <span className="tabular-nums">{countdown}s · Release to send</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-6 h-6" />
                      <span>{submitting ? activeThinkingText : "Hold to ask"}</span>
                    </>
                  )}
                </button>
              </div>

              {isRecording ? (
                <div className="mt-4 flex items-end justify-center gap-1 h-5" aria-hidden="true">
                  {[12, 20, 16, 24, 14, 22, 15].map((h, idx) => (
                    <span
                      key={idx}
                      className="w-1 rounded-full bg-[#6B1E2E] animate-pulse"
                      style={{ height: `${h}px` }}
                    />
                  ))}
                </div>
              ) : (
                <p className={`mt-3 text-[#5C4F46] ${elderMode ? "text-sm" : "text-xs"}`}>
                  Press and hold up to 25 seconds, or type your message below.
                </p>
              )}

              {micDeniedMsg && (
                <p className="mt-3 text-xs text-[#6B1E2E] bg-white border border-[#C9A96E]/50 rounded-xl px-4 py-2.5">
                  {micDeniedMsg}
                </p>
              )}
            </div>

            {/* Helpful Guest Question Chips */}
            <div className="mb-5">
              <p className="text-xs font-medium text-[#5C4F46] mb-2">Common guest questions:</p>
              <div className="flex flex-wrap gap-2">
                {GUEST_QUICK_QUESTIONS.map((sp) => (
                  <button
                    key={sp.label}
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setTextInput(sp.text);
                      void submitTurn({ text: sp.text });
                    }}
                    className="min-h-[44px] px-3.5 py-2 text-xs font-medium rounded-xl border border-[#C9A96E]/50 bg-[#FBF7F0] text-[#1F1A17] hover:bg-[#F3EADF] transition-colors whitespace-nowrap"
                  >
                    {sp.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Text Input Fallback */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!textInput.trim() || submitting) return;
                void submitTurn({ text: textInput.trim() });
              }}
              className="flex gap-2"
            >
              <input
                ref={textInputRef}
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Ask about timings, venue, menu, or RSVP..."
                className={`flex-1 min-h-[48px] rounded-xl border border-[#C9A96E]/60 bg-white px-4 text-[#1F1A17] placeholder:text-[#8B7D72] focus:outline-none focus:ring-2 focus:ring-[#6B1E2E] ${
                  elderMode ? "text-base" : "text-sm"
                }`}
              />
              <button
                type="submit"
                disabled={submitting || !textInput.trim()}
                className="min-h-[48px] px-5 rounded-xl bg-[#6B1E2E] text-white text-sm font-medium hover:bg-[#541724] disabled:opacity-50 flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <Send className="w-4 h-4" />
                <span>Send</span>
              </button>
            </form>

            {/* Friendly Error Message */}
            {errorMsg && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-[#6B1E2E]/30 bg-[#FBF7F0] px-4 py-3 text-sm text-[#6B1E2E]">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <p>{errorMsg}</p>
              </div>
            )}

            {/* Answer Card */}
            {lastResult && !errorMsg && (
              <div className="mt-6 pt-5 border-t border-[#C9A96E]/35 space-y-3 transition-all duration-150">
                {lastResult.transcript && (
                  <p className="text-xs text-[#6F6259]">
                    Heard: &ldquo;{lastResult.transcript}&rdquo;
                  </p>
                )}

                <p
                  className={`font-display leading-snug text-[#1F1A17] ${
                    elderMode ? "text-2xl sm:text-3xl font-semibold" : "text-xl sm:text-2xl"
                  }`}
                >
                  {lastResult.answer_text}
                </p>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  {lastResult.audio_base64 && (
                    <button
                      type="button"
                      onClick={() =>
                        playAnswerAudio(lastResult.audio_base64!, lastResult.audio_mime)
                      }
                      className="min-h-[44px] px-4 rounded-xl border border-[#C9A96E]/60 bg-[#FBF7F0] text-xs font-semibold text-[#6B1E2E] hover:bg-[#F3EADF] inline-flex items-center gap-1.5"
                    >
                      <Volume2 className="w-4 h-4" />
                      <span>Listen again</span>
                    </button>
                  )}

                  {lastResult.matched_function?.maps_url && (
                    <a
                      href={lastResult.matched_function.maps_url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-h-[44px] px-4 rounded-xl border border-[#C9A96E]/60 bg-white text-xs font-semibold text-[#1F1A17] hover:bg-[#FBF7F0] inline-flex items-center gap-1.5"
                    >
                      <MapPin className="w-4 h-4 text-[#6B1E2E]" />
                      <span>Map: {lastResult.matched_function.name}</span>
                    </a>
                  )}

                  {lastResult.matched_function && (
                    <button
                      type="button"
                      onClick={() => downloadFunctionIcs(lastResult.matched_function!)}
                      className="min-h-[44px] px-4 rounded-xl border border-[#C9A96E]/60 bg-white text-xs font-semibold text-[#1F1A17] hover:bg-[#FBF7F0] inline-flex items-center gap-1.5"
                    >
                      <CalendarPlus className="w-4 h-4 text-[#2F6B4F]" />
                      <span>Add to calendar</span>
                    </button>
                  )}

                  {lastResult.grounding_violation && (
                    <span className="text-xs font-medium text-[#6B1E2E]">
                      Forwarded to Sharma &amp; Reddy family desk.
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* 2-Step Friendly RSVP Confirmation Card */}
            {pendingConfirm && rsvp && (
              <div className="mt-5 rounded-2xl border border-[#F2A93B] bg-[#FBF7F0] p-5 space-y-3">
                <p className={`font-semibold text-[#1F1A17] ${elderMode ? "text-lg" : "text-sm"}`}>
                  {rsvp.headcount
                    ? `${rsvp.headcount} log, ${rsvp.functions.join(", ") || "functions pending"}${
                        rsvp.diet.jain > 0 ? `, ${rsvp.diet.jain} Jain` : ""
                      }. Sahi hai?`
                    : rsvp.headcount_range
                      ? `${rsvp.headcount_range[0]}-${rsvp.headcount_range[1]} log tentative, ${
                          rsvp.functions.join(", ") || "Shaadi"
                        }. Confirm exact count?`
                      : "Please confirm your RSVP details."}
                </p>
                <div className="flex flex-wrap gap-2.5">
                  {rsvp.headcount && (
                    <button
                      type="button"
                      disabled={confirmSaving}
                      onClick={handleConfirmRsvp}
                      className="min-h-[44px] px-5 rounded-xl bg-[#2F6B4F] text-white text-xs font-semibold hover:bg-[#24543e] inline-flex items-center gap-1.5"
                    >
                      <Check className="w-4 h-4" />
                      <span>Haan, confirm</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditOpen(true)}
                    className="min-h-[44px] px-5 rounded-xl border border-[#C9A96E] bg-white text-[#1F1A17] text-xs font-semibold hover:bg-[#F3EADF]"
                  >
                    Badlo (Edit)
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Recorded RSVP Summary & Manual Edit Form */}
          <div className="mt-6 pt-5 border-t border-[#C9A96E]/35">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-[#5C4F46]">Your RSVP on record</p>
                {rsvp ? (
                  <p className={`mt-0.5 font-medium text-[#1F1A17] ${elderMode ? "text-base" : "text-sm"}`}>
                    {rsvp.attending === false
                      ? "Not attending"
                      : `${
                          rsvp.headcount ??
                          (rsvp.headcount_range
                            ? `${rsvp.headcount_range[0]}-${rsvp.headcount_range[1]} tentative`
                            : "Pending headcount")
                        } · ${
                          rsvp.functions.length ? rsvp.functions.join(" + ") : "No functions selected"
                        }${rsvp.diet.jain > 0 ? ` · ${rsvp.diet.jain} Jain` : ""}${
                          rsvp.needs_room ? " · Room requested" : ""
                        }${rsvp.confirmed ? " · Confirmed" : " · Awaiting your tap"}`}
                  </p>
                ) : (
                  <p className={`mt-0.5 text-[#5C4F46] ${elderMode ? "text-base" : "text-sm"}`}>
                    Tell HaanJi how many guests are joining and for which functions.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setEditOpen(!editOpen)}
                className="min-h-[44px] px-3.5 py-2 rounded-xl border border-[#C9A96E]/60 text-xs font-medium text-[#1F1A17] hover:bg-[#FBF7F0] flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>{editOpen ? "Close" : "Edit"}</span>
              </button>
            </div>

            {rsvp?.warnings && rsvp.warnings.length > 0 && (
              <p className="mt-2 text-xs text-[#6B1E2E]">{rsvp.warnings[0]}</p>
            )}

            {editOpen && (
              <form
                onSubmit={handleSaveManualRsvp}
                className="mt-4 p-4 rounded-xl bg-[#FBF7F0] border border-[#C9A96E]/45 space-y-4"
              >
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <label className="text-xs text-[#1F1A17]">
                    Attending
                    <select
                      value={editForm.attending ? "yes" : "no"}
                      onChange={(e) =>
                        setEditForm({ ...editForm, attending: e.target.value === "yes" })
                      }
                      className="mt-1 w-full min-h-[44px] rounded-lg border border-[#C9A96E]/60 bg-white px-2 text-sm"
                    >
                      <option value="yes">Yes</option>
                      <option value="no">Cannot attend</option>
                    </select>
                  </label>

                  <label className="text-xs text-[#1F1A17]">
                    Headcount
                    <input
                      type="number"
                      min={0}
                      max={50}
                      disabled={!editForm.attending}
                      value={editForm.headcount}
                      onChange={(e) =>
                        setEditForm({ ...editForm, headcount: Number(e.target.value) })
                      }
                      className="mt-1 w-full min-h-[44px] rounded-lg border border-[#C9A96E]/60 bg-white px-2 text-sm tabular-nums"
                    />
                  </label>

                  <label className="text-xs text-[#1F1A17]">
                    Jain Meals
                    <input
                      type="number"
                      min={0}
                      disabled={!editForm.attending}
                      value={editForm.jain}
                      onChange={(e) =>
                        setEditForm({ ...editForm, jain: Number(e.target.value) })
                      }
                      className="mt-1 w-full min-h-[44px] rounded-lg border border-[#C9A96E]/60 bg-white px-2 text-sm tabular-nums"
                    />
                  </label>

                  <label className="text-xs text-[#1F1A17]">
                    Veg Meals
                    <input
                      type="number"
                      min={0}
                      disabled={!editForm.attending}
                      value={editForm.veg}
                      onChange={(e) =>
                        setEditForm({ ...editForm, veg: Number(e.target.value) })
                      }
                      className="mt-1 w-full min-h-[44px] rounded-lg border border-[#C9A96E]/60 bg-white px-2 text-sm tabular-nums"
                    />
                  </label>
                </div>

                {editForm.attending && (
                  <div className="flex flex-wrap items-center gap-2.5 text-xs">
                    {(["mehendi", "sangeet", "shaadi", "reception"] as const).map((fnId) => {
                      const active = editForm.functions.includes(fnId);
                      return (
                        <button
                          key={fnId}
                          type="button"
                          onClick={() =>
                            setEditForm({
                              ...editForm,
                              functions: active
                                ? editForm.functions.filter((f) => f !== fnId)
                                : [...editForm.functions, fnId],
                            })
                          }
                          className={`min-h-[44px] px-3.5 py-2 rounded-xl border font-medium capitalize ${
                            active
                              ? "border-[#6B1E2E] bg-[#6B1E2E] text-white"
                              : "border-[#C9A96E]/60 bg-white text-[#1F1A17]"
                          }`}
                        >
                          {fnId}
                        </button>
                      );
                    })}
                    <label className="ml-auto inline-flex items-center gap-2 text-[#1F1A17]">
                      <input
                        type="checkbox"
                        checked={editForm.needs_room}
                        onChange={(e) =>
                          setEditForm({ ...editForm, needs_room: e.target.checked })
                        }
                      />
                      Needs hotel room
                    </label>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="min-h-[44px] px-5 py-2 rounded-xl bg-[#2F6B4F] text-white text-xs font-semibold hover:bg-[#24543e] inline-flex items-center gap-1.5"
                  >
                    <Check className="w-4 h-4" />
                    Save RSVP
                  </button>
                </div>
              </form>
            )}
          </div>

          <audio ref={audioRef} className="hidden" />
        </div>
      </div>

      {/* How HaanJi Works Plain-Language Modal */}
      {howItWorksOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1A17]/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="How HaanJi works"
        >
          <div className="w-full max-w-md rounded-2xl border border-[#C9A96E] bg-[#FBF7F0] p-6 text-[#1F1A17] shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl font-semibold text-[#6B1E2E]">
                How HaanJi works
              </h3>
              <button
                type="button"
                onClick={() => setHowItWorksOpen(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-[#C9A96E]/50 text-[#1F1A17] hover:bg-white"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3 text-sm leading-relaxed text-[#3E352F]">
              <p>
                1. Every answer comes straight from the official Sharma &amp; Reddy wedding invitation card. HaanJi never guesses timings or venues.
              </p>
              <p>
                2. When you share your family headcount and Jain or vegetarian preferences, HaanJi shows a confirmation step before updating the caterer tally.
              </p>
              <p>
                3. If a detail is not on the invitation yet, your question goes straight to the family host desk so they can add the answer for everyone.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setHowItWorksOpen(false)}
              className="w-full min-h-[44px] rounded-xl bg-[#6B1E2E] text-white text-xs font-semibold hover:bg-[#541724]"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
