import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as yaml from "js-yaml";
import type { FunctionId, PersonaArm, WeddingCard } from "./types.ts";

export const SARVAM_RPM_HARD_CAP = 55;
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_AUDIO_SECONDS = 30;
export const TTS_SUPPORTED_LANGS = new Set([
  "hi-IN",
  "en-IN",
  "bn-IN",
  "gu-IN",
  "kn-IN",
  "mr-IN",
  "pa-IN",
  "ta-IN",
  "te-IN",
  "ml-IN",
  "od-IN",
]);

export const VALID_FUNCTION_IDS: FunctionId[] = [
  "mehendi",
  "sangeet",
  "shaadi",
  "reception",
];

// Random startup tokens when not set via env — zero literal fallback token in source or bundle
export const HOST_KEY =
  process.env.HAANJI_HOST_KEY || crypto.randomBytes(16).toString("hex");
export const OPS_TOKEN =
  process.env.HAANJI_OPS_TOKEN || crypto.randomBytes(16).toString("hex");
export const SESSION_HMAC_SECRET = crypto.randomBytes(24).toString("hex");

export const PERSONAS: Record<
  PersonaArm,
  { voiceName: string; styleInstruction: string; label: string }
> = {
  formal: {
    voiceName: "Kore",
    label: "Formal (Respectful Aap)",
    styleInstruction:
      "Speak respectfully using 'aap' in Hindi/Hinglish and polite honorifics in Kannada/Tamil/English. Use clear, complete, dignified sentences.",
  },
  warm: {
    voiceName: "Puck",
    label: "Warm (Family-style)",
    styleInstruction:
      "Speak like a warm, joyful close family member ('Arre aap toh aa hi rahe ho na!'). Keep it friendly, lively, and concise.",
  },
};

export const SAFE_PHRASES: Record<string, string> = {
  en: "I don't have that exact detail on the wedding card yet. I've forwarded your question to the Sharma & Reddy family desk and they'll update it shortly.",
  hi: "इसकी पक्की जानकारी अभी शादी के कार्ड में नहीं है। मैंने आपका सवाल परिवार के होस्ट डेस्क को भेज दिया है, वे जल्द अपडेट करेंगे।",
  hinglish:
    "Iska pakka detail abhi wedding card par nahi hai. Maine aapka sawaal family host desk ko bhej diya hai, woh jaldi update karenge.",
  kn: "ಈ ನಿಖರವಾದ ಮಾಹಿತಿ ಇನ್ನೂ ಮದುವೆ ಕಾರ್ಡ್‌ನಲ್ಲಿಲ್ಲ. ನಿಮ್ಮ ಪ್ರಶ್ನೆಯನ್ನು ಕುಟುಂಬದ ಹೋಸ್ಟ್ ಡೆಸ್ಕ್‌ಗೆ ಕಳುಹಿಸಿದ್ದೇನೆ.",
  ta: "இந்தத் தகவல் இன்னும் திருமண அழைப்பிதழில் இல்லை. உங்கள் கேள்வியை குடும்ப ஹோஸ்ட் டெஸ்கிற்கு அனுப்பியுள்ளேன்.",
};

export function getSafePhrase(lang: string): string {
  const norm = lang.toLowerCase();
  if (norm.startsWith("kn")) return SAFE_PHRASES.kn;
  if (norm.startsWith("ta")) return SAFE_PHRASES.ta;
  if (norm.startsWith("hi") && !norm.includes("hinglish")) return SAFE_PHRASES.hi;
  if (norm.includes("hinglish")) return SAFE_PHRASES.hinglish;
  return SAFE_PHRASES.en;
}

export function loadWeddingCard(filename = "wedding.yaml"): WeddingCard {
  const fullPath = path.resolve(process.cwd(), "data", filename);
  const raw = fs.readFileSync(fullPath, "utf-8");
  return yaml.load(raw) as WeddingCard;
}

export function formatCardForPrompt(card: WeddingCard): string {
  const fnLines = card.functions.map(
    (f) =>
      `- [${f.id}] ${f.name} (HI: ${f.name_hi || f.name}, KN: ${f.name_kn || f.name}, TA: ${f.name_ta || f.name}) | Date: ${f.date} | Time: ${f.time} | Venue: ${f.venue} (KN: ${f.venue_kn || f.venue}, TA: ${f.venue_ta || f.venue}) | Dress: ${f.dress_code} | Menu: ${f.menu.map((m) => `${m.item} [${m.tags.join(",")}]`).join("; ")}`
  );
  const faqLines = card.faqs.map((f) => `Q: ${f.q}\nA: ${f.a}`);
  const contactLines = card.logistics.contacts.map(
    (c) => `${c.role}: ${c.name} (${c.note})`
  );
  return [
    `WEDDING: ${card.wedding.title} (${card.wedding.subtitle}), ${card.wedding.dates}, ${card.wedding.city}`,
    `FUNCTIONS:\n${fnLines.join("\n")}`,
    `LOGISTICS:\nParking: ${card.logistics.parking}\nShuttle: ${card.logistics.shuttle}\nContacts: ${contactLines.join("; ")}`,
    `FAQS:\n${faqLines.join("\n")}`,
  ].join("\n\n");
}
