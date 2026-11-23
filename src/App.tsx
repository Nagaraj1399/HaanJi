import { useState } from "react";
import { GuestConcierge } from "./components/GuestConcierge";
import { HostDashboard } from "./components/HostDashboard";
import { OpsControlPlane } from "./components/OpsControlPlane";
import { TestWorkbench } from "./components/TestWorkbench";
import { WeddingCardData, WeddingCardDrawer } from "./components/WeddingCardDrawer";

type WorkspaceTab = "guest" | "host" | "ops" | "tests";

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("guest");
  const [cardDrawerOpen, setCardDrawerOpen] = useState(false);
  const [weddingCard, setWeddingCard] = useState<WeddingCardData | null>(null);

  const openCardDrawer = async () => {
    if (!weddingCard) {
      try {
        const res = await fetch("/api/card?gid=drawer");
        if (res.ok) {
          const j = await res.json();
          setWeddingCard(j.card);
        }
      } catch {
        // ignore
      }
    }
    setCardDrawerOpen(true);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF9F6] text-zinc-900">
      {/* Strict 3-zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-zinc-200">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-8">
          {/* Zone 1: Single text element wordmark */}
          <a
            href="#guest"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab("guest");
            }}
            className="font-display text-xl font-semibold tracking-tight text-zinc-900 whitespace-nowrap shrink-0"
          >
            HaanJi
          </a>

          {/* Zone 2: 4 single-line text nav links */}
          <nav
            aria-label="Primary workspaces"
            className="flex items-center gap-5 sm:gap-7 overflow-x-auto text-sm font-medium"
          >
            {(
              [
                { id: "guest", label: "Guest Concierge" },
                { id: "host", label: "Host Desk" },
                { id: "ops", label: "Ops Control" },
                { id: "tests", label: "Test Bench" },
              ] as const
            ).map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`py-4 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? "border-[#C2410C] text-zinc-900 font-semibold"
                      : "border-transparent text-zinc-600 hover:text-zinc-900"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="shrink-0 hidden sm:block">
            <button
              type="button"
              onClick={openCardDrawer}
              className="px-4 py-2 text-xs font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
            >
              Wedding Card
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {activeTab === "guest" && (
          <GuestConcierge onCardLoaded={(c) => setWeddingCard(c)} />
        )}
        {activeTab === "host" && <HostDashboard />}
        {activeTab === "ops" && <OpsControlPlane />}
        {activeTab === "tests" && <TestWorkbench />}
      </main>

      <footer className="border-t border-zinc-200 bg-white py-4 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
          <span>Sharma &amp; Reddy Wedding · Fictional Demonstration Data</span>
          <button
            type="button"
            onClick={openCardDrawer}
            className="sm:hidden font-medium text-amber-800 hover:underline"
          >
            View Wedding Card
          </button>
        </div>
      </footer>

      <WeddingCardDrawer
        open={cardDrawerOpen}
        onClose={() => setCardDrawerOpen(false)}
        card={weddingCard}
      />
    </div>
  );
}
