import { MapPin, X } from "lucide-react";
import { WeddingCardData } from "../types/haanji";

export type { WeddingCardData };

interface WeddingCardDrawerProps {
  open: boolean;
  onClose: () => void;
  card: WeddingCardData | null;
}

export function WeddingCardDrawer({ open, onClose, card }: WeddingCardDrawerProps) {
  if (!open || !card) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#14050A]/75 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Official Wedding Card Reference"
    >
      <div className="h-full w-full max-w-xl overflow-y-auto bg-[#18060C] border-l border-[#B8925A]/25 p-6 sm:p-8 text-[#F5EDE1]">
        <div className="flex items-start justify-between gap-4 pb-6 border-b hairline-gold">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-[#E6CFA3]">
              {card.wedding.demo_notice}
            </p>
            <h2 className="mt-1.5 font-display text-3xl font-light text-[#F5EDE1]">
              {card.wedding.title}
            </h2>
            <p className="mt-1 text-sm text-[#F5EDE1]/70">
              {card.wedding.subtitle} · {card.wedding.dates}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full border border-[#B8925A]/45 bg-[#14050A]/70 text-[#F5EDE1] hover:bg-[#B8925A]/15 transition-colors"
            aria-label="Close wedding card"
          >
            <X className="w-5 h-5" strokeWidth={1.5} />
          </button>
        </div>

        <div className="mt-8 space-y-8">
          <section>
            <h3 className="font-display text-xl font-light text-[#E6CFA3] mb-3">
              01. Functions &amp; Venues
            </h3>
            <div className="divide-y divide-[#B8925A]/20 border border-[#B8925A]/20 rounded-2xl overflow-hidden bg-[#14050A]/55">
              {card.functions.map((fn) => (
                <div key={fn.id} className="p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-display text-lg font-normal text-[#F5EDE1]">
                      {fn.name}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-[#E6CFA3]">
                      {fn.date} · {fn.time}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[#F5EDE1]/80">{fn.venue}</p>
                  {(fn.venue_kn || fn.venue_ta) && (
                    <p className="mt-1 text-xs text-[#F5EDE1]/65 indic-relaxed">
                      {fn.venue_kn} · {fn.venue_ta}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-[#F5EDE1]/65">
                    Dress code: <span className="text-[#F5EDE1]">{fn.dress_code}</span>
                  </p>
                  {fn.maps_url && (
                    <a
                      href={fn.maps_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.15em] text-[#E6CFA3] hover:underline"
                    >
                      <MapPin className="w-3.5 h-3.5" strokeWidth={1.5} />
                      <span>Directions</span>
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="font-display text-xl font-light text-[#E6CFA3] mb-3">
              02. Parking, Shuttles &amp; Desk
            </h3>
            <div className="space-y-3 text-sm text-[#F5EDE1]/80 bg-[#14050A]/55 border border-[#B8925A]/20 rounded-2xl p-4">
              <p>
                <span className="font-medium text-[#F5EDE1]">Parking: </span>
                {card.logistics.parking}
              </p>
              <p>
                <span className="font-medium text-[#F5EDE1]">Shuttle: </span>
                {card.logistics.shuttle}
              </p>
              <div className="pt-2 border-t hairline-gold space-y-1.5">
                {card.logistics.contacts.map((c) => (
                  <p key={c.role} className="text-xs text-[#F5EDE1]/70">
                    <span className="font-medium text-[#E6CFA3]">{c.role}:</span> {c.name},{" "}
                    {c.note}
                  </p>
                ))}
              </div>
            </div>
          </section>

          <section>
            <h3 className="font-display text-xl font-light text-[#E6CFA3] mb-3">
              03. Grounded FAQs ({card.faqs.length})
            </h3>
            <div className="divide-y divide-[#B8925A]/20 border border-[#B8925A]/20 rounded-2xl bg-[#14050A]/55">
              {card.faqs.map((f, idx) => (
                <div key={idx} className="p-4">
                  <p className="text-sm font-medium text-[#F5EDE1]">{f.q}</p>
                  <p className="mt-1 text-sm text-[#F5EDE1]/70">{f.a}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
