import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Copy,
  Download,
  Lock,
  Plus,
  Send,
  Unlock,
  Users,
} from "lucide-react";

interface HouseholdRow {
  code: string;
  family_name: string;
  preferred_language: string;
  age_band: "standard" | "elder";
  invited_functions: string[];
  rsvp_status: "confirmed" | "tentative" | "pending";
  headcount: number | null;
}

interface HostStateResponse {
  caterer: {
    caterer_line: string;
    unconfirmed_line: string;
    by_function: Record<
      string,
      {
        id: string;
        name: string;
        confirmed_headcount: number;
        unconfirmed_min: number;
        unconfirmed_max: number;
        diet: { veg: number; jain: number; nonveg: number; no_onion_garlic: number };
      }
    >;
    needs_room_count: number;
    total_rsvps: number;
    confirmed_parties: number;
    declined_parties: number;
  };
  households: HouseholdRow[];
  unanswered: Array<{
    id: string;
    gid: string;
    question: string;
    language: string;
    reason: string;
    created_at: string;
    resolved: boolean;
    added_answer?: string;
    answered_after_adding: number;
  }>;
  experiment: {
    arms: {
      formal: { exposures: number; completions: number; abandoned: number; conversion_rate_pct: number };
      warm: { exposures: number; completions: number; abandoned: number; conversion_rate_pct: number };
    };
    total_exposures: number;
    honest_reading: string;
    flagsmith_note: string;
  };
  ops_chip: {
    level: number;
    rpm_60s: number;
    sarvam_429_last_60s: number;
    rate429_pct_60s: number;
    alerter_status: string;
  };
  announcements: Array<{
    id: string;
    english: string;
    translations: Record<string, string>;
    created_at: string;
  }>;
}

function buildWhatsAppNudge(h: HouseholdRow): string {
  const link = `${window.location.origin}/?h=${h.code}`;
  if (h.preferred_language === "hi" || h.preferred_language === "hinglish") {
    return `Namaste ${h.family_name}! Sharma & Reddy shaadi ke timings, venue aur RSVP ke liye yahan tap karein: ${link}`;
  }
  if (h.preferred_language === "kn") {
    return `ನಮಸ್ಕಾರ ${h.family_name}! ಶರ್ಮಾ ಮತ್ತು ರೆಡ್ಡಿ ಮದುವೆಯ ವಿವರಗಳು ಮತ್ತು RSVP ಗಾಗಿ ಇಲ್ಲಿ ಕ್ಲಿಕ್ ಮಾಡಿ: ${link}`;
  }
  if (h.preferred_language === "ta") {
    return `வணக்கம் ${h.family_name}! சர்மா & ரெட்டி திருமண விவரங்கள் மற்றும் RSVP-க்கு இங்கே தட்டவும்: ${link}`;
  }
  return `Warm invitation to ${h.family_name}! Ask HaanJi for timings, directions, and confirm your RSVP here: ${link}`;
}

export function HostDashboard({
  onOpenHousehold,
}: {
  onOpenHousehold?: (code: string) => void;
}) {
  const [enteredKey, setEnteredKey] = useState("");
  const [data, setData] = useState<HostStateResponse | null>(null);
  const [locked, setLocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({});
  const [announcementText, setAnnouncementText] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const loadState = useCallback(
    async (explicitKey?: string) => {
      const k = explicitKey ?? enteredKey;
      try {
        const url = k ? `/api/host/state?k=${encodeURIComponent(k)}` : "/api/host/state";
        const res = await fetch(url, { credentials: "include" });
        if (res.status === 403) {
          setLocked(true);
          setData(null);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: HostStateResponse = await res.json();
        setLocked(false);
        setData(json);
      } catch {
        setLocked(true);
      }
    },
    [enteredKey]
  );

  useEffect(() => {
    void loadState();
    const id = window.setInterval(() => {
      void loadState();
    }, 3000);
    return () => window.clearInterval(id);
  }, [loadState]);

  const unlockHostSession = async (payload: { key?: string; previewDemo?: boolean }) => {
    setUnlocking(true);
    setActionMsg(null);
    try {
      const res = await fetch("/api/host/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error || "Invalid Host Key");
      }
      await loadState("");
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setUnlocking(false);
    }
  };

  const handleAddToCard = async (id: string) => {
    const answer = (draftAnswers[id] || "").trim();
    if (!answer) return;
    try {
      const url = enteredKey
        ? `/api/host/add-to-card?k=${encodeURIComponent(enteredKey)}`
        : "/api/host/add-to-card";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id, answer }),
      });
      if (!res.ok) throw new Error("Failed adding FAQ to card");
      setDraftAnswers((prev) => ({ ...prev, [id]: "" }));
      setActionMsg("Added to wedding card. Next guest asking this question will get your answer.");
      await loadState();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!announcementText.trim() || broadcasting) return;
    setBroadcasting(true);
    setActionMsg(null);
    try {
      const url = enteredKey
        ? `/api/host/announcement?k=${encodeURIComponent(enteredKey)}`
        : "/api/host/announcement";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text: announcementText.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Translation broadcast failed");
      setAnnouncementText("");
      setActionMsg("Announcement translated to EN, HI, KN, and TA and sent to guest pages.");
      await loadState();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBroadcasting(false);
    }
  };

  const copyText = async (txt: string, notice: string) => {
    try {
      await navigator.clipboard.writeText(txt);
      setActionMsg(notice);
    } catch {
      setActionMsg("Copied text ready.");
    }
  };

  const buildCatererWhatsAppBlock = () => {
    if (!data) return "";
    const fnLines = Object.values(data.caterer.by_function).map(
      (f) =>
        `- ${f.name}: ${f.confirmed_headcount} confirmed (Veg ${f.diet.veg}, Jain ${f.diet.jain}, No-Onion/Garlic ${f.diet.no_onion_garlic}, Non-Veg ${f.diet.nonveg})`
    );
    return [
      data.caterer.caterer_line,
      data.caterer.unconfirmed_line,
      `Hotel rooms requested: ${data.caterer.needs_room_count}`,
      ...fnLines,
    ].join("\n");
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-[#C9A96E]/40">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#6B1E2E]">
            Host Operations Desk
          </h1>
          <p className="mt-1 text-sm text-[#5C4F46]">
            Deterministic caterer counts, live unanswered FAQ loop, household invites, and experiment tracking. Refreshes every 3 s.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {data?.ops_chip && (
            <div className="px-3.5 py-2 rounded-xl border border-[#C9A96E]/50 bg-white text-xs font-mono tabular-nums text-[#1F1A17]">
              Ops Proxy · L{data.ops_chip.level} · {data.ops_chip.rpm_60s} RPM ·{" "}
              <span
                className={
                  data.ops_chip.sarvam_429_last_60s > 0
                    ? "text-[#6B1E2E] font-semibold"
                    : "text-[#2F6B4F]"
                }
              >
                {data.ops_chip.sarvam_429_last_60s} 429s/60s
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Host Lock Gate (HttpOnly signed cookie auth, zero literal fallback token in client bundle) */}
      {locked && !data && (
        <section className="max-w-lg mx-auto rounded-2xl border border-[#C9A96E]/60 bg-white p-6 sm:p-8 space-y-5">
          <div className="flex items-start gap-3">
            <Lock className="w-5 h-5 text-[#6B1E2E] mt-0.5 shrink-0" />
            <div>
              <h2 className="font-display text-xl font-semibold text-[#1F1A17]">
                Host Desk Locked (403 Protected)
              </h2>
              <p className="mt-1 text-sm text-[#5C4F46]">
                All <code className="font-mono text-xs">/api/host/*</code> routes reject unauthenticated requests with HTTP 403. Unlock via your startup Host Key or start a signed preview session cookie.
              </p>
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void unlockHostSession({ key: enteredKey });
            }}
            className="flex gap-2"
          >
            <input
              type="password"
              value={enteredKey}
              onChange={(e) => setEnteredKey(e.target.value)}
              placeholder="Enter startup HOST_KEY..."
              className="flex-1 min-h-[44px] rounded-xl border border-[#C9A96E]/60 bg-[#FBF7F0] px-3.5 font-mono text-xs text-[#1F1A17]"
            />
            <button
              type="submit"
              disabled={unlocking || !enteredKey.trim()}
              className="min-h-[44px] px-4 rounded-xl bg-[#1F1A17] text-white text-xs font-semibold hover:bg-[#332B27] disabled:opacity-50"
            >
              Unlock Key
            </button>
          </form>

          <div className="pt-4 border-t border-[#C9A96E]/35 flex items-center justify-between gap-4">
            <span className="text-xs text-[#5C4F46]">
              Demo preview environment? Issue an <code className="font-mono">HttpOnly</code> host session cookie:
            </span>
            <button
              type="button"
              disabled={unlocking}
              onClick={() => unlockHostSession({ previewDemo: true })}
              className="min-h-[44px] px-4 rounded-xl bg-[#6B1E2E] text-white text-xs font-semibold hover:bg-[#541724] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Unlock className="w-3.5 h-3.5" />
              <span>Unlock Host Desk</span>
            </button>
          </div>
        </section>
      )}

      {actionMsg && (
        <div className="rounded-xl border border-[#2F6B4F]/40 bg-white px-4 py-3 text-sm text-[#2F6B4F] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{actionMsg}</span>
        </div>
      )}

      {data && (
        <>
          {/* Caterer Summary Banner + CSV & WhatsApp Exports */}
          <section className="rounded-2xl border border-[#C9A96E]/45 bg-white p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-[#5C4F46]">
                  Deterministic Summation (Zero LLM Arithmetic)
                </p>
                <h2 className="mt-1 font-display text-xl sm:text-2xl font-semibold text-[#1F1A17]">
                  {data.caterer.caterer_line}
                </h2>
                <p className="mt-1 text-sm text-[#8A4F09] font-medium">
                  {data.caterer.unconfirmed_line}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-6 text-right font-mono tabular-nums">
                <div>
                  <p className="text-xs font-sans text-[#5C4F46]">Confirmed Parties</p>
                  <p className="text-xl font-semibold text-[#1F1A17]">
                    {data.caterer.confirmed_parties}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-sans text-[#5C4F46]">Needs Room</p>
                  <p className="text-xl font-semibold text-[#1F1A17]">
                    {data.caterer.needs_room_count}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-sans text-[#5C4F46]">Declined</p>
                  <p className="text-xl font-semibold text-[#5C4F46]">
                    {data.caterer.declined_parties}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void copyText(
                      buildCatererWhatsAppBlock(),
                      "Copied WhatsApp-ready caterer summary to clipboard."
                    )
                  }
                  className="min-h-[44px] px-4 rounded-xl bg-[#2F6B4F] text-white font-sans text-xs font-semibold hover:bg-[#24543e] inline-flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy WhatsApp Summary</span>
                </button>
              </div>
            </div>

            {/* Function & Diet Breakdown Table */}
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#C9A96E]/35 text-xs font-medium text-[#5C4F46]">
                    <th className="py-2.5 pr-4">Function</th>
                    <th className="py-2.5 px-4 text-right">Confirmed</th>
                    <th className="py-2.5 px-4 text-right">Unconfirmed Range</th>
                    <th className="py-2.5 px-4 text-right">Veg</th>
                    <th className="py-2.5 px-4 text-right">Jain</th>
                    <th className="py-2.5 px-4 text-right">Non-Veg</th>
                    <th className="py-2.5 px-4 text-right">No Onion/Garlic</th>
                    <th className="py-2.5 pl-4 text-right">Export</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#C9A96E]/25 text-sm">
                  {Object.values(data.caterer.by_function).map((fn) => (
                    <tr key={fn.id} className="hover:bg-[#FBF7F0]">
                      <td className="py-3 pr-4 font-medium text-[#1F1A17]">{fn.name}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-[#1F1A17]">
                        {fn.confirmed_headcount}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-[#8A4F09]">
                        {fn.unconfirmed_max > 0
                          ? `+ ${fn.unconfirmed_min} to ${fn.unconfirmed_max}`
                          : "0"}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-[#5C4F46]">
                        {fn.diet.veg}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-[#5C4F46]">
                        {fn.diet.jain}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-[#5C4F46]">
                        {fn.diet.nonveg}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-[#5C4F46]">
                        {fn.diet.no_onion_garlic}
                      </td>
                      <td className="py-3 pl-4 text-right">
                        <a
                          href={
                            enteredKey
                              ? `/api/host/csv/${fn.id}?k=${encodeURIComponent(enteredKey)}`
                              : `/api/host/csv/${fn.id}`
                          }
                          download={`haanji-${fn.id}.csv`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#C9A96E]/50 text-xs font-medium text-[#6B1E2E] hover:bg-white whitespace-nowrap"
                        >
                          <Download className="w-3 h-3" />
                          <span>CSV</span>
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Column: Unanswered Questions + Households */}
            <div className="lg:col-span-7 space-y-8">
              <section className="rounded-2xl border border-[#C9A96E]/45 bg-white p-6">
                <div className="flex items-baseline justify-between gap-2 pb-4 border-b border-[#C9A96E]/35">
                  <div>
                    <h2 className="font-display text-lg font-semibold text-[#1F1A17]">
                      Unanswered Questions ({data.unanswered.filter((u) => !u.resolved).length} open)
                    </h2>
                    <p className="text-xs text-[#5C4F46]">
                      Questions blocked by the grounding guard or absent from the card. Answer once to teach HaanJi immediately.
                    </p>
                  </div>
                </div>

                {data.unanswered.length === 0 ? (
                  <div className="py-10 text-center text-sm text-[#5C4F46]">
                    No unanswered guest questions yet. Ask &ldquo;Mehendi kitne baje khatam hogi?&rdquo; in Guest Concierge to trigger this live loop.
                  </div>
                ) : (
                  <div className="divide-y divide-[#C9A96E]/25">
                    {data.unanswered.map((uq) => (
                      <div key={uq.id} className="py-4 space-y-2.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-sm font-medium text-[#1F1A17]">{uq.question}</p>
                          <span className="font-mono text-xs text-[#5C4F46]">
                            {uq.language} · {uq.reason} ·{" "}
                            {new Date(uq.created_at).toLocaleTimeString()}
                          </span>
                        </div>

                        {uq.resolved ? (
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <p className="text-[#2F6B4F] font-medium">
                              Added to card: &ldquo;{uq.added_answer}&rdquo;
                            </p>
                            <span className="font-mono text-[#6B1E2E] font-semibold">
                              Answered after adding: {uq.answered_after_adding} guests
                            </span>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={draftAnswers[uq.id] || ""}
                              onChange={(e) =>
                                setDraftAnswers((prev) => ({ ...prev, [uq.id]: e.target.value }))
                              }
                              placeholder="Type official host answer to add to wedding card..."
                              className="flex-1 min-h-[44px] rounded-xl border border-[#C9A96E]/60 bg-white px-3 text-xs text-[#1F1A17]"
                            />
                            <button
                              type="button"
                              onClick={() => handleAddToCard(uq.id)}
                              className="min-h-[44px] px-4 rounded-xl bg-[#6B1E2E] text-white text-xs font-semibold hover:bg-[#541724] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>Answer once</span>
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Households Invite Links & WhatsApp Nudge */}
              <section className="rounded-2xl border border-[#C9A96E]/45 bg-white p-6">
                <div className="flex items-center justify-between gap-2 pb-4 border-b border-[#C9A96E]/35">
                  <div>
                    <h2 className="font-display text-lg font-semibold text-[#1F1A17] flex items-center gap-2">
                      <Users className="w-4 h-4 text-[#6B1E2E]" />
                      <span>Households &amp; Personalized Invite Links</span>
                    </h2>
                    <p className="text-xs text-[#5C4F46]">
                      Links pre-fill family greetings and default elder mode for senior relatives.
                    </p>
                  </div>
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#C9A96E]/35 text-[#5C4F46]">
                        <th className="py-2 pr-3">Household</th>
                        <th className="py-2 px-2">Code</th>
                        <th className="py-2 px-2">Mode</th>
                        <th className="py-2 px-2">Status</th>
                        <th className="py-2 pl-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#C9A96E]/25">
                      {(data.households || []).map((h) => (
                        <tr key={h.code} className="hover:bg-[#FBF7F0]">
                          <td className="py-3 pr-3 font-medium text-[#1F1A17]">
                            {h.family_name}
                          </td>
                          <td className="py-3 px-2 font-mono text-[#6B1E2E]">{h.code}</td>
                          <td className="py-3 px-2 text-[#5C4F46]">
                            {h.preferred_language} · {h.age_band}
                          </td>
                          <td className="py-3 px-2 capitalize font-medium">
                            <span
                              className={
                                h.rsvp_status === "confirmed"
                                  ? "text-[#2F6B4F]"
                                  : h.rsvp_status === "tentative"
                                    ? "text-[#8A4F09]"
                                    : "text-[#6B1E2E]"
                              }
                            >
                              {h.rsvp_status}
                              {h.headcount ? ` (${h.headcount})` : ""}
                            </span>
                          </td>
                          <td className="py-3 pl-2 text-right space-x-2 whitespace-nowrap">
                            {onOpenHousehold && (
                              <button
                                type="button"
                                onClick={() => onOpenHousehold(h.code)}
                                className="px-2.5 py-1.5 rounded-lg border border-[#C9A96E]/60 text-[#1F1A17] hover:bg-white font-medium"
                              >
                                Preview Link
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                void copyText(
                                  buildWhatsAppNudge(h),
                                  `Copied WhatsApp nudge for ${h.family_name} (${h.preferred_language}).`
                                )
                              }
                              className="px-2.5 py-1.5 rounded-lg bg-[#FBF7F0] border border-[#C9A96E]/60 text-[#6B1E2E] hover:bg-white font-medium"
                            >
                              Copy Nudge
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            {/* Right Column: Honest Experiment Panel & Multilingual Host Broadcast */}
            <div className="lg:col-span-5 space-y-8">
              <section className="rounded-2xl border border-[#C9A96E]/45 bg-white p-6">
                <h2 className="font-display text-lg font-semibold text-[#1F1A17]">
                  Voice Persona Experiment (<code className="font-mono text-sm">exp_voice_persona</code>)
                </h2>
                <p className="mt-1 text-xs text-[#6B1E2E] font-medium">
                  {data.experiment.honest_reading}
                </p>
                <p className="mt-1 text-xs text-[#5C4F46]">{data.experiment.flagsmith_note}</p>

                <div className="mt-4 divide-y divide-[#C9A96E]/35 border border-[#C9A96E]/45 rounded-xl">
                  {(["formal", "warm"] as const).map((arm) => {
                    const m = data.experiment.arms[arm];
                    return (
                      <div key={arm} className="p-3.5 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-[#1F1A17] capitalize">
                            {arm} persona
                          </p>
                          <p className="text-xs text-[#5C4F46]">
                            {arm === "formal"
                              ? "Respectful aap · Kore voice"
                              : "Family-style Hinglish · Puck voice"}
                          </p>
                        </div>
                        <div className="text-right font-mono text-xs tabular-nums">
                          <p className="text-[#1F1A17] font-semibold">
                            {m.conversion_rate_pct}% conv
                          </p>
                          <p className="text-[#5C4F46]">
                            {m.completions} / {m.exposures} gids (aband: {m.abandoned})
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-2xl border border-[#C9A96E]/45 bg-white p-6">
                <h2 className="font-display text-lg font-semibold text-[#1F1A17]">
                  Multilingual Host Broadcast
                </h2>
                <p className="mt-1 text-xs text-[#5C4F46]">
                  Write in English; HaanJi translates to Hindi, Kannada, and Tamil for guest pages.
                </p>
                <form onSubmit={handleBroadcast} className="mt-4 space-y-3">
                  <textarea
                    rows={3}
                    value={announcementText}
                    onChange={(e) => setAnnouncementText(e.target.value)}
                    placeholder="e.g., Sangeet doors open at 7:15 PM; shuttle vans depart Taj MG Road at 6:45 PM."
                    className="w-full rounded-xl border border-[#C9A96E]/60 bg-white p-3 text-sm text-[#1F1A17] focus:outline-none focus:ring-2 focus:ring-[#6B1E2E]"
                  />
                  <button
                    type="submit"
                    disabled={broadcasting || !announcementText.trim()}
                    className="w-full min-h-[44px] rounded-xl bg-[#6B1E2E] text-white text-xs font-semibold hover:bg-[#541724] disabled:opacity-50 inline-flex items-center justify-center gap-2"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{broadcasting ? "Translating & Broadcasting..." : "Broadcast to Guests"}</span>
                  </button>
                </form>

                {data.announcements.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-[#C9A96E]/35 space-y-2 text-xs">
                    <p className="font-medium text-[#5C4F46]">Last sent translations:</p>
                    <div className="grid grid-cols-1 gap-1.5 bg-[#FBF7F0] rounded-xl p-3 border border-[#C9A96E]/35 text-[#1F1A17]">
                      <p><strong>EN:</strong> {data.announcements[0].english}</p>
                      <p><strong>HI:</strong> {data.announcements[0].translations?.hi}</p>
                      <p><strong>KN:</strong> {data.announcements[0].translations?.kn}</p>
                      <p><strong>TA:</strong> {data.announcements[0].translations?.ta}</p>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
