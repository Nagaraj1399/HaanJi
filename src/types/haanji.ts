export interface WeddingFunctionItem {
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
}

export interface WeddingContact {
  role: string;
  name: string;
  note: string;
  phone?: string;
}

export interface WeddingCardData {
  wedding: {
    id: string;
    title: string;
    subtitle: string;
    dates: string;
    city: string;
    demo_notice: string;
  };
  functions: WeddingFunctionItem[];
  logistics: {
    parking: string;
    shuttle: string;
    contacts: WeddingContact[];
  };
  faqs: Array<{ q: string; a: string }>;
}

export interface GuestRsvp {
  gid: string;
  household_code?: string | null;
  household_name?: string | null;
  attending: boolean | null;
  headcount: number | null;
  headcount_range: [number, number] | null;
  functions: string[];
  diet: { veg: number; jain: number; nonveg: number; no_onion_garlic: number };
  needs_room: boolean | null;
  confirmed: boolean;
  rsvp_complete: boolean;
  warnings: string[];
}

export interface HouseholdInfo {
  code: string;
  family_name: string;
  preferred_language: string;
  age_band: "standard" | "elder";
}

export interface AnnouncementItem {
  id: string;
  english: string;
  translations: Record<string, string>;
  audio_base64?: string;
  audio_mime?: string;
  created_at: string;
}

export interface CapabilitiesSummary {
  live_ai: boolean;
  live_ai_provider: "sarvam" | "gemini" | "none";
  live_ai_reason: string;
  sarvam: boolean;
  sarvam_reason: string;
  gemini: boolean;
  gemini_reason: string;
  flagsmith: boolean;
  flagsmith_reason: string;
  nudgebee: boolean;
  nudgebee_reason: string;
  checked_at: string;
  last_events: {
    sarvam: { summary: string; ts: string | null };
    flagsmith: { summary: string; ts: string | null };
    nudgebee: { summary: string; ts: string | null };
  };
}

export interface CardApiState {
  card: WeddingCardData;
  level: 0 | 1 | 2;
  household: HouseholdInfo | null;
  elder_mode_default: boolean;
  voice_rollout_included: boolean;
  voice_rollout_pct: number;
  voice_paused: boolean;
  rsvp: GuestRsvp | null;
  announcements: AnnouncementItem[];
  rsvp_cutoff?: string | null;
  rsvp_closed?: boolean;
}
