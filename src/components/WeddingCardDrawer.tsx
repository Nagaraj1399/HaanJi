import { MapPin, X } from "lucide-react";

export interface WeddingCardData {
  wedding: {
    id: string;
    title: string;
    subtitle: string;
    dates: string;
    city: string;
    demo_notice: string;
  };
  functions: Array<{
    id: string;
    name: string;
    name_hi?: string;
    name_kn?: string;
    name_ta?: string;
    date: string;
    time: string;
    venue: string;
    venue_kn?: string;
    venue_ta?: string;
    maps_url?: string;
    dress_code: string;
    menu: Array<{ item: string; tags: string[] }>;
  }>;
  logistics: {
    parking: string;
    shuttle: string;
    contacts: Array<{ role: string; name: string; note: string }>;
  };
  faqs: Array<{ q: string; a: string }>;
}

interface WeddingCardDrawerProps {
  open: boolean;
  onClose: () => void;
  card: WeddingCardData | null;
}

export function WeddingCardDrawer({ open, onClose, card }: WeddingCardDrawerProps) {
  if (!open || !card) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#1F1A17]/45 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Official Wedding Card Reference"
    >
      <div className="h-full w-full max-w-xl overflow-y-auto bg-[#FBF7F0] border-l border-[#C9A96E]/50 p-6 sm:p-8 text-[#1F1A17]">
        <div className="flex items-start justify-between gap-4 pb-6 border-b border-[#C9A96E]/40">
          <div>
            <p className="text-xs font-medium text-[#6B1E2E]">{card.wedding.demo_notice}</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-[#1F1A17]">{card.wedding.title}</h2>
            <p className="mt-1 text-sm text-[#5C4F46]">
              {card.wedding.subtitle} · {card.wedding.dates}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-[#C9A96E]/60 bg-white text-[#1F1A17] hover:bg-[#F3EADF] transition-colors"
            aria-label="Close wedding card"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-6 space-y-8">
          <section>
            <h3 className="font-display text-base font-semibold text-[#6B1E2E] mb-3">01. Functions &amp; Venues</h3>
            <div className="divide-y divide-[#C9A96E]/35 border border-[#C9A96E]/45 rounded-2xl overflow-hidden bg-white">
              {card.functions.map((fn) => (
                <div key={fn.id} className="p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold text-[#1F1A17]">{fn.name}</span>
                    <span className="font-mono text-xs tabular-nums text-[#6B1E2E]">
                      {fn.date} · {fn.time}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[#3E352F]">{fn.venue}</p>
                  {(fn.venue_kn || fn.venue_ta) && (
                    <p className="mt-1 text-xs text-[#5C4F46]">
                      {fn.venue_kn} · {fn.venue_ta}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-[#5C4F46]">
                    Dress code: <span className="text-[#1F1A17]">{fn.dress_code}</span>
                  </p>
                  {fn.maps_url && (
                    <a
                      href={fn.maps_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#6B1E2E] hover:underline"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      Open venue map
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="font-display text-base font-semibold text-[#6B1E2E] mb-3">02. Parking, Shuttles &amp; Desk</h3>
            <div className="space-y-3 text-sm text-[#3E352F] bg-white border border-[#C9A96E]/45 rounded-2xl p-4">
              <p>
                <span className="font-medium text-[#1F1A17]">Parking: </span>
                {card.logistics.parking}
              </p>
              <p>
                <span className="font-medium text-[#1F1A17]">Shuttle: </span>
                {card.logistics.shuttle}
              </p>
              <div className="pt-2 border-t border-[#C9A96E]/35 space-y-1">
                {card.logistics.contacts.map((c) => (
                  <p key={c.role} className="text-xs text-[#5C4F46]">
                    <span className="font-medium text-[#1F1A17]">{c.role}:</span> {c.name}, {c.note}
                  </p>
                ))}
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-base font-semibold text-zinc-900 mb-3">
              03. Grounded FAQs ({card.faqs.length})
            </h3>
            <div className="divide-y divide-zinc-200 border border-zinc-200 rounded-xl">
              {card.faqs.map((f, idx) => (
                <div key={idx} className="p-3.5">
                  <p className="text-sm font-medium text-zinc-900">{f.q}</p>
                  <p className="mt-1 text-sm text-zinc-600">{f.a}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
