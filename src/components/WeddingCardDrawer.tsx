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
      className="fixed inset-0 z-50 flex justify-end bg-zinc-950/40 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Official Wedding Card Reference"
    >
      <div className="h-full w-full max-w-xl overflow-y-auto bg-white border-l border-zinc-200 p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4 pb-6 border-b border-zinc-200">
          <div>
            <p className="text-xs font-medium text-amber-800">{card.wedding.demo_notice}</p>
            <h2 className="mt-1 text-2xl font-semibold text-zinc-900">{card.wedding.title}</h2>
            <p className="mt-1 text-sm text-zinc-600">
              {card.wedding.subtitle} · {card.wedding.dates}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 transition-colors"
            aria-label="Close wedding card"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-6 space-y-8">
          <section>
            <h3 className="text-base font-semibold text-zinc-900 mb-3">01. Functions & Venues</h3>
            <div className="divide-y divide-zinc-200 border border-zinc-200 rounded-xl overflow-hidden">
              {card.functions.map((fn) => (
                <div key={fn.id} className="p-4 bg-white">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold text-zinc-900">{fn.name}</span>
                    <span className="font-mono text-xs tabular-nums text-amber-800">
                      {fn.date} · {fn.time}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-700">{fn.venue}</p>
                  {(fn.venue_kn || fn.venue_ta) && (
                    <p className="mt-1 text-xs text-zinc-500">
                      {fn.venue_kn} · {fn.venue_ta}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-zinc-600">
                    Dress code: <span className="text-zinc-900">{fn.dress_code}</span>
                  </p>
                  {fn.maps_url && (
                    <a
                      href={fn.maps_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 hover:underline"
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
            <h3 className="text-base font-semibold text-zinc-900 mb-3">02. Parking, Shuttles & Desk</h3>
            <div className="space-y-3 text-sm text-zinc-700 bg-[#FAF9F6] border border-zinc-200 rounded-xl p-4">
              <p>
                <span className="font-medium text-zinc-900">Parking: </span>
                {card.logistics.parking}
              </p>
              <p>
                <span className="font-medium text-zinc-900">Shuttle: </span>
                {card.logistics.shuttle}
              </p>
              <div className="pt-2 border-t border-zinc-200 space-y-1">
                {card.logistics.contacts.map((c) => (
                  <p key={c.role} className="text-xs text-zinc-600">
                    <span className="font-medium text-zinc-900">{c.role}:</span> {c.name} — {c.note}
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
