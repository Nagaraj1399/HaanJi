import { useEffect, useState } from "react";
import { GuestConcierge } from "./components/GuestConcierge";
import { HostDashboard } from "./components/HostDashboard";
import { JudgeMode } from "./components/JudgeMode";
import { OpsControlPlane } from "./components/OpsControlPlane";
import { TestWorkbench } from "./components/TestWorkbench";
import { WeddingCardData, WeddingCardDrawer } from "./components/WeddingCardDrawer";

type WorkspaceTab = "guest" | "host" | "ops" | "judge" | "tests";

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(() => {
    if (typeof window !== "undefined") {
      if (window.location.pathname.startsWith("/judge")) return "judge";
      if (window.location.pathname.startsWith("/host")) return "host";
      if (window.location.pathname.startsWith("/ops")) return "ops";
    }
    return "guest";
  });
  const [householdCode, setHouseholdCode] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("h");
    }
    return null;
  });
  const [cardDrawerOpen, setCardDrawerOpen] = useState(false);
  const [weddingCard, setWeddingCard] = useState<WeddingCardData | null>(null);

  useEffect(() => {
    const h = new URLSearchParams(window.location.search).get("h");
    if (h) setHouseholdCode(h);
  }, []);

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

  const openGuestWithHousehold = (code: string) => {
    setHouseholdCode(code);
    setActiveTab("guest");
    const url = new URL(window.location.href);
    url.pathname = "/";
    url.searchParams.set("h", code);
    window.history.replaceState({}, "", url.toString());
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FBF7F0] text-[#1F1A17]">
      {/* Strict 3-zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-[#FBF7F0]/95 backdrop-blur-sm border-b border-[#C9A96E]/40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-8">
          {/* Zone 1: Wordmark */}
          <a
            href="#guest"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab("guest");
            }}
            className="font-display text-xl font-semibold tracking-tight text-[#6B1E2E] whitespace-nowrap shrink-0"
          >
            HaanJi
          </a>

          {/* Zone 2: 5 single-line text nav links */}
          <nav
            aria-label="Primary workspaces"
            className="flex items-center gap-4 sm:gap-6 overflow-x-auto text-sm font-medium"
          >
            {(
              [
                { id: "guest", label: "Guest Concierge" },
                { id: "host", label: "Host Desk" },
                { id: "ops", label: "Ops Control" },
                { id: "judge", label: "Judge Mode" },
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
                      ? "border-[#6B1E2E] text-[#6B1E2E] font-semibold"
                      : "border-transparent text-[#5C4F46] hover:text-[#1F1A17]"
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
              className="px-4 py-2 text-xs font-semibold text-[#FBF7F0] bg-[#6B1E2E] rounded-xl hover:bg-[#541724] transition-colors whitespace-nowrap shrink-0"
            >
              Wedding Card
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        {activeTab === "guest" && (
          <GuestConcierge
            householdCode={householdCode}
            onCardLoaded={(c) => setWeddingCard(c)}
          />
        )}
        {activeTab === "host" && (
          <HostDashboard onOpenHousehold={openGuestWithHousehold} />
        )}
        {activeTab === "ops" && <OpsControlPlane />}
        {activeTab === "judge" && (
          <JudgeMode onOpenGuestLink={openGuestWithHousehold} />
        )}
        {activeTab === "tests" && <TestWorkbench />}
      </main>

      <footer className="border-t border-[#C9A96E]/40 bg-[#FBF7F0] py-4 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl flex flex-wrap items-center justify-between gap-2 text-xs text-[#5C4F46]">
          <span>Sharma &amp; Reddy Wedding · Fictional Demonstration Data · GenOS Team</span>
          <button
            type="button"
            onClick={openCardDrawer}
            className="sm:hidden font-semibold text-[#6B1E2E] hover:underline"
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
