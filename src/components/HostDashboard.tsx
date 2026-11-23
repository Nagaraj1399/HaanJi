import { useEffect, useState } from "react";
import { CheckCircle2, Lock, Send, Plus } from "lucide-react";

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
  unanswered: Array<{
    id: string;
    gid: string;
    question: string;
    language: string;
    reason: string;
    created_at: string;
    resolved: boolean;
    added_answer?: string;
  }>;
  experiment: {
    arms: {
      formal: { exposures: number; completions: number; conversion_rate_pct: number };
      warm: { exposures: number; completions: number; conversion_rate_pct: number };
    };
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

export function HostDashboard() {
  const [hostKey, setHostKey] = useState("haanji-host-demo-2026");
  const [data, setData] = useState<HostStateResponse | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({});
  const [announcementText, setAnnouncementText] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const loadState = async (keyOverride?: string) => {
    const k = keyOverride ?? hostKey;
    try {
      const res = await fetch(`/api/host/state?k=${encodeURIComponent(k)}`);
      if (res.status === 403) {
        setAuthError("403 Forbidden: Invalid Host Key.");
        setData(null);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: HostStateResponse = await res.json();
      setAuthError(null);
      setData(json);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void loadState();
    const id = window.setInterval(() => {
      void loadState();
    }, 3000);
    return () => window.clearInterval(id);
  }, [hostKey]);

  const handleAddToCard = async (id: string) => {
    const answer = (draftAnswers[id] || "").trim();
    if (!answer) return;
    try {
      const res = await fetch(`/api/host/add-to-card?k=${encodeURIComponent(hostKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, answer }),
      });
      if (!res.ok) throw new Error("Failed adding FAQ to card");
      setDraftAnswers((prev) => ({ ...prev, [id]: "" }));
      setActionMsg("Added to wedding card — next guest query will answer this automatically.");
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
      const res = await fetch(`/api/host/announcement?k=${encodeURIComponent(hostKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: announcementText.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Translation broadcast failed");
      setAnnouncementText("");
      setActionMsg("Announcement translated to EN/HI/KN/TA and sent to guest pages.");
      await loadState();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBroadcasting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Host Header & Key Gate */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-zinc-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-zinc-900">
            Host Operations Desk
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            Deterministic caterer counts, live unanswered FAQ loop, and persona conversion tracking. Auto-refreshes every 3 s.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {data?.ops_chip && (
            <div className="px-3.5 py-2 rounded-lg border border-zinc-200 bg-white text-xs font-mono tabular-nums text-zinc-700">
              Ops Proxy · L{data.ops_chip.level} · {data.ops_chip.rpm_60s} RPM ·{" "}
              <span
                className={
                  data.ops_chip.sarvam_429_last_60s > 0
                    ? "text-red-700 font-semibold"
                    : "text-emerald-700"
                }
              >
                {data.ops_chip.sarvam_429_last_60s} 429s/60s
              </span>
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-zinc-600">
            <Lock className="w-3.5 h-3.5 text-zinc-400" />
            <input
              type="text"
              aria-label="Host access key"
              value={hostKey}
              onChange={(e) => setHostKey(e.target.value)}
              className="h-9 w-48 rounded-lg border border-zinc-300 bg-white px-2.5 font-mono text-xs text-zinc-800"
            />
          </label>
        </div>
      </div>

      {authError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-900">
          <p className="font-semibold">{authError}</p>
          <p className="mt-1 text-xs text-red-800">
            The startup demo key is <code className="font-mono">haanji-host-demo-2026</code>.
          </p>
        </div>
      )}

      {actionMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" />
          <span>{actionMsg}</span>
        </div>
      )}

      {data && (
        <>
          {/* Caterer Summary Banner */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-zinc-500">
                  Deterministic Summation (Zero LLM Arithmetic)
                </p>
                <h2 className="mt-1 font-display text-xl sm:text-2xl font-semibold text-zinc-900">
                  {data.caterer.caterer_line}
                </h2>
                <p className="mt-1 text-sm text-amber-800 font-medium">
                  {data.caterer.unconfirmed_line}
                </p>
              </div>
              <div className="flex items-center gap-6 text-right font-mono tabular-nums">
                <div>
                  <p className="text-xs text-zinc-500">Confirmed Parties</p>
                  <p className="text-xl font-semibold text-zinc-900">
                    {data.caterer.confirmed_parties}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Needs Room</p>
                  <p className="text-xl font-semibold text-zinc-900">
                    {data.caterer.needs_room_count}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Declined</p>
                  <p className="text-xl font-semibold text-zinc-600">
                    {data.caterer.declined_parties}
                  </p>
                </div>
              </div>
            </div>

            {/* Function & Diet Breakdown Table */}
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs font-medium text-zinc-500">
                    <th className="py-2.5 pr-4">Function</th>
                    <th className="py-2.5 px-4 text-right">Confirmed</th>
                    <th className="py-2.5 px-4 text-right">Unconfirmed Range</th>
                    <th className="py-2.5 px-4 text-right">Veg</th>
                    <th className="py-2.5 px-4 text-right">Jain</th>
                    <th className="py-2.5 px-4 text-right">Non-Veg</th>
                    <th className="py-2.5 pl-4 text-right">No Onion/Garlic</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 text-sm">
                  {Object.values(data.caterer.by_function).map((fn) => (
                    <tr key={fn.id} className="hover:bg-zinc-50/70">
                      <td className="py-3 pr-4 font-medium text-zinc-900">{fn.name}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-zinc-900">
                        {fn.confirmed_headcount}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-amber-800">
                        {fn.unconfirmed_max > 0
                          ? `+ ${fn.unconfirmed_min} to ${fn.unconfirmed_max}`
                          : "—"}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-zinc-700">
                        {fn.diet.veg}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-zinc-700">
                        {fn.diet.jain}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-zinc-700">
                        {fn.diet.nonveg}
                      </td>
                      <td className="py-3 pl-4 text-right font-mono tabular-nums text-zinc-700">
                        {fn.diet.no_onion_garlic}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Unanswered Questions + Live Add to Card Loop */}
            <section className="lg:col-span-7 rounded-2xl border border-zinc-200 bg-white p-6">
              <div className="flex items-baseline justify-between gap-2 pb-4 border-b border-zinc-200">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-900">
                    Unanswered Questions ({data.unanswered.filter((u) => !u.resolved).length} open)
                  </h2>
                  <p className="text-xs text-zinc-500">
                    Questions blocked by the grounding guard or absent from the card. Add an answer to teach HaanJi immediately.
                  </p>
                </div>
              </div>

              {data.unanswered.length === 0 ? (
                <div className="py-10 text-center text-sm text-zinc-500">
                  No unanswered guest questions yet. Ask an unanswerable question in Guest Concierge (e.g. &ldquo;Mehendi kitne baje khatam hogi?&rdquo;) to trigger this loop.
                </div>
              ) : (
                <div className="divide-y divide-zinc-200">
                  {data.unanswered.map((uq) => (
                    <div key={uq.id} className="py-4 space-y-2.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-medium text-zinc-900">{uq.question}</p>
                        <span className="font-mono text-xs text-zinc-500">
                          {uq.language} · {uq.reason} ·{" "}
                          {new Date(uq.created_at).toLocaleTimeString()}
                        </span>
                      </div>

                      {uq.resolved ? (
                        <p className="text-xs text-emerald-700">
                          Added to card: &ldquo;{uq.added_answer}&rdquo;
                        </p>
                      ) : (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={draftAnswers[uq.id] || ""}
                            onChange={(e) =>
                              setDraftAnswers((prev) => ({ ...prev, [uq.id]: e.target.value }))
                            }
                            placeholder="Type official host answer to add to wedding card…"
                            className="flex-1 h-9 rounded-lg border border-zinc-300 bg-white px-3 text-xs text-zinc-900"
                          />
                          <button
                            type="button"
                            onClick={() => handleAddToCard(uq.id)}
                            className="h-9 px-3.5 rounded-lg bg-[#C2410C] text-white text-xs font-medium hover:bg-[#9A3412] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Add to card
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Right Column: Experiment Panel & Host Multilingual Announcement */}
            <div className="lg:col-span-5 space-y-8">
              <section className="rounded-2xl border border-zinc-200 bg-white p-6">
                <h2 className="text-lg font-semibold text-zinc-900">
                  Voice Persona Experiment (<code className="font-mono text-sm">exp_voice_persona</code>)
                </h2>
                <p className="mt-1 text-xs text-zinc-500">{data.experiment.flagsmith_note}</p>

                <div className="mt-4 divide-y divide-zinc-200 border border-zinc-200 rounded-xl">
                  {(["formal", "warm"] as const).map((arm) => {
                    const m = data.experiment.arms[arm];
                    return (
                      <div key={arm} className="p-3.5 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-zinc-900 capitalize">
                            {arm} persona
                          </p>
                          <p className="text-xs text-zinc-500">
                            {arm === "formal"
                              ? "Respectful aap · Kore voice"
                              : "Family-style Hinglish · Puck voice"}
                          </p>
                        </div>
                        <div className="text-right font-mono text-xs tabular-nums">
                          <p className="text-zinc-900 font-semibold">
                            {m.conversion_rate_pct}% conv
                          </p>
                          <p className="text-zinc-500">
                            {m.completions} / {m.exposures} gids
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-2xl border border-zinc-200 bg-white p-6">
                <h2 className="text-lg font-semibold text-zinc-900">
                  Multilingual Host Broadcast
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  Write in English; Gemini translates to Hindi, Kannada, and Tamil for guest pages.
                </p>
                <form onSubmit={handleBroadcast} className="mt-4 space-y-3">
                  <textarea
                    rows={3}
                    value={announcementText}
                    onChange={(e) => setAnnouncementText(e.target.value)}
                    placeholder="e.g., Sangeet doors open at 7:15 PM; shuttle vans depart Taj MG Road at 6:45 PM."
                    className="w-full rounded-xl border border-zinc-300 bg-white p-3 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-amber-700"
                  />
                  <button
                    type="submit"
                    disabled={broadcasting || !announcementText.trim()}
                    className="w-full h-10 rounded-xl bg-zinc-900 text-white text-xs font-medium hover:bg-zinc-800 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{broadcasting ? "Translating & Broadcasting…" : "Broadcast to Guests"}</span>
                  </button>
                </form>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
