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
      className="w-28 h-28 rounded-xl border border-[#B8925A]/35 bg-[#14050A] p-2"
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
              fill="#E6CFA3"
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
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 space-y-10 text-[#F5EDE1]">
      <section className="glass-card p-6 sm:p-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
        <div className="space-y-3 max-w-2xl">
          <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">
            <ShieldCheck className="w-4 h-4 text-[#8FB39A]" strokeWidth={1.5} />
            <span>Public Read-Only Walk-Around View</span>
          </span>
          <h1 className="font-display text-3xl sm:text-5xl font-light text-[#F5EDE1] leading-tight">
            HaanJi: Multilingual Wedding Concierge with Human-Gated Quota Protection
          </h1>
          <p className="text-sm text-[#F5EDE1]/70 leading-relaxed">
            Relatives ask questions and RSVP in Hindi, Hinglish, English, Kannada, or Tamil. Card checks block invented venues or times, caterer tallies stay deterministic, and burst traffic sheds audio via human-approved feature flags instead of scaling out pods.
          </p>
        </div>

        <div className="flex items-center gap-5 rounded-2xl border border-[#B8925A]/25 bg-[#14050A]/65 p-5 shrink-0">
          <DeterministicQrGraphic />
          <div className="space-y-2.5">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#E6CFA3] flex items-center gap-1.5">
              <QrCode className="w-3.5 h-3.5" strokeWidth={1.5} />
              <span>Guest Helpline</span>
            </p>
            <p className="font-mono text-xs text-[#F5EDE1]/75 max-w-[180px] truncate">
              /?h=IYER01
            </p>
            <div className="flex flex-wrap gap-2">
              {onOpenGuestLink && (
                <button
                  type="button"
                  onClick={() => onOpenGuestLink("IYER01")}
                  className="min-h-[44px] px-4 rounded-full bg-[#F5EDE1] text-[#14050A] text-xs font-semibold hover:bg-[#E6CFA3] inline-flex items-center gap-1.5"
                >
                  <span>Open Guest</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={copyInviteUrl}
                className="min-h-[44px] px-4 rounded-full border border-[#B8925A]/55 text-[#F5EDE1] text-xs hover:bg-[#B8925A]/15 inline-flex items-center gap-1.5"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-[#8FB39A]" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? "Copied" : "Copy Link"}</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {data && (
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          <div className="glass-card p-6">
            <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">Questions Answered</p>
            <p className="mt-2 font-display text-4xl font-light tabular-nums text-[#F5EDE1]">
              {data.counters.questions_answered}
            </p>
          </div>
          <div className="glass-card p-6">
            <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">Confirmed RSVPs</p>
            <p className="mt-2 font-display text-4xl font-light tabular-nums text-[#8FB39A]">
              {data.counters.confirmed_rsvps}
            </p>
          </div>
          <div className="glass-card p-6">
            <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">Languages Heard</p>
            <p className="mt-2 font-display text-2xl font-light text-[#F5EDE1]">
              {data.counters.languages_heard.length} ({data.counters.languages_heard.join(", ")})
            </p>
          </div>
          <div className="glass-card p-6">
            <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">Served During Surge</p>
            <p className="mt-2 font-display text-4xl font-light tabular-nums text-[#E6CFA3]">
              {data.counters.guests_served_during_surge}
            </p>
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
            title: "Agent proposes, human approves",
            desc: "Alerter fires once and awaits operator approval before shifting degradation level from 0 (voice) to 1 (text only).",
          },
        ].map((item) => (
          <div key={item.step} className="glass-card p-6 space-y-3">
            <span className="font-mono text-xs tracking-[0.2em] text-[#B8925A]">STEP {item.step}</span>
            <h2 className="font-display text-2xl font-light text-[#F5EDE1]">{item.title}</h2>
            <p className="text-sm text-[#F5EDE1]/70 leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </section>

      {data && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-card p-6 space-y-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">
              Live Deterministic Ledger
            </p>
            <p className="font-display text-2xl font-light text-[#F5EDE1]">
              {data.caterer.caterer_line}
            </p>
            <p className="text-xs text-[#E6CFA3]">{data.caterer.unconfirmed_line}</p>
          </div>

          <div className="glass-card p-6 space-y-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">
              Live Flag &amp; Quota Snapshot
            </p>
            <div className="flex flex-wrap gap-6 font-mono text-sm tabular-nums text-[#F5EDE1]">
              <span>Degradation: Level {data.level}</span>
              <span>RPM (60s): {data.rpm_60s}</span>
              <span>429 Rate: {data.rate429_pct_60s}%</span>
              <span>
                2 vs 6 workers: {data.scale_comparison.two_workers_429_per_min} vs{" "}
                {data.scale_comparison.six_workers_429_per_min} 429s/min
              </span>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
