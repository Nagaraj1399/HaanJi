import { loadWeddingCard, VALID_FUNCTION_IDS } from "./config.ts";
import type {
  DietBreakdown,
  FunctionId,
  GuestRsvp,
  HostAnnouncement,
  HouseholdRecord,
  RsvpPatch,
  UnansweredQuestion,
  WeddingCard,
} from "./types.ts";

// IMPORTANT: store.ts MUST NEVER import brain.ts or any LLM/Sarvam client.
// Caterer totals are strictly deterministic arithmetic over validated GuestRsvp records.

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateRsvpPatch(
  patch: RsvpPatch,
  currentHeadcount: number | null = null
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (patch.headcount !== undefined && patch.headcount !== null) {
    if (!Number.isInteger(patch.headcount) || patch.headcount < 0) {
      errors.push(`Invalid headcount: ${patch.headcount}. Must be a non-negative integer.`);
    }
  }

  if (patch.headcount_range !== undefined && patch.headcount_range !== null) {
    const [low, high] = patch.headcount_range;
    if (low < 0 || high < low) {
      errors.push(`Invalid headcount_range: [${low}, ${high}].`);
    }
  }

  if (patch.functions !== undefined && patch.functions !== null) {
    for (const fnId of patch.functions) {
      if (!VALID_FUNCTION_IDS.includes(fnId)) {
        errors.push(`Unknown function id: ${fnId}`);
      }
    }
  }

  if (patch.diet !== undefined && patch.diet !== null) {
    const vals = Object.values(patch.diet).filter(
      (v): v is number => typeof v === "number"
    );
    if (vals.some((v) => v < 0)) {
      errors.push("Diet counts cannot be negative.");
    }
    const dietSum =
      (patch.diet.veg ?? 0) +
      (patch.diet.jain ?? 0) +
      (patch.diet.nonveg ?? 0) +
      (patch.diet.no_onion_garlic ?? 0);
    const effectiveHeadcount = patch.headcount ?? currentHeadcount;
    if (effectiveHeadcount !== null && effectiveHeadcount > 0 && dietSum > effectiveHeadcount) {
      warnings.push(
        `Diet total (${dietSum}) exceeds headcount (${effectiveHeadcount}); please confirm meal preferences.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function mergeRsvp(
  existing: GuestRsvp | null,
  gid: string,
  patch: RsvpPatch,
  options?: { confirmed?: boolean; householdCode?: string | null; householdName?: string | null }
): { rsvp: GuestRsvp; becameCompleteFirstTime: boolean; warnings: string[] } {
  const base: GuestRsvp = existing ?? {
    gid,
    household_code: options?.householdCode ?? null,
    household_name: options?.householdName ?? null,
    attending: null,
    headcount: null,
    headcount_range: null,
    functions: [],
    diet: { veg: 0, jain: 0, nonveg: 0, no_onion_garlic: 0 },
    arrival: null,
    needs_room: null,
    confirmed: false,
    rsvp_complete: false,
    warnings: [],
    updated_at: new Date().toISOString(),
  };

  const validation = validateRsvpPatch(patch, base.headcount);
  if (!validation.valid) {
    throw new Error(validation.errors.join(" "));
  }

  const wasComplete = base.rsvp_complete;

  const nextAttending =
    patch.attending !== undefined && patch.attending !== null
      ? patch.attending
      : base.attending;

  let nextHeadcount = base.headcount;
  let nextRange = base.headcount_range;
  if (patch.headcount !== undefined && patch.headcount !== null) {
    nextHeadcount = patch.headcount;
    nextRange = null;
  } else if (patch.headcount_range !== undefined && patch.headcount_range !== null) {
    nextRange = patch.headcount_range;
  }

  const nextFunctions =
    patch.functions !== undefined && patch.functions !== null
      ? [...patch.functions]
      : base.functions;

  const nextDiet: DietBreakdown = {
    veg: patch.diet?.veg ?? base.diet.veg,
    jain: patch.diet?.jain ?? base.diet.jain,
    nonveg: patch.diet?.nonveg ?? base.diet.nonveg,
    no_onion_garlic: patch.diet?.no_onion_garlic ?? base.diet.no_onion_garlic,
  };

  const nextArrival =
    patch.arrival !== undefined && patch.arrival !== null
      ? patch.arrival
      : base.arrival;
  const nextNeedsRoom =
    patch.needs_room !== undefined && patch.needs_room !== null
      ? patch.needs_room
      : base.needs_room;

  const nextConfirmed =
    options?.confirmed !== undefined ? options.confirmed : base.confirmed;

  const hasRequiredFields =
    nextAttending === false ||
    (nextHeadcount !== null &&
      nextHeadcount > 0 &&
      nextFunctions.length > 0);

  const isComplete = hasRequiredFields && (options?.confirmed === false ? false : true);

  const merged: GuestRsvp = {
    gid,
    household_code: options?.householdCode ?? base.household_code ?? null,
    household_name: options?.householdName ?? base.household_name ?? null,
    attending: nextAttending,
    headcount: nextAttending === false ? 0 : nextHeadcount,
    headcount_range: nextAttending === false ? null : nextRange,
    functions: nextAttending === false ? [] : nextFunctions,
    diet: nextDiet,
    arrival: nextArrival,
    needs_room: nextNeedsRoom,
    confirmed: nextConfirmed,
    rsvp_complete: isComplete,
    warnings: validation.warnings,
    updated_at: new Date().toISOString(),
  };

  return {
    rsvp: merged,
    becameCompleteFirstTime: !wasComplete && isComplete,
    warnings: validation.warnings,
  };
}

export interface CatererFunctionSummary {
  id: FunctionId;
  name: string;
  confirmed_headcount: number;
  unconfirmed_min: number;
  unconfirmed_max: number;
  diet: DietBreakdown;
}

export interface CatererSummary {
  caterer_line: string;
  unconfirmed_line: string;
  by_function: Record<FunctionId, CatererFunctionSummary>;
  needs_room_count: number;
  total_rsvps: number;
  confirmed_parties: number;
  declined_parties: number;
}

export function computeCatererSummary(rsvps: GuestRsvp[]): CatererSummary {
  const names: Record<FunctionId, string> = {
    mehendi: "Mehendi",
    sangeet: "Sangeet",
    shaadi: "Shaadi",
    reception: "Reception",
  };

  const byFn: Record<FunctionId, CatererFunctionSummary> = {
    mehendi: {
      id: "mehendi",
      name: names.mehendi,
      confirmed_headcount: 0,
      unconfirmed_min: 0,
      unconfirmed_max: 0,
      diet: { veg: 0, jain: 0, nonveg: 0, no_onion_garlic: 0 },
    },
    sangeet: {
      id: "sangeet",
      name: names.sangeet,
      confirmed_headcount: 0,
      unconfirmed_min: 0,
      unconfirmed_max: 0,
      diet: { veg: 0, jain: 0, nonveg: 0, no_onion_garlic: 0 },
    },
    shaadi: {
      id: "shaadi",
      name: names.shaadi,
      confirmed_headcount: 0,
      unconfirmed_min: 0,
      unconfirmed_max: 0,
      diet: { veg: 0, jain: 0, nonveg: 0, no_onion_garlic: 0 },
    },
    reception: {
      id: "reception",
      name: names.reception,
      confirmed_headcount: 0,
      unconfirmed_min: 0,
      unconfirmed_max: 0,
      diet: { veg: 0, jain: 0, nonveg: 0, no_onion_garlic: 0 },
    },
  };

  let needsRoomCount = 0;
  let confirmedParties = 0;
  let declinedParties = 0;
  let totalUnconfirmedMin = 0;
  let totalUnconfirmedMax = 0;

  for (const r of rsvps) {
    if (r.attending === false) {
      declinedParties += 1;
      continue;
    }
    if (r.rsvp_complete) {
      confirmedParties += 1;
    }
    if (r.needs_room) {
      needsRoomCount += 1;
    }

    const targetFns: FunctionId[] = r.functions.length > 0 ? r.functions : [];

    if ((r.confirmed || r.rsvp_complete) && r.headcount !== null && r.headcount > 0) {
      for (const fn of targetFns) {
        byFn[fn].confirmed_headcount += r.headcount;
        byFn[fn].diet.veg += r.diet.veg;
        byFn[fn].diet.jain += r.diet.jain;
        byFn[fn].diet.nonveg += r.diet.nonveg;
        byFn[fn].diet.no_onion_garlic += r.diet.no_onion_garlic;
      }
    } else if (!r.rsvp_complete && r.headcount !== null && r.headcount > 0) {
      totalUnconfirmedMin += r.headcount;
      totalUnconfirmedMax += r.headcount;
      for (const fn of targetFns) {
        byFn[fn].unconfirmed_min += r.headcount;
        byFn[fn].unconfirmed_max += r.headcount;
      }
    } else if (r.headcount_range !== null) {
      const [lo, hi] = r.headcount_range;
      totalUnconfirmedMin += lo;
      totalUnconfirmedMax += hi;
      for (const fn of targetFns) {
        byFn[fn].unconfirmed_min += lo;
        byFn[fn].unconfirmed_max += hi;
      }
    }
  }

  const catererLine = `Tell the caterer: Mehendi ${byFn.mehendi.confirmed_headcount}, Sangeet ${byFn.sangeet.confirmed_headcount}, Shaadi ${byFn.shaadi.confirmed_headcount}, Reception ${byFn.reception.confirmed_headcount}.`;
  const unconfirmedLine =
    totalUnconfirmedMax > 0
      ? `+ ${totalUnconfirmedMin} to ${totalUnconfirmedMax} unconfirmed (range estimates)`
      : "No unconfirmed ranges";

  return {
    caterer_line: catererLine,
    unconfirmed_line: unconfirmedLine,
    by_function: byFn,
    needs_room_count: needsRoomCount,
    total_rsvps: rsvps.length,
    confirmed_parties: confirmedParties,
    declined_parties: declinedParties,
  };
}

export class WeddingStore {
  private card: WeddingCard;
  private rsvps = new Map<string, GuestRsvp>();
  private households = new Map<string, HouseholdRecord>();
  private unanswered: UnansweredQuestion[] = [];
  private announcements: HostAnnouncement[] = [];
  private questionsAnsweredCount = 0;
  private languagesHeard = new Set<string>(["hinglish", "en-IN"]);
  private guestsServedDuringSurge = 0;

  constructor() {
    this.card = loadWeddingCard("wedding.yaml");
    this.seedInitialDemoData();
  }

  private seedInitialDemoData(): void {
    const demoHouseholds: HouseholdRecord[] = [
      {
        code: "IYER01",
        family_name: "Iyer Family",
        preferred_language: "ta",
        age_band: "elder",
        invited_functions: ["mehendi", "sangeet", "shaadi", "reception"],
        gid: "seed-iyer-chn-3",
      },
      {
        code: "SHARMA02",
        family_name: "Sharma Family (Delhi)",
        preferred_language: "hi",
        age_band: "standard",
        invited_functions: ["mehendi", "sangeet", "shaadi", "reception"],
        gid: "seed-sharma-blr-1",
      },
      {
        code: "REDDY03",
        family_name: "Reddy Family (Hyderabad)",
        preferred_language: "en",
        age_band: "standard",
        invited_functions: ["sangeet", "shaadi", "reception"],
        gid: "seed-reddy-hyd-2",
      },
      {
        code: "PATEL04",
        family_name: "Patel Family",
        preferred_language: "hinglish",
        age_band: "standard",
        invited_functions: ["sangeet", "shaadi"],
        gid: "seed-patel-range-4",
      },
      {
        code: "RAO05",
        family_name: "Rao Family (Mysuru)",
        preferred_language: "kn",
        age_band: "elder",
        invited_functions: ["shaadi", "reception"],
        gid: null,
      },
    ];
    for (const h of demoHouseholds) {
      this.households.set(h.code, h);
    }

    const seeds: Array<{ gid: string; code: string; name: string; patch: RsvpPatch }> = [
      {
        gid: "seed-sharma-blr-1",
        code: "SHARMA02",
        name: "Sharma Family (Delhi)",
        patch: {
          attending: true,
          headcount: 6,
          functions: ["mehendi", "sangeet", "shaadi", "reception"],
          diet: { veg: 4, jain: 2, nonveg: 0, no_onion_garlic: 0 },
          needs_room: true,
        },
      },
      {
        gid: "seed-reddy-hyd-2",
        code: "REDDY03",
        name: "Reddy Family (Hyderabad)",
        patch: {
          attending: true,
          headcount: 4,
          functions: ["sangeet", "shaadi", "reception"],
          diet: { veg: 1, jain: 0, nonveg: 3, no_onion_garlic: 0 },
          needs_room: true,
        },
      },
      {
        gid: "seed-iyer-chn-3",
        code: "IYER01",
        name: "Iyer Family",
        patch: {
          attending: true,
          headcount: 3,
          functions: ["shaadi", "reception"],
          diet: { veg: 2, jain: 0, nonveg: 0, no_onion_garlic: 1 },
          needs_room: false,
        },
      },
      {
        gid: "seed-patel-range-4",
        code: "PATEL04",
        name: "Patel Family",
        patch: {
          attending: true,
          headcount_range: [3, 5],
          functions: ["sangeet", "shaadi"],
          diet: { veg: 0, jain: 3, nonveg: 0, no_onion_garlic: 0 },
          needs_room: true,
        },
      },
    ];
    for (const s of seeds) {
      const { rsvp } = mergeRsvp(null, s.gid, s.patch, {
        confirmed: true,
        householdCode: s.code,
        householdName: s.name,
      });
      this.rsvps.set(s.gid, rsvp);
    }
  }

  getCard(): WeddingCard {
    return this.card;
  }

  getHousehold(code: string): HouseholdRecord | null {
    return this.households.get(code.toUpperCase()) ?? null;
  }

  getAllHouseholds(): Array<HouseholdRecord & { rsvp_status: "confirmed" | "tentative" | "pending"; headcount: number | null }> {
    return Array.from(this.households.values()).map((h) => {
      const r = h.gid ? this.rsvps.get(h.gid) : undefined;
      const status = r
        ? r.rsvp_complete
          ? "confirmed"
          : "tentative"
        : "pending";
      return {
        ...h,
        rsvp_status: status,
        headcount: r?.headcount ?? null,
      };
    });
  }

  linkHouseholdToGid(code: string, gid: string): HouseholdRecord | null {
    const h = this.households.get(code.toUpperCase());
    if (!h) return null;
    h.gid = gid;
    return h;
  }

  getRsvp(gid: string): GuestRsvp | null {
    return this.rsvps.get(gid) ?? null;
  }

  getAllRsvps(): GuestRsvp[] {
    return Array.from(this.rsvps.values());
  }

  applyRsvpPatch(
    gid: string,
    patch: RsvpPatch,
    options?: { confirmed?: boolean; householdCode?: string | null }
  ): { rsvp: GuestRsvp; becameCompleteFirstTime: boolean; warnings: string[] } {
    const existing = this.rsvps.get(gid) ?? null;
    const h = options?.householdCode ? this.getHousehold(options.householdCode) : null;
    const res = mergeRsvp(existing, gid, patch, {
      confirmed: options?.confirmed,
      householdCode: h?.code ?? existing?.household_code,
      householdName: h?.family_name ?? existing?.household_name,
    });
    this.rsvps.set(gid, res.rsvp);
    return res;
  }

  confirmRsvp(gid: string): { rsvp: GuestRsvp; becameCompleteFirstTime: boolean } | null {
    const existing = this.rsvps.get(gid);
    if (!existing) return null;
    const res = mergeRsvp(existing, gid, {}, { confirmed: true });
    this.rsvps.set(gid, res.rsvp);
    return { rsvp: res.rsvp, becameCompleteFirstTime: res.becameCompleteFirstTime };
  }

  getCatererSummary(): CatererSummary {
    return computeCatererSummary(this.getAllRsvps());
  }

  addUnanswered(
    gid: string,
    question: string,
    language: string,
    reason: "unanswerable" | "grounding_violation"
  ): UnansweredQuestion {
    const entry: UnansweredQuestion = {
      id: `uq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      gid,
      question,
      language,
      reason,
      created_at: new Date().toISOString(),
      resolved: false,
      answered_after_adding: 0,
    };
    this.unanswered.unshift(entry);
    if (this.unanswered.length > 100) this.unanswered.length = 100;
    return entry;
  }

  getUnanswered(): UnansweredQuestion[] {
    return [...this.unanswered];
  }

  resolveUnansweredAndAddToCard(id: string, answer: string): UnansweredQuestion | null {
    const item = this.unanswered.find((u) => u.id === id);
    if (!item) return null;
    item.resolved = true;
    item.added_answer = answer;
    this.card.faqs.push({ q: item.question, a: answer, added_by_host: true });
    return item;
  }

  recordHostFaqHit(questionText: string): void {
    const lower = questionText.toLowerCase();
    for (const uq of this.unanswered) {
      if (!uq.resolved) continue;
      const words = uq.question.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      if (words.some((w) => lower.includes(w))) {
        uq.answered_after_adding += 1;
      }
    }
  }

  recordTurnStats(language: string, level: number): void {
    this.questionsAnsweredCount += 1;
    if (language) {
      this.languagesHeard.add(language.toLowerCase().split("-")[0]);
    }
    if (level > 0) {
      this.guestsServedDuringSurge += 1;
    }
  }

  getJudgeCounters() {
    const summary = this.getCatererSummary();
    return {
      questions_answered: this.questionsAnsweredCount,
      confirmed_rsvps: summary.confirmed_parties,
      languages_heard: Array.from(this.languagesHeard),
      guests_served_during_surge: this.guestsServedDuringSurge,
    };
  }

  addAnnouncement(english: string, translations: Record<string, string>): HostAnnouncement {
    const ann: HostAnnouncement = {
      id: `ann_${Date.now()}`,
      english,
      translations,
      created_at: new Date().toISOString(),
    };
    this.announcements.unshift(ann);
    if (this.announcements.length > 10) this.announcements.length = 10;
    return ann;
  }

  getAnnouncements(): HostAnnouncement[] {
    return [...this.announcements];
  }

  resetDemoState(): void {
    this.card = loadWeddingCard("wedding.yaml");
    this.rsvps.clear();
    this.households.clear();
    this.unanswered = [];
    this.announcements = [];
    this.questionsAnsweredCount = 0;
    this.languagesHeard = new Set<string>(["hinglish", "en-IN"]);
    this.guestsServedDuringSurge = 0;
    this.seedInitialDemoData();
  }
}

export const store = new WeddingStore();
