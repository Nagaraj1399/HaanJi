import { CheckCircle2, Circle, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { useState } from "react";

export type DemoStepId =
  | "hinglish"
  | "kannada"
  | "tamil"
  | "rsvp_confirmed"
  | "elder_mode"
  | "ops_rush_done"
  | "ops_flags_checked";

const DEMO_STEPS: Array<{ id: DemoStepId; num: number; label: string }> = [
  { id: "hinglish", num: 1, label: "Hinglish: Sangeet time & venue" },
  { id: "kannada", num: 2, label: "Kannada: Muhurat voice/text answer" },
  { id: "tamil", num: 3, label: "Tamil: Muhurat answer in Tamil" },
  { id: "rsvp_confirmed", num: 4, label: "RSVP: 4 log, 2 Jain, confirm -> caterer" },
  { id: "elder_mode", num: 5, label: "Elder Mode ON: large text + 0.85x pace" },
  { id: "ops_rush_done", num: 6, label: "Ops: Muhurat Rush -> Approve -> Level 1" },
  { id: "ops_flags_checked", num: 7, label: "Flags panel + tone experiment" },
];

export function DemoChecklist({
  completed,
  onSelectStep,
  onResetDemo,
}: {
  completed: Record<DemoStepId, boolean>;
  onSelectStep: (step: DemoStepId) => void;
  onResetDemo: () => Promise<void>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [resetting, setResetting] = useState(false);

  const doneCount = DEMO_STEPS.filter((s) => completed[s.id]).length;

  return (
    <aside
      aria-label="Demo recording checklist"
      className="fixed bottom-4 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-[#B8925A]/45 bg-[#14050A]/90 backdrop-blur-md text-[#F5EDE1] overflow-hidden"
    >
      <div className="px-4 py-3 bg-[#2B0A12] border-b border-[#B8925A]/25 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-2 text-left text-xs uppercase tracking-[0.14em] font-medium text-[#E6CFA3] flex-1"
        >
          <span>
            Demo Checklist ({doneCount}/{DEMO_STEPS.length})
          </span>
          {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        <button
          type="button"
          disabled={resetting}
          onClick={async () => {
            setResetting(true);
            try {
              await onResetDemo();
            } finally {
              setResetting(false);
            }
          }}
          className="px-2.5 py-1 rounded-full border border-[#B8925A]/45 bg-[#14050A]/70 hover:bg-[#B8925A]/15 text-[11px] text-[#E6CFA3] inline-flex items-center gap-1"
        >
          <RotateCcw className="w-3 h-3" />
          <span>{resetting ? "Resetting..." : "Reset demo"}</span>
        </button>
      </div>

      {!collapsed && (
        <div className="p-3 space-y-1.5 max-h-80 overflow-y-auto">
          {DEMO_STEPS.map((step) => {
            const done = Boolean(completed[step.id]);
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => onSelectStep(step.id)}
                className={`w-full text-left px-3 py-2 rounded-xl border text-xs flex items-start gap-2 transition-colors ${
                  done
                    ? "border-[#8FB39A]/45 bg-[#8FB39A]/10 text-[#8FB39A]"
                    : "border-[#B8925A]/20 bg-[#14050A]/55 text-[#F5EDE1] hover:bg-[#B8925A]/10"
                }`}
              >
                {done ? (
                  <CheckCircle2 className="w-4 h-4 text-[#8FB39A] shrink-0 mt-0.5" />
                ) : (
                  <Circle className="w-4 h-4 text-[#B8925A] shrink-0 mt-0.5" />
                )}
                <span>
                  <span className="font-mono text-[#E6CFA3] mr-1">{step.num}.</span>
                  {step.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}
