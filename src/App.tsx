import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AudioLines,
  BookOpen,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Edit3,
  ExternalLink,
  Flag,
  MapPin,
  Menu,
  Mic,
  Phone,
  Play,
  ShieldCheck,
  Sparkles,
  Volume2,
  WifiOff,
  X,
} from "lucide-react";
import { DemoChecklist, DemoStepId } from "./components/DemoChecklist";
import { GuestConcierge, GuestDemoEvent } from "./components/GuestConcierge";
import { HostDashboard } from "./components/HostDashboard";
import { JudgeMode } from "./components/JudgeMode";
import { OpsControlPlane } from "./components/OpsControlPlane";
import { TestWorkbench } from "./components/TestWorkbench";
import { WeddingCardDrawer } from "./components/WeddingCardDrawer";
import {
  AnnouncementItem,
  CapabilitiesSummary,
  CardApiState,
  GuestRsvp,
  HouseholdInfo,
  WeddingCardData,
} from "./types/haanji";
import { downloadFunctionIcs } from "./utils/calendar";

type WorkspaceView = "landing" | "host" | "ops" | "judge" | "tests";

const INITIAL_DEMO_DONE: Record<DemoStepId, boolean> = {
  hinglish: false,
  kannada: false,
  tamil: false,
  rsvp_confirmed: false,
  elder_mode: false,
  ops_rush_done: false,
  ops_flags_checked: false,
};

const SECTION_IDS = ["home", "schedule", "ask", "rsvp", "venues", "faqs", "contacts"] as const;

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

function bcpForAnnouncement(langKey: string): string {
  if (langKey === "kn") return "kn-IN";
  if (langKey === "ta") return "ta-IN";
  if (langKey === "hi" || langKey === "hinglish") return "hi-IN";
  return "en-IN";
}

export default function App() {
  const [activeView, setActiveView] = useState<WorkspaceView>(() => {
    if (typeof window !== "undefined") {
      if (window.location.pathname.startsWith("/judge")) return "judge";
      if (window.location.pathname.startsWith("/host")) return "host";
      if (window.location.pathname.startsWith("/ops")) return "ops";
    }
    return "landing";
  });

  const [gid, setGid] = useState<string>(() => getOrCreateGid());
  const [householdCode, setHouseholdCode] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("h");
    }
    return null;
  });
  const [isDemoMode] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("demo") === "1";
    }
    return false;
  });

  const [card, setCard] = useState<WeddingCardData | null>(null);
  const [household, setHousehold] = useState<HouseholdInfo | null>(null);
  const [level, setLevel] = useState<0 | 1 | 2>(0);
  const [voicePausedFlag, setVoicePausedFlag] = useState(false);
  const [rsvp, setRsvp] = useState<GuestRsvp | null>(null);
  const [rsvpCutoff, setRsvpCutoff] = useState<string | null>(null);
  const [rsvpClosed, setRsvpClosed] = useState(false);
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [dismissedAnnId, setDismissedAnnId] = useState<string | null>(() =>
    localStorage.getItem("haanji_dismissed_ann")
  );
  const [caps, setCaps] = useState<CapabilitiesSummary | null>(null);
  const [opsAvailable, setOpsAvailable] = useState<boolean>(false);

  const [languageHint, setLanguageHint] = useState("auto");
  const [elderMode, setElderMode] = useState<boolean>(
    () => localStorage.getItem("haanji_elder_mode") === "true"
  );
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("home");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [teamMenuOpen, setTeamMenuOpen] = useState(false);
  const [cardDrawerOpen, setCardDrawerOpen] = useState(false);
  const [venueImageError, setVenueImageError] = useState(false);
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [parallaxOffset, setParallaxOffset] = useState({ x: 0, y: 0 });

  // Hero reply typewriter & audio preview
  const [typedHeroReply, setTypedHeroReply] = useState("");
  const [heroAudioPlaying, setHeroAudioPlaying] = useState(false);
  const heroAudioRef = useRef<HTMLAudioElement | null>(null);
  const annAudioRef = useRef<HTMLAudioElement | null>(null);

  // RSVP inline editor state for #rsvp section
  const [rsvpEditOpen, setRsvpEditOpen] = useState(false);
  const [rsvpSaving, setRsvpSaving] = useState(false);
  const [rsvpSaveNote, setRsvpSaveNote] = useState<string | null>(null);
  const [rsvpForm, setRsvpForm] = useState({
    attending: true,
    headcount: 2,
    functions: ["shaadi"] as string[],
    jain: 0,
    veg: 2,
    nonveg: 0,
    needs_room: false,
  });

  // Concierge coordination signals
  const [focusAskNonce, setFocusAskNonce] = useState(0);
  const [externalQuestion, setExternalQuestion] = useState<{
    text: string;
    autoSubmit?: boolean;
    nonce: number;
  } | null>(null);
  const [demoDone, setDemoDone] = useState<Record<DemoStepId, boolean>>(INITIAL_DEMO_DONE);
  const [guestDemoCmd, setGuestDemoCmd] = useState<{
    action: "ask" | "elder" | "focus_mic";
    text?: string;
    lang?: string;
    nonce: number;
  } | null>(null);
  const [opsDemoFocus, setOpsDemoFocus] = useState<{
    section: "rush" | "flags";
    nonce: number;
  } | null>(null);

  const teamMenuRef = useRef<HTMLDivElement | null>(null);

  const syncRsvpForm = useCallback((next: GuestRsvp) => {
    setRsvpForm({
      attending: next.attending !== false,
      headcount: next.headcount ?? 2,
      functions: next.functions?.length ? next.functions : ["shaadi"],
      jain: next.diet?.jain ?? 0,
      veg: next.diet?.veg ?? 0,
      nonveg: next.diet?.nonveg ?? 0,
      needs_room: Boolean(next.needs_room),
    });
  }, []);

  const fetchCardAndState = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ gid });
      if (householdCode) qs.set("h", householdCode);
      if (languageHint && languageHint !== "auto") qs.set("lang", languageHint);
      const res = await fetch(`/api/card?${qs.toString()}`);
      if (!res.ok) return;
      const data: CardApiState = await res.json();
      setCard(data.card);
      setLevel(data.level);
      setVoicePausedFlag(Boolean(data.voice_paused));
      setAnnouncements(data.announcements || []);
      setRsvpCutoff(data.rsvp_cutoff || null);
      setRsvpClosed(Boolean(data.rsvp_closed));
      if (data.household) setHousehold(data.household);
      if (
        data.elder_mode_default &&
        localStorage.getItem("haanji_elder_mode") === null
      ) {
        setElderMode(true);
      }
      if (data.rsvp) {
        setRsvp(data.rsvp);
        syncRsvpForm(data.rsvp);
      }
      try {
        localStorage.setItem("haanji_cached_card", JSON.stringify(data.card));
      } catch {
        // ignore quota
      }
    } catch {
      // Fallback to cached card if offline
      try {
        const cached = localStorage.getItem("haanji_cached_card");
        if (cached && !card) {
          setCard(JSON.parse(cached) as WeddingCardData);
        }
      } catch {
        // ignore
      }
    }
  }, [gid, householdCode, languageHint, syncRsvpForm, card]);

  const fetchCapabilities = useCallback(async (refresh = false) => {
    try {
      const res = await fetch(`/api/capabilities${refresh ? "?refresh=1" : ""}`);
      if (res.ok) {
        setCaps(await res.json());
      }
    } catch {
      // ignore transient error
    }
  }, []);

  useEffect(() => {
    const h = new URLSearchParams(window.location.search).get("h");
    if (h) setHouseholdCode(h);
  }, []);

  useEffect(() => {
    void fetchCardAndState();
    const id = window.setInterval(() => {
      void fetchCardAndState();
    }, 4500);
    return () => window.clearInterval(id);
  }, [fetchCardAndState]);

  useEffect(() => {
    void fetchCapabilities();
    const capTimer = window.setInterval(() => {
      void fetchCapabilities();
    }, 15000);
    return () => window.clearInterval(capTimer);
  }, [fetchCapabilities]);

  useEffect(() => {
    let active = true;
    fetch("/api/ops-proxy/state")
      .then((r) => {
        if (active && r.ok) setOpsAvailable(true);
      })
      .catch(() => {
        if (active) setOpsAvailable(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 18);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onClickOutside = (ev: MouseEvent) => {
      if (teamMenuRef.current && !teamMenuRef.current.contains(ev.target as Node)) {
        setTeamMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Scrollspy for single-scroll landing sections
  useEffect(() => {
    if (activeView !== "landing") return;
    const observers: IntersectionObserver[] = [];
    const visibleRatios: Record<string, number> = {};

    for (const id of SECTION_IDS) {
      const el = document.getElementById(id);
      if (!el) continue;
      const obs = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            visibleRatios[id] = entry.isIntersecting ? entry.intersectionRatio : 0;
          }
          let bestId = "home";
          let bestRatio = -1;
          for (const candidate of SECTION_IDS) {
            const ratio = visibleRatios[candidate] ?? 0;
            if (ratio > bestRatio && ratio > 0.12) {
              bestRatio = ratio;
              bestId = candidate;
            }
          }
          if (bestRatio > 0) {
            setActiveSection(bestId);
            const targetHash = bestId === "home" ? "" : `#${bestId}`;
            if (window.location.hash !== targetHash && window.location.pathname === "/") {
              window.history.replaceState(
                {},
                "",
                `${window.location.pathname}${window.location.search}${targetHash}`
              );
            }
          }
        },
        { threshold: [0.15, 0.35, 0.6], rootMargin: "-72px 0px -30% 0px" }
      );
      obs.observe(el);
      observers.push(obs);
    }

    return () => {
      observers.forEach((o) => o.disconnect());
    };
  }, [activeView, card]);

  // Dynamic hero Sangeet reply from /api/card
  const sangeetFn = useMemo(() => {
    return card?.functions?.find((f) => f.id === "sangeet") || card?.functions?.[1] || card?.functions?.[0] || null;
  }, [card]);

  const fullHeroReply = useMemo(() => {
    if (!sangeetFn) return "";
    return `Namaste! ${sangeetFn.name} is at ${sangeetFn.time} on ${sangeetFn.date} at ${sangeetFn.venue}. Dress code: ${sangeetFn.dress_code}.`;
  }, [sangeetFn]);

  useEffect(() => {
    if (!fullHeroReply) {
      setTypedHeroReply("");
      return;
    }
    if (prefersReducedMotion) {
      setTypedHeroReply(fullHeroReply);
      return;
    }
    setTypedHeroReply("");
    let idx = 0;
    const timer = window.setInterval(() => {
      idx += 2;
      setTypedHeroReply(fullHeroReply.slice(0, idx));
      if (idx >= fullHeroReply.length) {
        window.clearInterval(timer);
      }
    }, 24);
    return () => window.clearInterval(timer);
  }, [fullHeroReply, prefersReducedMotion]);

  const scrollToSection = (sectionId: string, focusConcierge = false) => {
    setMobileMenuOpen(false);
    setTeamMenuOpen(false);
    if (activeView !== "landing") {
      setActiveView("landing");
      window.setTimeout(() => {
        const el = document.getElementById(sectionId);
        el?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
        if (focusConcierge) setFocusAskNonce((n) => n + 1);
      }, 90);
    } else {
      const el = document.getElementById(sectionId);
      el?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
      if (focusConcierge) setFocusAskNonce((n) => n + 1);
    }
    setActiveSection(sectionId);
    const nextHash = sectionId === "home" ? "" : `#${sectionId}`;
    window.history.replaceState({}, "", `/${window.location.search}${nextHash}`);
  };

  const switchWorkspaceView = (view: WorkspaceView) => {
    setActiveView(view);
    setMobileMenuOpen(false);
    setTeamMenuOpen(false);
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? "auto" : "smooth" });
  };

  const toggleElderMode = () => {
    const next = !elderMode;
    setElderMode(next);
    localStorage.setItem("haanji_elder_mode", String(next));
    if (next && isDemoMode) {
      setDemoDone((prev) => ({ ...prev, elder_mode: true }));
    }
  };

  const rotateSession = () => {
    const fresh = crypto.randomUUID ? crypto.randomUUID() : `gid-${Date.now()}`;
    localStorage.setItem("haanji_gid", fresh);
    document.cookie = `haanji_gid=${encodeURIComponent(fresh)}; path=/; max-age=31536000; SameSite=Lax`;
    setGid(fresh);
    setRsvp(null);
  };

  const openGuestWithHousehold = (code: string) => {
    setHouseholdCode(code);
    setActiveView("landing");
    const url = new URL(window.location.href);
    url.pathname = "/";
    url.searchParams.set("h", code);
    window.history.replaceState({}, "", url.toString());
    window.setTimeout(() => {
      document.getElementById("ask")?.scrollIntoView({ behavior: "smooth" });
    }, 80);
  };

  const playHeroSampleReply = () => {
    if (!fullHeroReply || !caps?.live_ai) return;
    if (heroAudioPlaying) {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      if (heroAudioRef.current) {
        heroAudioRef.current.pause();
        heroAudioRef.current.currentTime = 0;
      }
      setHeroAudioPlaying(false);
      return;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(fullHeroReply);
      u.lang = "en-IN";
      u.rate = elderMode ? 0.85 : 1.0;
      u.onstart = () => setHeroAudioPlaying(true);
      u.onend = () => setHeroAudioPlaying(false);
      u.onerror = () => setHeroAudioPlaying(false);
      setHeroAudioPlaying(true);
      window.speechSynthesis.speak(u);
    }
  };

  const langKey = languageHint === "auto" ? "hinglish" : languageHint.split("-")[0];
  const topAnnouncement = announcements[0];
  const showAnnouncement = Boolean(topAnnouncement && topAnnouncement.id !== dismissedAnnId);

  const playAnnouncement = () => {
    if (!topAnnouncement) return;
    if (topAnnouncement.audio_base64 && annAudioRef.current) {
      annAudioRef.current.src = `data:${topAnnouncement.audio_mime || "audio/wav"};base64,${topAnnouncement.audio_base64}`;
      annAudioRef.current.playbackRate = elderMode ? 0.85 : 0.96;
      void annAudioRef.current.play().catch(() => {});
      return;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const text = topAnnouncement.translations?.[langKey] || topAnnouncement.english;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = bcpForAnnouncement(langKey);
      u.rate = elderMode ? 0.82 : 0.96;
      window.speechSynthesis.speak(u);
    }
  };

  const handleSaveManualRsvp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rsvpSaving || rsvpClosed) return;
    setRsvpSaving(true);
    setRsvpSaveNote(null);
    try {
      const res = await fetch(`/api/rsvp/${encodeURIComponent(gid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          householdCode: household?.code || householdCode || undefined,
          attending: rsvpForm.attending,
          headcount: rsvpForm.attending ? Number(rsvpForm.headcount) : 0,
          functions: rsvpForm.attending ? rsvpForm.functions : [],
          diet: {
            veg: Number(rsvpForm.veg),
            jain: Number(rsvpForm.jain),
            nonveg: Number(rsvpForm.nonveg),
            no_onion_garlic: 0,
          },
          needs_room: rsvpForm.needs_room,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update RSVP");
      setRsvp(data.rsvp);
      syncRsvpForm(data.rsvp);
      setRsvpEditOpen(false);
      setRsvpSaveNote("RSVP confirmed and synced to the caterer count.");
      if (isDemoMode) {
        setDemoDone((prev) => ({ ...prev, rsvp_confirmed: true }));
      }
    } catch {
      setRsvpSaveNote("Could not save RSVP right now. Please try again.");
    } finally {
      setRsvpSaving(false);
    }
  };

  const handleConfirmPendingRsvp = async () => {
    if (rsvpSaving || rsvpClosed) return;
    setRsvpSaving(true);
    setRsvpSaveNote(null);
    try {
      const res = await fetch(`/api/rsvp/${encodeURIComponent(gid)}/confirm`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setRsvp(data.rsvp);
        syncRsvpForm(data.rsvp);
        setRsvpSaveNote("RSVP confirmed and synced to the caterer count.");
        if (isDemoMode) {
          setDemoDone((prev) => ({ ...prev, rsvp_confirmed: true }));
        }
      }
    } finally {
      setRsvpSaving(false);
    }
  };

  const handleGuestSignal = useCallback((evt: GuestDemoEvent) => {
    setDemoDone((prev) => ({ ...prev, [evt]: true }));
  }, []);

  const handleOpsSignal = useCallback((evt: "ops_rush_done" | "ops_flags_checked") => {
    setDemoDone((prev) => ({ ...prev, [evt]: true }));
  }, []);

  const handleSelectDemoStep = (step: DemoStepId) => {
    const nonce = Date.now();
    if (step === "hinglish") {
      switchWorkspaceView("landing");
      window.setTimeout(() => scrollToSection("ask"), 60);
      setGuestDemoCmd({
        action: "ask",
        text: "Sangeet kitne baje start hoga aur kahan hai?",
        lang: "hinglish",
        nonce,
      });
    } else if (step === "kannada") {
      switchWorkspaceView("landing");
      window.setTimeout(() => scrollToSection("ask"), 60);
      setGuestDemoCmd({
        action: "focus_mic",
        text: "ಮುಹೂರ್ತ ಮತ್ತು ಮದುವೆ ಎಷ್ಟು ಗಂಟೆಗೆ ಮತ್ತು ಎಲ್ಲಿ ನಡೆಯುತ್ತದೆ?",
        lang: "kn-IN",
        nonce,
      });
    } else if (step === "tamil") {
      switchWorkspaceView("landing");
      window.setTimeout(() => scrollToSection("ask"), 60);
      setGuestDemoCmd({
        action: "ask",
        text: "முகூர்த்தம் எத்தனை மணிக்கு எங்கே நடைபெறும்?",
        lang: "ta-IN",
        nonce,
      });
    } else if (step === "rsvp_confirmed") {
      switchWorkspaceView("landing");
      window.setTimeout(() => scrollToSection("ask"), 60);
      setGuestDemoCmd({
        action: "ask",
        text: "Hum 4 log aayenge, 2 Jain, sirf shaadi.",
        lang: "hinglish",
        nonce,
      });
    } else if (step === "elder_mode") {
      switchWorkspaceView("landing");
      window.setTimeout(() => scrollToSection("ask"), 60);
      setGuestDemoCmd({ action: "elder", nonce });
    } else if (step === "ops_rush_done") {
      switchWorkspaceView("ops");
      setOpsDemoFocus({ section: "rush", nonce });
    } else if (step === "ops_flags_checked") {
      switchWorkspaceView("ops");
      setOpsDemoFocus({ section: "flags", nonce });
    }
  };

  const handleResetDemo = async () => {
    await fetch("/api/demo/reset", { method: "POST" });
    localStorage.removeItem("haanji_elder_mode");
    localStorage.removeItem("haanji_dismissed_ann");
    setElderMode(false);
    setDismissedAnnId(null);
    setDemoDone(INITIAL_DEMO_DONE);
    setActiveView("landing");
    void fetchCardAndState();
  };

  // Deduplicate unique venues from /api/card
  const uniqueVenues = useMemo(() => {
    if (!card?.functions) return [];
    const seen = new Map<string, { venue: string; maps_url?: string; functions: string[] }>();
    for (const fn of card.functions) {
      const parts = fn.venue.split(",");
      const mainVenue = parts.length > 1 ? parts[parts.length - 1].trim() : fn.venue;
      const existing = seen.get(mainVenue);
      if (existing) {
        existing.functions.push(fn.name);
        if (!existing.maps_url && fn.maps_url) existing.maps_url = fn.maps_url;
      } else {
        seen.set(mainVenue, {
          venue: mainVenue,
          maps_url: fn.maps_url,
          functions: [fn.name],
        });
      }
    }
    return Array.from(seen.values());
  }, [card]);

  const btnMinH = elderMode ? "min-h-[56px]" : "min-h-[44px]";
  const cityShort = card?.wedding?.city ? card.wedding.city.split(",")[0].trim() : "";

  const leftNavLinks = [
    { id: "home", label: "Home" },
    { id: "schedule", label: "Schedule" },
    { id: "rsvp", label: "RSVP" },
    { id: "ask", label: "Ask HaanJi" },
  ];
  const rightNavLinks = [
    { id: "venues", label: "Venues" },
    { id: "faqs", label: "FAQs" },
    { id: "contacts", label: "Contacts" },
    { id: "host", label: "Host Desk", isView: true as const },
  ];

  return (
    <div
      className={`min-h-screen flex flex-col text-[#F5EDE1] ${
        elderMode ? "elder-root" : ""
      }`}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:rounded-full focus:bg-[#F5EDE1] focus:text-[#14050A] focus:text-xs focus:font-semibold"
      >
        Skip to content
      </a>

      {/* SINGLE STICKY NAVIGATION BAR (shared across every screen) */}
      <header
        className={`sticky top-0 z-40 transition-colors duration-300 ${
          scrolled || activeView !== "landing"
            ? "bg-[#14050A]/75 backdrop-blur-md border-b border-[#B8925A]/25"
            : "bg-transparent border-b border-transparent"
        }`}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10 py-3 flex items-center justify-between gap-4">
          {/* Left: Wordmark + hairline + 2-column uppercase nav */}
          <div className="flex items-center gap-5 min-w-0">
            <a
              href="#home"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection("home");
              }}
              className="font-display text-2xl sm:text-3xl font-light tracking-wide text-[#F5EDE1] hover:text-[#E6CFA3] transition-colors shrink-0"
            >
              HaanJi
            </a>

            <span
              aria-hidden="true"
              className="hidden xl:block h-px w-8 bg-[#B8925A]/40 shrink-0"
            />

            {/* Desktop 2-column uppercase links */}
            <nav
              aria-label="Primary navigation"
              className="hidden lg:grid grid-cols-4 gap-x-5 gap-y-1.5 text-[11px] uppercase tracking-[0.2em]"
            >
              {leftNavLinks.map((item) => {
                const isActive = activeView === "landing" && activeSection === item.id;
                return (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      scrollToSection(item.id, item.id === "ask");
                    }}
                    className={`py-0.5 whitespace-nowrap transition-colors ${
                      isActive ? "text-[#E6CFA3]" : "text-[#F5EDE1]/75 hover:text-[#F5EDE1]"
                    }`}
                  >
                    {item.label}
                  </a>
                );
              })}
              {rightNavLinks.map((item) => {
                const isActive = item.isView
                  ? activeView === "host"
                  : activeView === "landing" && activeSection === item.id;
                return item.isView ? (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => switchWorkspaceView("host")}
                    className={`text-left py-0.5 uppercase tracking-[0.2em] whitespace-nowrap transition-colors ${
                      isActive ? "text-[#E6CFA3]" : "text-[#F5EDE1]/75 hover:text-[#F5EDE1]"
                    }`}
                  >
                    {item.label}
                  </button>
                ) : (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      scrollToSection(item.id);
                    }}
                    className={`py-0.5 whitespace-nowrap transition-colors ${
                      isActive ? "text-[#E6CFA3]" : "text-[#F5EDE1]/75 hover:text-[#F5EDE1]"
                    }`}
                  >
                    {item.label}
                  </a>
                );
              })}
            </nav>
          </div>

          {/* Right side controls: Language switch -> Elder Mode -> RSVP -> Team -> Offline pill */}
          <div className="hidden lg:flex items-center gap-2.5 shrink-0">
            <select
              aria-label="Language switch"
              value={languageHint}
              onChange={(e) => setLanguageHint(e.target.value)}
              className="min-h-[38px] rounded-full border border-[#B8925A]/45 bg-[#14050A]/75 px-3 text-[11px] uppercase tracking-[0.16em] text-[#E6CFA3] hover:border-[#E6CFA3]"
            >
              <option value="auto">Auto</option>
              <option value="hi-IN">हिन्दी</option>
              <option value="hinglish">Hinglish</option>
              <option value="en-IN">English</option>
              <option value="kn-IN">ಕನ್ನಡ</option>
              <option value="ta-IN">தமிழ்</option>
            </select>

            <button
              type="button"
              onClick={toggleElderMode}
              aria-pressed={elderMode}
              className={`min-h-[38px] px-3.5 rounded-full border text-[11px] uppercase tracking-[0.16em] transition-colors whitespace-nowrap ${
                elderMode
                  ? "border-[#F5EDE1] bg-[#F5EDE1] text-[#14050A] font-semibold"
                  : "border-[#B8925A]/45 text-[#F5EDE1]/85 hover:text-[#F5EDE1] hover:border-[#B8925A]"
              }`}
            >
              Elder Mode{elderMode ? " · ON" : ""}
            </button>

            <button
              type="button"
              onClick={() => scrollToSection("rsvp")}
              className="min-h-[38px] px-4 rounded-full border border-[#B8925A] text-[11px] uppercase tracking-[0.2em] text-[#F5EDE1] hover:bg-[#B8925A]/15 transition-colors whitespace-nowrap"
            >
              RSVP
            </button>

            {/* Team Menu */}
            <div ref={teamMenuRef} className="relative">
              <button
                type="button"
                aria-expanded={teamMenuOpen}
                aria-haspopup="menu"
                onClick={() => setTeamMenuOpen((v) => !v)}
                className={`min-h-[38px] px-3.5 rounded-full border text-[11px] uppercase tracking-[0.18em] inline-flex items-center gap-1.5 transition-colors ${
                  activeView === "ops" || activeView === "tests" || activeView === "judge"
                    ? "border-[#E6CFA3] text-[#E6CFA3]"
                    : "border-[#B8925A]/30 text-[#F5EDE1]/75 hover:text-[#F5EDE1]"
                }`}
              >
                <span>Team</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>

              {teamMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-48 rounded-2xl border border-[#B8925A]/30 bg-[#14050A]/95 backdrop-blur-md p-1.5 space-y-1 z-50"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => switchWorkspaceView("ops")}
                    className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs uppercase tracking-[0.15em] ${
                      activeView === "ops"
                        ? "bg-[#B8925A]/20 text-[#E6CFA3]"
                        : "text-[#F5EDE1]/85 hover:bg-[#B8925A]/10"
                    }`}
                  >
                    Ops Control
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => switchWorkspaceView("tests")}
                    className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs uppercase tracking-[0.15em] ${
                      activeView === "tests"
                        ? "bg-[#B8925A]/20 text-[#E6CFA3]"
                        : "text-[#F5EDE1]/85 hover:bg-[#B8925A]/10"
                    }`}
                  >
                    Test Bench
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => switchWorkspaceView("judge")}
                    className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs uppercase tracking-[0.15em] ${
                      activeView === "judge"
                        ? "bg-[#B8925A]/20 text-[#E6CFA3]"
                        : "text-[#F5EDE1]/85 hover:bg-[#B8925A]/10"
                    }`}
                  >
                    Judge Mode
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setTeamMenuOpen(false);
                      setCardDrawerOpen(true);
                    }}
                    className="w-full text-left px-3.5 py-2.5 rounded-xl text-xs uppercase tracking-[0.15em] text-[#F5EDE1]/75 hover:bg-[#B8925A]/10 border-t hairline-gold"
                  >
                    Wedding Card
                  </button>
                </div>
              )}
            </div>

            {!isOnline && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[#B8925A]/40 bg-[#14050A]/80 text-[11px] uppercase tracking-[0.14em] text-[#E6CFA3]">
                <WifiOff className="w-3 h-3" />
                <span>Offline · answers from saved card</span>
              </span>
            )}
          </div>

          {/* Mobile collapsed bar: Wordmark + Ask HaanJi icon + Menu button */}
          <div className="flex lg:hidden items-center gap-2">
            {!isOnline && (
              <span
                aria-label="Offline mode active"
                className="px-2.5 py-1 rounded-full border border-[#B8925A]/40 text-[10px] uppercase tracking-[0.14em] text-[#E6CFA3]"
              >
                Offline
              </span>
            )}
            <button
              type="button"
              onClick={() => scrollToSection("ask", true)}
              aria-label="Ask HaanJi"
              className="min-h-[44px] min-w-[44px] rounded-full border border-[#B8925A]/50 bg-[#14050A]/60 flex items-center justify-center text-[#E6CFA3]"
            >
              <Mic className="w-4 h-4" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="min-h-[44px] min-w-[44px] rounded-full border border-[#B8925A]/50 bg-[#14050A]/60 flex items-center justify-center text-[#F5EDE1]"
            >
              <Menu className="w-5 h-5" strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {/* ANNOUNCEMENT STRIP (directly beneath nav, if a family announcement exists) */}
        {showAnnouncement && topAnnouncement && (
          <div className="bg-[#14050A]/85 border-y border-[#B8925A]/25 px-4 sm:px-6 lg:px-10 py-2">
            <div className="mx-auto max-w-7xl flex flex-wrap items-center justify-between gap-3 text-xs text-[#F5EDE1]">
              <p className="flex-1 min-w-[200px] indic-relaxed text-[#F5EDE1]/90">
                <span className="text-[10px] uppercase tracking-[0.2em] text-[#E6CFA3] mr-2.5">
                  Family Update
                </span>
                {topAnnouncement.translations?.[langKey] || topAnnouncement.english}
              </p>
              <div className="flex items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={playAnnouncement}
                  className="px-3 py-1 rounded-full border border-[#B8925A]/45 text-[11px] uppercase tracking-[0.14em] text-[#E6CFA3] hover:bg-[#B8925A]/15 inline-flex items-center gap-1.5"
                >
                  <Play className="w-3 h-3" />
                  <span>Listen</span>
                </button>
                <button
                  type="button"
                  aria-label="Dismiss announcement"
                  onClick={() => {
                    setDismissedAnnId(topAnnouncement.id);
                    localStorage.setItem("haanji_dismissed_ann", topAnnouncement.id);
                  }}
                  className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-full text-[#F5EDE1]/70 hover:text-[#F5EDE1]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <audio ref={annAudioRef} className="hidden" />
          </div>
        )}
      </header>

      {/* Mobile Full-Screen Overlay Menu */}
      {mobileMenuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Mobile navigation menu"
          className="fixed inset-0 z-50 bg-[#14050A]/98 backdrop-blur-md p-6 flex flex-col justify-between overflow-y-auto"
        >
          <div className="flex items-center justify-between pb-4 border-b hairline-gold">
            <span className="font-display text-3xl font-light text-[#F5EDE1]">HaanJi</span>
            <button
              type="button"
              aria-label="Close navigation menu"
              onClick={() => setMobileMenuOpen(false)}
              className="min-h-[44px] min-w-[44px] rounded-full border border-[#B8925A]/45 flex items-center justify-center text-[#F5EDE1]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="my-6 space-y-6">
            <div className="grid grid-cols-2 gap-4">
              {[...leftNavLinks, ...rightNavLinks].map((item) =>
                "isView" in item && item.isView ? (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => switchWorkspaceView("host")}
                    className="text-left py-2.5 text-sm uppercase tracking-[0.2em] text-[#E6CFA3]"
                  >
                    {item.label}
                  </button>
                ) : (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      scrollToSection(item.id, item.id === "ask");
                    }}
                    className="py-2.5 text-sm uppercase tracking-[0.2em] text-[#F5EDE1]"
                  >
                    {item.label}
                  </a>
                )
              )}
            </div>

            <div className="pt-5 border-t hairline-gold space-y-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3] mb-2">
                  Language
                </p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { val: "auto", label: "Auto" },
                    { val: "hi-IN", label: "हिन्दी" },
                    { val: "hinglish", label: "Hinglish" },
                    { val: "en-IN", label: "English" },
                    { val: "kn-IN", label: "ಕನ್ನಡ" },
                    { val: "ta-IN", label: "தமிழ்" },
                  ].map((opt) => (
                    <button
                      key={opt.val}
                      type="button"
                      onClick={() => setLanguageHint(opt.val)}
                      className={`min-h-[44px] px-3.5 rounded-full border text-xs ${
                        languageHint === opt.val
                          ? "border-[#F5EDE1] bg-[#F5EDE1] text-[#14050A] font-semibold"
                          : "border-[#B8925A]/45 text-[#F5EDE1]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-xs uppercase tracking-[0.18em] text-[#F5EDE1]/85">
                  Elder Mode
                </span>
                <button
                  type="button"
                  onClick={toggleElderMode}
                  aria-pressed={elderMode}
                  className={`min-h-[44px] px-4 rounded-full border text-xs uppercase tracking-[0.16em] ${
                    elderMode
                      ? "border-[#F5EDE1] bg-[#F5EDE1] text-[#14050A] font-semibold"
                      : "border-[#B8925A]/45 text-[#E6CFA3]"
                  }`}
                >
                  {elderMode ? "ON" : "OFF"}
                </button>
              </div>
            </div>

            <div className="pt-5 border-t hairline-gold space-y-2">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3] mb-2">Team</p>
              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => switchWorkspaceView("ops")}
                  className="min-h-[44px] px-4 rounded-full border border-[#B8925A]/45 text-xs uppercase tracking-[0.16em] text-[#F5EDE1]"
                >
                  Ops Control
                </button>
                <button
                  type="button"
                  onClick={() => switchWorkspaceView("tests")}
                  className="min-h-[44px] px-4 rounded-full border border-[#B8925A]/45 text-xs uppercase tracking-[0.16em] text-[#F5EDE1]"
                >
                  Test Bench
                </button>
                <button
                  type="button"
                  onClick={() => switchWorkspaceView("judge")}
                  className="min-h-[44px] px-4 rounded-full border border-[#B8925A]/45 text-xs uppercase tracking-[0.16em] text-[#F5EDE1]"
                >
                  Judge Mode
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              setCardDrawerOpen(true);
            }}
            className="min-h-[44px] w-full rounded-full border border-[#B8925A] text-xs uppercase tracking-[0.2em] text-[#E6CFA3]"
          >
            View Official Wedding Card
          </button>
        </div>
      )}

      {/* MAIN CONTENT */}
      <main id="main-content" className="flex-1 flex flex-col">
        {activeView === "host" && <HostDashboard onOpenHousehold={openGuestWithHousehold} />}
        {activeView === "ops" && (
          <OpsControlPlane
            onDemoSignal={isDemoMode ? handleOpsSignal : undefined}
            demoFocus={isDemoMode ? opsDemoFocus : null}
          />
        )}
        {activeView === "judge" && <JudgeMode onOpenGuestLink={openGuestWithHousehold} />}
        {activeView === "tests" && <TestWorkbench />}

        {activeView === "landing" && (
          <>
            {/* HERO (Full viewport height on desktop, mobile static hero-mobile + urli rim arc) */}
            <section
              id="home"
              onMouseMove={(e) => {
                if (prefersReducedMotion || window.innerWidth < 768) return;
                const nx = (e.clientX / window.innerWidth - 0.5) * 12;
                const ny = (e.clientY / window.innerHeight - 0.5) * 12;
                setParallaxOffset({ x: nx, y: ny });
              }}
              className="relative min-h-[calc(100vh-76px)] flex items-center overflow-hidden border-b hairline-gold"
            >
              {/* Desktop Hero Video Loop (only >=768px and motion allowed) */}
              {!prefersReducedMotion && (
                <video
                  autoPlay
                  muted
                  loop
                  playsInline
                  poster="/assets/landing/hero-bg.webp"
                  aria-hidden="true"
                  className="hidden md:block pointer-events-none absolute inset-0 w-full h-full object-cover opacity-55"
                >
                  <source src="/assets/landing/hero-loop.mp4" type="video/mp4" />
                </video>
              )}

              {/* Desktop Static Fallback when prefers-reduced-motion is enabled */}
              {prefersReducedMotion && (
                <picture className="hidden md:block pointer-events-none absolute inset-0 w-full h-full">
                  <source srcSet="/assets/landing/hero-bg.webp" type="image/webp" />
                  <img
                    src="/assets/landing/hero-bg.jpg"
                    alt=""
                    aria-hidden="true"
                    className="w-full h-full object-cover opacity-55"
                  />
                </picture>
              )}

              {/* Mobile Hero Background (<768px, NO video, <1.5 MB weight) */}
              <picture className="md:hidden pointer-events-none absolute inset-0 w-full h-full">
                <source srcSet="/assets/landing/hero-mobile.webp" type="image/webp" />
                <img
                  src="/assets/landing/hero-mobile.jpg"
                  alt=""
                  aria-hidden="true"
                  fetchPriority="high"
                  className="w-full h-full object-cover opacity-55"
                />
              </picture>

              {/* Mobile Urli Rim Arc behind hero buttons (<768px) */}
              <picture className="md:hidden pointer-events-none absolute bottom-[-60px] left-1/2 -translate-x-1/2 w-[140%] max-w-none mix-blend-screen opacity-75 animate-urli-rise">
                <source srcSet="/assets/landing/urli.webp" type="image/webp" />
                <img
                  src="/assets/landing/urli.png"
                  alt=""
                  aria-hidden="true"
                  className="w-full h-auto"
                />
              </picture>

              {/* Subtle Jaali + Petals accent layer on reduced-motion or gentle desktop depth */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 hidden md:block"
                style={{
                  transform: `translate3d(${parallaxOffset.x * 0.4}px, ${parallaxOffset.y * 0.4}px, 0)`,
                }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-[#14050A]/90 via-[#14050A]/55 to-[#14050A]/70" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#14050A] via-transparent to-[#14050A]/65" />
              </div>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 md:hidden bg-gradient-to-b from-[#14050A]/80 via-[#14050A]/55 to-[#14050A]"
              />

              {/* Subtle Film-Grain Overlay (4% opacity) */}
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 film-grain-overlay" />

              {/* Hero Foreground Content */}
              <div className="relative z-10 mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-10 py-14 lg:py-20">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
                  {/* Left Column (~45% width = 5/12 or 6/12) */}
                  <div className="lg:col-span-6 space-y-6">
                    <div className="inline-flex items-center px-3.5 py-1.5 rounded-full border border-[#B8925A]/55 bg-[#14050A]/50 text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">
                      हिंदी · Hinglish · ಕನ್ನಡ · தமிழ் · English
                    </div>

                    <h1 className="font-display font-light text-[44px] sm:text-[58px] lg:text-[72px] leading-[1.03] tracking-tight text-[#F5EDE1]">
                      <span className="block animate-hero-line-1">
                        Every question, answered in
                      </span>
                      <span className="block animate-hero-line-2">
                        <em className="italic font-light text-[#B8925A]">your language</em>
                      </span>
                    </h1>

                    <p className="text-base sm:text-lg text-[#F5EDE1]/80 leading-relaxed max-w-xl indic-relaxed">
                      {card ? (
                        <>
                          {card.wedding.title} · {card.wedding.dates}
                          {cityShort ? ` · ${cityShort}` : ""}.{" "}
                        </>
                      ) : null}
                      Simply speak, and HaanJi answers timings, venues, dress codes and food, and keeps your RSVP up to date.
                    </p>

                    <div className="relative z-10 flex flex-wrap items-center gap-4 pt-2">
                      <button
                        type="button"
                        onClick={() => scrollToSection("ask", true)}
                        className={`${btnMinH} px-7 rounded-full bg-[#F5EDE1] text-[#14050A] text-xs font-semibold uppercase tracking-[0.18em] hover:bg-[#E6CFA3] transition-colors inline-flex items-center gap-2.5`}
                      >
                        <Mic className="w-4 h-4" strokeWidth={1.5} />
                        <span>Ask HaanJi</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => scrollToSection("schedule")}
                        className={`${btnMinH} px-7 rounded-full border border-[#B8925A] text-[#F5EDE1] text-xs uppercase tracking-[0.18em] hover:bg-[#B8925A]/15 transition-colors`}
                      >
                        View schedule
                      </button>
                    </div>
                  </div>

                  {/* Right Column: Dark Glass Preview Card (built from /api/card sangeet) */}
                  <div className="lg:col-span-6">
                    <div className="glass-card p-6 sm:p-8 space-y-6 animate-hero-card">
                      {/* Top voice question pill */}
                      <div className="flex items-center gap-3 rounded-full border border-[#B8925A]/30 bg-[#14050A]/65 px-4 py-2.5">
                        <AudioLines
                          className="w-4 h-4 text-[#E6CFA3] shrink-0"
                          strokeWidth={1.5}
                        />
                        <span className="text-sm text-[#F5EDE1]/90">
                          &ldquo;Sangeet kab hai aur dress code kya hai?&rdquo;
                        </span>
                      </div>

                      {/* Typed-in Card-Grounded Reply */}
                      <div className="min-h-[112px] flex items-center">
                        {sangeetFn ? (
                          <p className="font-display font-light text-2xl sm:text-3xl leading-[1.35] text-[#F5EDE1]">
                            {typedHeroReply || fullHeroReply}
                          </p>
                        ) : (
                          <p className="font-display font-light text-2xl text-[#F5EDE1]/70">
                            Reading the wedding invitation card...
                          </p>
                        )}
                      </div>

                      {/* Bottom row */}
                      <div className="pt-4 border-t hairline-gold flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <span className="px-3 py-1 rounded-full border border-[#B8925A]/35 text-[11px] uppercase tracking-[0.16em] text-[#E6CFA3]">
                            Hinglish &rarr; English
                          </span>

                          {caps?.live_ai && sangeetFn && (
                            <button
                              type="button"
                              onClick={playHeroSampleReply}
                              className="min-h-[36px] px-3.5 rounded-full border border-[#B8925A]/55 text-[11px] uppercase tracking-[0.16em] text-[#F5EDE1] hover:bg-[#B8925A]/15 inline-flex items-center gap-1.5"
                            >
                              <Play className="w-3 h-3 text-[#E6CFA3]" />
                              <span>{heroAudioPlaying ? "Stop reply" : "Play reply"}</span>
                            </button>
                          )}
                        </div>

                        <span className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]/80">
                          Grounded in the wedding card
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <audio ref={heroAudioRef} className="hidden" />
            </section>

            {/* 1. #schedule: CELEBRATION SCHEDULE */}
            <section
              id="schedule"
              className="py-20 lg:py-40 px-4 sm:px-6 lg:px-10 border-b hairline-gold"
            >
              <div className="mx-auto max-w-7xl space-y-12">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">
                      01 · Celebration Schedule
                    </p>
                    <h2 className="mt-2 font-display font-light text-4xl sm:text-5xl text-[#F5EDE1]">
                      Four moments together
                    </h2>
                  </div>
                  <p className="text-sm text-[#F5EDE1]/70 max-w-md">
                    Every function timing, venue, dress code, and calendar link synced directly from the wedding card.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                  {(card?.functions || []).map((fn) => {
                    const localFnName =
                      languageHint.startsWith("kn")
                        ? fn.name_kn
                        : languageHint.startsWith("ta")
                          ? fn.name_ta
                          : languageHint.startsWith("hi")
                            ? fn.name_hi
                            : undefined;
                    return (
                      <article
                        key={fn.id}
                        className="glass-card p-6 flex flex-col justify-between space-y-6"
                      >
                        <div className="space-y-3">
                          <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">
                            <span>{fn.date}</span>
                            <span className="font-mono">{fn.time}</span>
                          </div>

                          <div>
                            <h3 className="font-display font-light text-2xl sm:text-3xl text-[#F5EDE1]">
                              {fn.name}
                            </h3>
                            {localFnName && (
                              <p className="mt-1 text-xs text-[#E6CFA3]/85 indic-relaxed">
                                {localFnName}
                              </p>
                            )}
                          </div>

                          <p className="text-sm text-[#F5EDE1]/80 leading-relaxed">{fn.venue}</p>

                          <p className="text-xs text-[#F5EDE1]/65 leading-relaxed">
                            <span className="text-[#E6CFA3] uppercase tracking-[0.14em] text-[10px] block mb-0.5">
                              Dress code
                            </span>
                            {fn.dress_code}
                          </p>
                        </div>

                        <div className="pt-4 border-t hairline-gold flex items-center justify-between gap-3">
                          {fn.maps_url ? (
                            <a
                              href={fn.maps_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.16em] text-[#E6CFA3] hover:underline"
                            >
                              <MapPin className="w-3.5 h-3.5" strokeWidth={1.5} />
                              <span>Directions</span>
                            </a>
                          ) : (
                            <span />
                          )}

                          <button
                            type="button"
                            onClick={() => downloadFunctionIcs(fn)}
                            className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.16em] text-[#F5EDE1]/80 hover:text-[#E6CFA3]"
                          >
                            <CalendarPlus className="w-3.5 h-3.5" strokeWidth={1.5} />
                            <span>Add to calendar</span>
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* 2. #ask: ASK HAANJI (INLINE GUEST CONCIERGE) */}
            <section
              id="ask"
              className="py-20 lg:py-40 px-4 sm:px-6 lg:px-10 border-b hairline-gold"
            >
              <div className="mx-auto max-w-5xl space-y-8">
                <div className="text-center space-y-2">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">
                    02 · Ask HaanJi
                  </p>
                  <h2 className="font-display font-light text-4xl sm:text-5xl text-[#F5EDE1]">
                    Voice &amp; text concierge
                  </h2>
                </div>

                <GuestConcierge
                  gid={gid}
                  householdCode={householdCode}
                  household={household}
                  card={card}
                  level={level}
                  voicePausedFlag={voicePausedFlag}
                  caps={caps}
                  rsvp={rsvp}
                  languageHint={languageHint}
                  elderMode={elderMode}
                  onLanguageHintChange={setLanguageHint}
                  onToggleElderMode={toggleElderMode}
                  onRsvpChange={(next) => {
                    setRsvp(next);
                    syncRsvpForm(next);
                  }}
                  onRotateGid={rotateSession}
                  onRefreshState={() => {
                    void fetchCardAndState();
                    void fetchCapabilities();
                  }}
                  onOpenRsvpEdit={() => {
                    setRsvpEditOpen(true);
                    scrollToSection("rsvp");
                  }}
                  onDemoSignal={isDemoMode ? handleGuestSignal : undefined}
                  demoCommand={isDemoMode ? guestDemoCmd : null}
                  externalQuestion={externalQuestion}
                  focusNonce={focusAskNonce}
                />
              </div>
            </section>

            {/* 3. #rsvp: RSVP STATUS & CONFIRMATION */}
            <section
              id="rsvp"
              className="py-20 lg:py-40 px-4 sm:px-6 lg:px-10 border-b hairline-gold"
            >
              <div className="mx-auto max-w-4xl space-y-8">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">
                      03 · Your RSVP
                    </p>
                    <h2 className="mt-2 font-display font-light text-4xl sm:text-5xl text-[#F5EDE1]">
                      Attendance &amp; dietary notes
                    </h2>
                  </div>

                  {rsvpCutoff && (
                    <span className="px-3.5 py-1.5 rounded-full border border-[#B8925A]/45 text-[11px] uppercase tracking-[0.18em] text-[#E6CFA3]">
                      {rsvpClosed ? "RSVP closed, please contact the family" : `RSVPs close ${rsvpCutoff}`}
                    </span>
                  )}
                </div>

                <div className="glass-card p-6 sm:p-10 space-y-6">
                  <div className="flex flex-wrap items-start justify-between gap-6">
                    <div className="space-y-2">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">
                        RSVP on record
                      </p>

                      {rsvp ? (
                        <p className="font-display font-light text-2xl sm:text-3xl text-[#F5EDE1]">
                          {rsvp.attending === false
                            ? "Not attending"
                            : `${
                                rsvp.headcount ??
                                (rsvp.headcount_range
                                  ? `${rsvp.headcount_range[0]}-${rsvp.headcount_range[1]} tentative`
                                  : "Pending headcount")
                              } guests · ${
                                rsvp.functions.length
                                  ? rsvp.functions.join(" + ")
                                  : "No functions selected"
                              }`}
                        </p>
                      ) : (
                        <p className="font-display font-light text-2xl text-[#F5EDE1]/75">
                          No RSVP recorded yet. Speak above or edit your count here.
                        </p>
                      )}

                      {rsvp && rsvp.attending !== false && (
                        <div className="flex flex-wrap items-center gap-3 text-xs text-[#F5EDE1]/75 pt-1">
                          <span>Veg: {rsvp.diet?.veg ?? 0}</span>
                          <span>·</span>
                          <span>Jain: {rsvp.diet?.jain ?? 0}</span>
                          {rsvp.needs_room && (
                            <>
                              <span>·</span>
                              <span className="text-[#E6CFA3]">Hotel room requested</span>
                            </>
                          )}
                          <span>·</span>
                          <span className={rsvp.confirmed ? "text-[#8FB39A]" : "text-[#E6CFA3]"}>
                            {rsvp.confirmed ? "Confirmed to caterer" : "Awaiting confirmation"}
                          </span>
                        </div>
                      )}
                    </div>

                    {!rsvpClosed && (
                      <div className="flex flex-wrap items-center gap-3">
                        {rsvp && !rsvp.confirmed && rsvp.headcount && (
                          <button
                            type="button"
                            disabled={rsvpSaving}
                            onClick={handleConfirmPendingRsvp}
                            className={`${btnMinH} px-6 rounded-full bg-[#F5EDE1] text-[#14050A] text-xs font-semibold uppercase tracking-[0.16em] hover:bg-[#E6CFA3] inline-flex items-center gap-2`}
                          >
                            <Check className="w-4 h-4" />
                            <span>Confirm RSVP</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setRsvpEditOpen((v) => !v)}
                          className={`${btnMinH} px-5 rounded-full border border-[#B8925A] text-[#F5EDE1] text-xs uppercase tracking-[0.18em] hover:bg-[#B8925A]/15 inline-flex items-center gap-2`}
                        >
                          <Edit3 className="w-3.5 h-3.5" strokeWidth={1.5} />
                          <span>{rsvpEditOpen ? "Close" : "Edit"}</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {rsvp?.warnings && rsvp.warnings.length > 0 && (
                    <p className="text-xs text-[#C98A8A]">{rsvp.warnings[0]}</p>
                  )}

                  {rsvpSaveNote && (
                    <p className="text-xs text-[#8FB39A] flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{rsvpSaveNote}</span>
                    </p>
                  )}

                  {rsvpEditOpen && !rsvpClosed && (
                    <form
                      onSubmit={handleSaveManualRsvp}
                      className="pt-6 border-t hairline-gold space-y-5"
                    >
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <label className="text-xs text-[#E6CFA3] uppercase tracking-[0.14em]">
                          Attending
                          <select
                            value={rsvpForm.attending ? "yes" : "no"}
                            onChange={(e) =>
                              setRsvpForm({ ...rsvpForm, attending: e.target.value === "yes" })
                            }
                            className="mt-1.5 w-full min-h-[44px] rounded-xl border border-[#B8925A]/35 bg-[#14050A]/80 px-3 text-sm text-[#F5EDE1]"
                          >
                            <option value="yes">Yes</option>
                            <option value="no">Cannot attend</option>
                          </select>
                        </label>

                        <label className="text-xs text-[#E6CFA3] uppercase tracking-[0.14em]">
                          Headcount
                          <input
                            type="number"
                            min={0}
                            max={50}
                            disabled={!rsvpForm.attending}
                            value={rsvpForm.headcount}
                            onChange={(e) =>
                              setRsvpForm({ ...rsvpForm, headcount: Number(e.target.value) })
                            }
                            className="mt-1.5 w-full min-h-[44px] rounded-xl border border-[#B8925A]/35 bg-[#14050A]/80 px-3 text-sm text-[#F5EDE1] tabular-nums"
                          />
                        </label>

                        <label className="text-xs text-[#E6CFA3] uppercase tracking-[0.14em]">
                          Jain Meals
                          <input
                            type="number"
                            min={0}
                            disabled={!rsvpForm.attending}
                            value={rsvpForm.jain}
                            onChange={(e) =>
                              setRsvpForm({ ...rsvpForm, jain: Number(e.target.value) })
                            }
                            className="mt-1.5 w-full min-h-[44px] rounded-xl border border-[#B8925A]/35 bg-[#14050A]/80 px-3 text-sm text-[#F5EDE1] tabular-nums"
                          />
                        </label>

                        <label className="text-xs text-[#E6CFA3] uppercase tracking-[0.14em]">
                          Veg Meals
                          <input
                            type="number"
                            min={0}
                            disabled={!rsvpForm.attending}
                            value={rsvpForm.veg}
                            onChange={(e) =>
                              setRsvpForm({ ...rsvpForm, veg: Number(e.target.value) })
                            }
                            className="mt-1.5 w-full min-h-[44px] rounded-xl border border-[#B8925A]/35 bg-[#14050A]/80 px-3 text-sm text-[#F5EDE1] tabular-nums"
                          />
                        </label>
                      </div>

                      {rsvpForm.attending && (
                        <div className="flex flex-wrap items-center gap-2.5 text-xs">
                          {(["mehendi", "sangeet", "shaadi", "reception"] as const).map((fnId) => {
                            const active = rsvpForm.functions.includes(fnId);
                            return (
                              <button
                                key={fnId}
                                type="button"
                                onClick={() =>
                                  setRsvpForm({
                                    ...rsvpForm,
                                    functions: active
                                      ? rsvpForm.functions.filter((f) => f !== fnId)
                                      : [...rsvpForm.functions, fnId],
                                  })
                                }
                                className={`min-h-[44px] px-4 rounded-full border capitalize ${
                                  active
                                    ? "border-[#F5EDE1] bg-[#F5EDE1] text-[#14050A] font-semibold"
                                    : "border-[#B8925A]/35 text-[#F5EDE1]/80 hover:border-[#B8925A]"
                                }`}
                              >
                                {fnId}
                              </button>
                            );
                          })}
                          <label className="ml-auto inline-flex items-center gap-2 text-[#F5EDE1]/85">
                            <input
                              type="checkbox"
                              checked={rsvpForm.needs_room}
                              onChange={(e) =>
                                setRsvpForm({ ...rsvpForm, needs_room: e.target.checked })
                              }
                            />
                            <span>Needs hotel room</span>
                          </label>
                        </div>
                      )}

                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={rsvpSaving}
                          className={`${btnMinH} px-6 rounded-full bg-[#F5EDE1] text-[#14050A] text-xs font-semibold uppercase tracking-[0.16em] hover:bg-[#E6CFA3] inline-flex items-center gap-2`}
                        >
                          <Check className="w-4 h-4" />
                          <span>{rsvpSaving ? "Saving..." : "Confirm & Save RSVP"}</span>
                        </button>
                      </div>
                    </form>
                  )}

                  <p className="pt-4 border-t hairline-gold text-xs text-[#F5EDE1]/65">
                    Your RSVP reaches the caterer only after you confirm.
                  </p>
                </div>
              </div>
            </section>

            {/* 4. HOW IT WORKS */}
            <section className="py-20 lg:py-40 px-4 sm:px-6 lg:px-10 border-b hairline-gold">
              <div className="mx-auto max-w-7xl space-y-12">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">
                    04 · How it works
                  </p>
                  <h2 className="mt-2 font-display font-light text-4xl sm:text-5xl text-[#F5EDE1]">
                    Quiet certainty for every guest
                  </h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  {[
                    {
                      num: "01",
                      icon: Mic,
                      title: "Speak in your language",
                      desc: "Ask by voice or text in Hindi, Hinglish, Kannada, Tamil, or English with no app download.",
                    },
                    {
                      num: "02",
                      icon: BookOpen,
                      title: "HaanJi answers only from the wedding card",
                      desc: "Every timing, venue, dress code, and menu item is checked strictly against the family's official card.",
                    },
                    {
                      num: "03",
                      icon: CheckCircle2,
                      title: "Confirm your RSVP, and it reaches the caterer only after you say yes",
                      desc: "Guests review headcounts and Jain or veg preferences before a single plate is added to caterer totals.",
                    },
                  ].map((step) => {
                    const Icon = step.icon;
                    return (
                      <div key={step.num} className="glass-card p-7 space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="font-display font-light text-4xl text-[#B8925A]">
                            {step.num}
                          </span>
                          <Icon className="w-5 h-5 text-[#E6CFA3]" strokeWidth={1.25} />
                        </div>
                        <h3 className="font-display font-light text-2xl text-[#F5EDE1]">
                          {step.title}
                        </h3>
                        <p className="text-sm text-[#F5EDE1]/70 leading-relaxed">{step.desc}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* 5. LANGUAGES MARQUEE (5 supported languages only) */}
            <section
              aria-label="Supported languages"
              className="py-12 border-b hairline-gold overflow-hidden bg-[#14050A]/45"
            >
              <div className="flex whitespace-nowrap w-max animate-lang-marquee">
                {[0, 1].map((dup) => (
                  <div
                    key={dup}
                    aria-hidden={dup === 1}
                    className="flex items-center gap-12 px-6 font-display italic font-light text-3xl sm:text-5xl text-[#E6CFA3]/85"
                  >
                    <span>Namaste</span>
                    <span className="text-[#B8925A]/50">·</span>
                    <span>Haan ji</span>
                    <span className="text-[#B8925A]/50">·</span>
                    <span>Namaskara</span>
                    <span className="text-[#B8925A]/50">·</span>
                    <span>Vanakkam</span>
                    <span className="text-[#B8925A]/50">·</span>
                    <span>Hello</span>
                    <span className="text-[#B8925A]/50">·</span>
                  </div>
                ))}
              </div>
            </section>

            {/* 6. #venues: VENUES */}
            <section
              id="venues"
              className="py-20 lg:py-40 px-4 sm:px-6 lg:px-10 border-b hairline-gold"
            >
              <div className="mx-auto max-w-7xl grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
                <div className="lg:col-span-5">
                  <div className="rounded-2xl border border-[#B8925A]/45 overflow-hidden bg-[#14050A]/60 aspect-[3/4] max-h-[540px] w-full">
                    {!venueImageError ? (
                      <picture className="w-full h-full block">
                        <source srcSet="/assets/landing/sharma-reddy-venue.webp" type="image/webp" />
                        <img
                          src="/src/assets/images/sharma_reddy_venue_1795418307752.jpg"
                          alt="Illustrated garden mandap pavilion in Bengaluru"
                          loading="lazy"
                          onError={() => setVenueImageError(true)}
                          className="w-full h-full object-cover"
                        />
                      </picture>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center">
                        <span className="font-display text-2xl font-light text-[#E6CFA3]">
                          {card?.wedding.city || "Bengaluru"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="lg:col-span-7 space-y-8">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">
                      05 · Venues &amp; Travel
                    </p>
                    <h2 className="mt-2 font-display font-light text-4xl sm:text-5xl text-[#F5EDE1]">
                      Where we gather
                    </h2>
                  </div>

                  <div className="space-y-4">
                    {uniqueVenues.map((v) => (
                      <div
                        key={v.venue}
                        className="glass-card p-6 flex flex-wrap items-center justify-between gap-4"
                      >
                        <div>
                          <h3 className="font-display font-light text-2xl text-[#F5EDE1]">
                            {v.venue}
                          </h3>
                          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[#E6CFA3]/80">
                            {v.functions.join(" · ")}
                          </p>
                        </div>
                        {v.maps_url && (
                          <a
                            href={v.maps_url}
                            target="_blank"
                            rel="noreferrer"
                            className={`${btnMinH} px-5 rounded-full border border-[#B8925A] text-xs uppercase tracking-[0.16em] text-[#F5EDE1] hover:bg-[#B8925A]/15 inline-flex items-center gap-2`}
                          >
                            <MapPin className="w-3.5 h-3.5 text-[#E6CFA3]" />
                            <span>Directions</span>
                          </a>
                        )}
                      </div>
                    ))}
                  </div>

                  {card?.logistics && (
                    <div className="glass-card p-6 space-y-2.5 text-sm text-[#F5EDE1]/75">
                      <p>
                        <strong className="text-[#E6CFA3] font-medium">Parking:</strong>{" "}
                        {card.logistics.parking}
                      </p>
                      <p>
                        <strong className="text-[#E6CFA3] font-medium">Shuttles:</strong>{" "}
                        {card.logistics.shuttle}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* 7. #faqs: GROUNDED FAQS */}
            <section
              id="faqs"
              className="py-20 lg:py-40 px-4 sm:px-6 lg:px-10 border-b hairline-gold"
            >
              <div className="mx-auto max-w-4xl space-y-10">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">
                    06 · Frequently Asked
                  </p>
                  <h2 className="mt-2 font-display font-light text-4xl sm:text-5xl text-[#F5EDE1]">
                    From the wedding card
                  </h2>
                </div>

                <div className="divide-y divide-[#B8925A]/25 border-y hairline-gold">
                  {(card?.faqs || []).map((faq, idx) => {
                    const isOpen = openFaqIdx === idx;
                    return (
                      <div key={idx} className="py-5">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => setOpenFaqIdx(isOpen ? null : idx)}
                          className="w-full text-left flex items-center justify-between gap-4 py-1"
                        >
                          <span className="font-display font-light text-2xl text-[#F5EDE1]">
                            {faq.q}
                          </span>
                          {isOpen ? (
                            <ChevronUp className="w-5 h-5 text-[#E6CFA3] shrink-0" />
                          ) : (
                            <ChevronDown className="w-5 h-5 text-[#B8925A] shrink-0" />
                          )}
                        </button>

                        {isOpen && (
                          <div className="mt-3 space-y-4">
                            <p className="text-sm text-[#F5EDE1]/75 leading-relaxed indic-relaxed">
                              {faq.a}
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                setExternalQuestion({
                                  text: faq.q,
                                  autoSubmit: true,
                                  nonce: Date.now(),
                                });
                                scrollToSection("ask", true);
                              }}
                              className="px-4 py-2 rounded-full border border-[#B8925A]/45 text-[11px] uppercase tracking-[0.16em] text-[#E6CFA3] hover:bg-[#B8925A]/15"
                            >
                              Ask HaanJi about this
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* 8. CALM ON THE BUSIEST MINUTE (Shown only if ops endpoints exist) */}
            {opsAvailable && (
              <section className="py-20 lg:py-40 px-4 sm:px-6 lg:px-10 border-b hairline-gold">
                <div className="mx-auto max-w-7xl space-y-10">
                  <div className="flex flex-wrap items-end justify-between gap-6">
                    <div className="max-w-2xl space-y-3">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">
                        07 · Calm on the busiest minute
                      </p>
                      <h2 className="font-display font-light text-4xl sm:text-5xl text-[#F5EDE1]">
                        Protected during the muhurat rush
                      </h2>
                      <p className="text-sm text-[#F5EDE1]/75 leading-relaxed">
                        When hundreds of guests ask at once during the muhurat, HaanJi slows down gracefully, and only after a human approves.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => switchWorkspaceView("ops")}
                      className={`${btnMinH} px-6 rounded-full border border-[#B8925A] text-xs uppercase tracking-[0.18em] text-[#F5EDE1] hover:bg-[#B8925A]/15`}
                    >
                      Open Ops Control
                    </button>
                  </div>

                  {/* 4-step horizontal flow */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                      {
                        icon: Sparkles,
                        name: "Sarvam AI",
                        desc: "Hears and answers guests in five languages",
                      },
                      {
                        icon: Activity,
                        name: "NudgeBee",
                        desc: "Spots the surge and investigates upstream load",
                      },
                      {
                        icon: ShieldCheck,
                        name: "Human approval",
                        desc: "Operator confirms before any capability shifts",
                      },
                      {
                        icon: Flag,
                        name: "Flagsmith",
                        desc: "Switches the degradation level cleanly",
                      },
                    ].map((step) => {
                      const Icon = step.icon;
                      return (
                        <div key={step.name} className="glass-card p-6 space-y-3">
                          <Icon className="w-5 h-5 text-[#E6CFA3]" strokeWidth={1.35} />
                          <h3 className="font-display font-light text-2xl text-[#F5EDE1]">
                            {step.name}
                          </h3>
                          <p className="text-xs text-[#F5EDE1]/70 leading-relaxed">{step.desc}</p>
                        </div>
                      );
                    })}
                  </div>

                  {/* Live status pills from /api/capabilities */}
                  <div className="flex flex-wrap items-center gap-3">
                    {[
                      { label: "Sarvam AI", live: Boolean(caps?.sarvam) },
                      { label: "Flagsmith", live: Boolean(caps?.flagsmith) },
                      { label: "NudgeBee", live: Boolean(caps?.nudgebee) },
                    ].map((svc) => (
                      <span
                        key={svc.label}
                        className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#B8925A]/30 bg-[#14050A]/55 text-[11px] uppercase tracking-[0.18em] text-[#F5EDE1]/85"
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${
                            svc.live ? "bg-[#8FB39A]" : "bg-[#F5EDE1]/40"
                          }`}
                        />
                        <span>
                          {svc.label} · {svc.live ? "Live" : "Off"}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* 9. FOR THE FAMILY: HOST DESK TEASER (Existing features only) */}
            <section className="py-20 lg:py-40 px-4 sm:px-6 lg:px-10 border-b hairline-gold">
              <div className="mx-auto max-w-7xl glass-card p-8 sm:p-12 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
                <div className="space-y-4 max-w-2xl">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">
                    For the family
                  </p>
                  <h2 className="font-display font-light text-4xl sm:text-5xl text-[#F5EDE1]">
                    Everything the hosts need, in one desk
                  </h2>
                  <ul className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 text-sm text-[#F5EDE1]/80">
                    <li className="border-l border-[#B8925A]/45 pl-3.5">
                      Announcements in every language
                    </li>
                    <li className="border-l border-[#B8925A]/45 pl-3.5">
                      Family Inbox for unanswered questions
                    </li>
                    <li className="border-l border-[#B8925A]/45 pl-3.5">
                      Live caterer headcount and diet totals
                    </li>
                  </ul>
                </div>

                <button
                  type="button"
                  onClick={() => switchWorkspaceView("host")}
                  className={`${btnMinH} px-7 rounded-full border border-[#B8925A] text-xs uppercase tracking-[0.18em] text-[#F5EDE1] hover:bg-[#B8925A]/15 shrink-0`}
                >
                  Open Host Desk
                </button>
              </div>
            </section>
          </>
        )}
      </main>

      {/* 10. #contacts: FOOTER */}
      <footer
        id="contacts"
        className="py-16 px-4 sm:px-6 lg:px-10 border-t hairline-gold bg-[#14050A]/70 text-[#F5EDE1]"
      >
        <div className="mx-auto max-w-7xl space-y-10">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {(card?.logistics?.contacts || []).map((c) => (
              <div key={c.role} className="glass-card p-6 space-y-1.5">
                <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">{c.role}</p>
                <p className="font-display font-light text-2xl text-[#F5EDE1]">{c.name}</p>
                <p className="text-xs text-[#F5EDE1]/70">{c.note}</p>
                {c.phone && (
                  <a
                    href={`tel:${c.phone}`}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs text-[#E6CFA3] hover:underline"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>{c.phone}</span>
                  </a>
                )}
              </div>
            ))}

            <div className="glass-card p-6 flex flex-col justify-between space-y-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">
                  Official Reference
                </p>
                <p className="mt-1.5 text-sm text-[#F5EDE1]/75">
                  Browse every function, menu counter, and travel note directly from the wedding card.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCardDrawerOpen(true)}
                className="self-start px-4 py-2 rounded-full border border-[#B8925A]/55 text-xs uppercase tracking-[0.16em] text-[#E6CFA3] hover:bg-[#B8925A]/15"
              >
                Open Wedding Card
              </button>
            </div>
          </div>

          <div className="pt-8 border-t hairline-gold flex flex-wrap items-center justify-between gap-4 text-xs text-[#F5EDE1]/65">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-[#B8925A]" />
                <span>Built with</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    caps?.sarvam ? "bg-[#8FB39A]" : "bg-[#F5EDE1]/40"
                  }`}
                />
                <span>Sarvam AI</span>
              </span>
              <span>·</span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    caps?.flagsmith ? "bg-[#8FB39A]" : "bg-[#F5EDE1]/40"
                  }`}
                />
                <span>Flagsmith</span>
              </span>
              <span>·</span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    caps?.nudgebee ? "bg-[#8FB39A]" : "bg-[#F5EDE1]/40"
                  }`}
                />
                <span>NudgeBee</span>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-5">
              <a
                href="https://github.com/Nagaraj1399/HaanJi"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[#E6CFA3] hover:underline"
              >
                <span>GitHub</span>
                <ExternalLink className="w-3 h-3" />
              </a>
              <span>Fictional demonstration data</span>
            </div>
          </div>
        </div>
      </footer>

      <WeddingCardDrawer
        open={cardDrawerOpen}
        onClose={() => setCardDrawerOpen(false)}
        card={card}
      />

      {isDemoMode && (
        <DemoChecklist
          completed={demoDone}
          onSelectStep={handleSelectDemoStep}
          onResetDemo={handleResetDemo}
        />
      )}
    </div>
  );
}
