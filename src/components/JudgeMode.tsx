import { useEffect, useState } from "react";
import { ArrowRight, Check, Copy, QrCode, ShieldCheck } from "lucide-react";

interface JudgeState {
  counters: {
    questions_answered: number;
    confirmed_rsvps: number;
    languages_heard: string[];
    guests_served_during_surge: number;
  };
  caterer: {
    caterer_line: string;
    unconfirmed_line: string;
  };
  level: 0 | 1 | 2;
  rpm_60s: number;
  rate429_pct_60s: number;
  timeseries: Array<{ t: string; rpm: number; rate429Pct: number; tts: number }>;
  alerter_status: string;
  scale_comparison: {
    two_workers_429_per_min: number;
    six_workers_429_per_min: number;
    account_cap_rpm: number;
    note: string;
  };
  flags_map: {
    ops_degradation_level: number;
    ops_sarvam_rpm_budget: number;
    rel_elder_mode_default: boolean;
    source: string;
  };
}

function DeterministicQrGraphic() {
  // Clean 11x11 decorative matrix SVG representing the shareable ?h=IYER01 guest link
  const pattern = [
    "11101010111",
    "10100100101",
    "11101100111",
    "00001010000",
    "10110111010",
    "01011001101",
    "11001101010",
    "00001011001",
    "11101100110",
    "10100110101",
    "11101011011",
  ];
  return (
    <svg
      viewBox="0 0 110 110"
      className="w-28 h-28 rounded-xl border border-[#C9A96E]/60 bg-white p-2"
      aria-label="Guest invite link QR preview"
    >
      {pattern.map((row, y) =>
        row.split("").map((cell, x) =>
          cell === "1" ? (
            <rect
              key={`${x}-${y}`}
              x={x * 10}
              y={y * 10}
              width={9}
              height={9}
              rx={1.5}
              fill="#6B1E2E"
            />
          ) : null
        )
      )}
    </svg>
  );
}

export function JudgeMode({
  onOpenGuestLink,
}: {
  onOpenGuestLink?: (code: string) => void;
}) {
  const [data, setData] = useState<JudgeState | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/judge/state");
        if (res.ok) setData(await res.json());
      } catch {
        // ignore transient poll error
      }
    };
    void load();
    const id = window.setInterval(load, 2500);
    return () => window.clearInterval(id);
  }, []);

  const guestUrl = `${window.location.origin}/?h=IYER01`;

  const copyInviteUrl = async () => {
    try {
      await navigator.clipboard.writeText(guestUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top 60-Second Walk-Around Banner */}
      <section className="rounded-2xl border border-[#C9A96E]/55 bg-white p-6 sm:p-8 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
        <div className="space-y-3 max-w-2xl">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase text-[#6B1E2E]">
            <ShieldCheck className="w-4 h-4 text-[#2F6B4F]" />
            <span>Public Read-Only Walk-Around View</span>
          </span>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#1F1A17] leading-tight">
            HaanJi: Multilingual Wedding Concierge with Human-Gated Quota Protection
          </h1>
          <p className="text-sm text-[#5C4F46] leading-relaxed">
            Relatives ask questions and RSVP in Hindi, Hinglish, English, Kannada, or Tamil. Grounding checks block invented venues or times, caterer tallies stay deterministic, and burst traffic sheds audio via human-approved feature flags instead of scaling out pods.
          </p>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-[#C9A96E]/50 bg-[#FBF7F0] p-4 shrink-0">
          <DeterministicQrGraphic />
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[#6B1E2E] flex items-center gap-1.5">
              <QrCode className="w-3.5 h-3.5" />
              <span>Try Guest Helpline</span>
            </p>
            <p className="font-mono text-xs text-[#5C4F46] max-w-[180px] truncate">
              /?h=IYER01
            </p>
            <div className="flex flex-wrap gap-2">
              {onOpenGuestLink && (
                <button
                  type="button"
                  onClick={() => onOpenHouseholdClick(onOpenGuestLink)}
                  className="min-h-[36px] px-3 rounded-lg bg-[#6B1E2E] text-white text-xs font-semibold hover:bg-[#541724] inline-flex items-center gap-1"
                >
                  <span>Open Guest</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
              <button
                type="button"
                onClick={copyInviteUrl}
                className="min-h-[36px] px-3 rounded-lg border border-[#C9A96E] bg-white text-[#1F1A17] text-xs font-medium inline-flex items-center gap-1"
              >
                {copied ? <Check className="w-3 h-3 text-[#2F6B4F]" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? "Copied" : "Copy Link"}</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Live Counters */}
      {data && (
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-[#C9A96E]/45 bg-white p-5">
            <p className="text-xs font-medium text-[#5C4F46]">Questions Answered</p>
            <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-[#6B1E2E]">
              {data.counters.questions_answered}
            </p>
          </div>
          <div className="rounded-2xl border border-[#C9A96E]/45 bg-white p-5">
            <p className="text-xs font-medium text-[#5C4F46]">Confirmed RSVPs</p>
            <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-[#2F6B4F]">
              {data.counters.confirmed_rsvps}
            </p>
          </div>
          <div className="rounded-2xl border border-[#C9A96E]/45 bg-white p-5">
            <p className="text-xs font-medium text-[#5C4F46]">Languages Heard</p>
            <p className="mt-1 font-display text-2xl font-semibold text-[#1F1A17]">
              {data.counters.languages_heard.length} ({data.counters.languages_heard.join(", ")})
            </p>
          </div>
          <div className="rounded-2xl border border-[#C9A96E]/45 bg-white p-5">
            <p className="text-xs font-medium text-[#5C4F46]">Served During Degraded Load</p>
            <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-[#8A4F09]">
              {data.counters.guests_served_during_surge}
            </p>
          </div>
        </section>
      )}

      {/* Three-Step Story Strip */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {[
          {
            step: "01",
            title: "Guests ask in their language",
            desc: "Voice or text in Hindi, Hinglish, Kannada, Tamil, or English. Every answer is card-grounded and captures RSVPs in one turn.",
          },
          {
            step: "02",
            title: "Muhurat surge hits the AI quota",
            desc: "Morning bursts saturate the 60 RPM upstream limit before pod CPU rises. Horizontal pod scaling would amplify 429s.",
          },
          {
            step: "03",
            title: "Agent proposes, human approves, flag sheds load",
            desc: "Alerter fires once and awaits operator approval before shifting degradation level from 0 (voice) to 1 (text only).",
          },
        ].map((item) => (
          <div
            key={item.step}
            className="rounded-2xl border border-[#C9A96E]/45 bg-white p-6 space-y-2"
          >
            <span className="font-mono text-xs font-semibold text-[#F2A93B] bg-[#1F1A17] px-2.5 py-1 rounded-md">
              Step {item.step}
            </span>
            <h2 className="pt-1 font-display text-lg font-semibold text-[#1F1A17]">
              {item.title}
            </h2>
            <p className="text-sm text-[#5C4F46] leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </section>

      {/* Live Caterer + Ops Summary */}
      {data && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-[#C9A96E]/45 bg-white p-6 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#6B1E2E]">
              Live Deterministic Ledger
            </p>
            <p className="font-display text-xl font-semibold text-[#1F1A17]">
              {data.caterer.caterer_line}
            </p>
            <p className="text-xs text-[#8A4F09] font-medium">
              {data.caterer.unconfirmed_line}
            </p>
          </div>

          <div className="rounded-2xl border border-[#C9A96E]/25 bg-[#14110F] text-[#FBF7F0] p-6 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#F2A93B]">
              Live Flag &amp; Quota Snapshot
            </p>
            <div className="flex flex-wrap gap-6 font-mono text-sm tabular-nums">
              <span>Degradation: Level {data.level}</span>
              <span>RPM (60s): {data.rpm_60s}</span>
              <span>429 Rate: {data.rate429_pct_60s}%</span>
              <span>2 vs 6 workers: {data.scale_comparison.two_workers_429_per_min} vs {data.scale_comparison.six_workers_429_per_min} 429s/min</span>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function onOpenHouseholdClick(cb: (code: string) => void) {
  cb("IYER01");
}
