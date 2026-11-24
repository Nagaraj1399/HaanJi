# HaanJi landing page prompt v2: one page, one nav bar

**This replaces** the earlier maroon-on-ivory theme prompt. Don't paste that one. If you already ran it, this prompt overrides it.

## What changed from your original prompt

| Area | Change | Why |
|---|---|---|
| Structure | One single-scroll page with **one** navigation bar shared by every screen. "Ask HaanJi" opens the concierge **inline** on the same page. Host Desk / Ops Control / Test Bench reuse the same nav (no second header or tab bar). | You asked for one page, one nav bar |
| Theme | The dark palace-luxury theme now applies to the whole app, not only the landing page | Consistent look in the demo video |
| Badge + marquee | Added **Hinglish**. Replaced "Sat Sri Akal" (Punjabi isn't supported) with greetings for the 5 supported languages | Don't promise a language HaanJi can't answer in |
| How it works, step 3 | "Your RSVP updates itself" → "Confirm your RSVP, and it reaches the caterer only after you say yes" | Matches the confirmed-RSVP rule |
| New: announcement strip | A thin strip under the nav shows the latest family announcement in the guest's language | Feature A1 |
| New: Elder Mode + language switch | Both live in the nav | Accessibility, multilingual |
| New: RSVP section | RSVP status + cutoff date read from Flagsmith | Feature A3 |
| New: "Calm on the busiest minute" section | Muhurat Rush teaser: Sarvam → NudgeBee → human approval → Flagsmith | Shows all 3 sponsor tools to judges |
| Host Desk teaser | Now lists Announcements, Family Inbox, Caterer headcount, Shagun Ledger, Wedding Wrapped | New features |
| Footer + nav | Live status pills for Sarvam AI / Flagsmith / NudgeBee; offline pill | Judges must see the tools working; feature B2 |
| Images | You attach them in AI Studio, and the prompt tells it where to save them | You're uploading them there |

**Rule built into the prompt:** anything tied to a feature you haven't built yet (Shagun Ledger, Wrapped, etc.) is **hidden automatically** if its endpoint doesn't exist. So you can paste this now, even with some feature prompts still running.

---

## The prompt (paste into AI Studio along with the images)

```
Rebuild HaanJi's front end as ONE single-scroll page with ONE navigation bar.
Mood: quiet Indian wedding luxury (think palace hotel and couture campaign), not glowing tech.
Do not touch server/, data/ or tests. Do not change any API, business logic, feature flags or
data. This is a front-end layout + theme change only. Read data only from existing endpoints
(/api/card, /api/capabilities, announcements, RSVP, ops/judge state, etc.). If an endpoint for
a section below doesn't exist yet, hide that section or element. Never show fake data, and
never hard-code times, venues or names.

=====================================================================
IMAGES (attached in this chat)
=====================================================================
Save the images I attached in this chat into public/assets/landing/ with these exact names,
so they are served at /assets/landing/<name>:
- jaali-light.png  (shaft of light through a carved jaali screen, on black)
- urli.png         (rim of a huge antique brass urli bowl, on black)
- silk.png         (oxblood silk folds with a gold zari border, on black)
- petals.png       (a few crimson rose petals, on black)
- hero-bg.jpg      (full hero background, if attached)
- hero-mobile.jpg  (mobile hero background, if attached)
- hero-loop.mp4    (hero video loop, if attached)
Keep the existing venue painting src/assets/images/sharma_reddy_venue_1795418307752.jpg and
use it in the Venues section. Tell me which attached file you mapped to which name. If an image
is missing, use the stand-in described below.

=====================================================================
ONE PAGE, ONE NAV BAR
=====================================================================
- A single sticky nav bar is used on EVERY screen (landing, Host Desk, Ops Control, Test Bench).
  Remove any other header, top bar or workspace tab bar so there is never more than one nav.
- The landing page is one continuous scroll. Nav links scroll smoothly to sections on the same
  page and update the URL hash (#schedule, #rsvp, #ask, #venues, #faqs, #contacts).
- "Ask HaanJi" scrolls to the #ask section, where the existing Guest Concierge (voice + text,
  language selector, sample questions, answers, RSVP) is embedded INLINE, restyled to this theme.
  Reuse the existing concierge component; don't rebuild its logic.
- "Host Desk" opens the existing Host Desk view. Ops Control and Test Bench are reachable from a
  small "Team" menu at the right end of the same nav (not shown as primary links to guests).
  These views keep the same nav bar and the same dark theme.
- On scroll, the nav gets a dark glass background (rgba(20,5,10,0.7), backdrop blur, 1px gold
  hairline at the bottom, 25% opacity). On mobile it collapses into a full-screen overlay menu.

NAV CONTENT
- Left: "HaanJi" wordmark in Cormorant Garamond, then a thin gold hairline running to the links.
- Links in two small uppercase columns: [Home, Schedule, RSVP, Ask HaanJi] and
  [Venues, FAQs, Contacts, Host Desk]. Highlight the link whose section is in view.
- Right side, in this order:
  1) language switch (Auto, Hindi, Hinglish, English, ಕನ್ನಡ, தமிழ்), small uppercase, gold
     outline. It sets the same language state the concierge already uses.
  2) "Elder Mode" toggle (larger text, slower spoken replies, bigger buttons), using the
     existing Elder Mode state.
  3) "RSVP" as a 1px antique-gold outline pill, which scrolls to #rsvp.
  4) "Team" menu (Ops Control, Test Bench).
  5) When the device is offline, a small pill "Offline · answers from saved card".

ANNOUNCEMENT STRIP (under the nav, only if a family announcement exists)
- Thin strip, dark background, 1px gold hairlines above and below, small ivory text in the
  guest's language, a tiny "▶ Listen" outline pill (uses the announcement's audio if present),
  and a dismiss "×". No colour flashes.

=====================================================================
THEME (whole app)
=====================================================================
- Background: radial gradient from #2B0A12 (centre right) to #14050A (edges).
- Accents: antique gold #B8925A, light gold #E6CFA3. Text: ivory #F5EDE1; secondary text ivory
  at 65%. No bright red, orange, marigold or neon anywhere in the UI.
- Status colours (muted, used only in small pills/dots): live = sage #8FB39A, off = ivory 40%,
  warning = light gold #E6CFA3, error = dusty rose #C98A8A.
- Fonts: Cormorant Garamond (light, 300) for headlines; Plus Jakarta Sans for body and UI.
  Keep Noto Sans Devanagari / Kannada / Tamil as fallbacks so Indian scripts render correctly
  (line-height at least 1.6 for Kannada and Tamil). Nav, badges and small labels in uppercase
  with 0.2em letter-spacing at 11–12px.
- A very subtle film-grain overlay (SVG noise, 4% opacity) over the whole hero.
- Thin 1px antique-gold hairlines (25% opacity) as dividers. Generous spacing: at least 160px
  vertical padding between sections on desktop.
- Glass cards everywhere: background rgba(20,5,10,0.55), backdrop blur, 1px gold border at 20%,
  16px radius, no glow.
- Buttons: primary = solid ivory with dark text; secondary = 1px antique-gold outline with ivory
  text. Both get a visible 1px gold focus ring, min 44px tall (56px in Elder Mode).
- Charts in Host Desk / Ops Control: gold, light gold, ivory, sage and dusty rose only.

=====================================================================
HERO (desktop, full viewport height)
=====================================================================
Left column (about 45% width):
- Small uppercase badge with a 1px gold border: "हिंदी · Hinglish · ಕನ್ನಡ · தமிழ் · English".
- Headline, 2 lines, about 72px, Cormorant Garamond light: "Every question, answered in" +
  "your language". Set "your language" in italic, solid antique gold, no gradient.
- Subtext, built from /api/card (couple/family names, dates, city): "Sharma & Reddy Wedding ·
  28–29 November 2026 · Bengaluru. Simply speak, and HaanJi answers timings, venues, dress codes
  and food, and keeps your RSVP up to date."
- Two buttons: primary "Ask HaanJi" with a thin mic icon (solid ivory, dark text, no glow),
  which scrolls to #ask and focuses the concierge input; secondary "View schedule" (1px
  antique-gold outline), which scrolls to #schedule.

Right column: a dark glass card:
- Top pill showing a guest's voice question with a thin waveform icon:
  "Sangeet kab hai aur dress code kya hai?"
- Reply panel: "Namaste! Sangeet Night is at 7:30 PM on 28 Nov at Lotus Courtyard, Tamarind
  Tree. Dress code: Indo-western shimmer or cocktail festive." Build this text from /api/card
  data (the sangeet function), never hard-coded times.
- Bottom row: a small language chip ("Hinglish → English"), a small outline pill "▶ Play reply"
  (plays Sarvam text-to-speech when live AI is on; hide it when it's off), and a tiny uppercase
  label "Grounded in the wedding card".

HERO IMAGERY (layered; all images on black, use mix-blend-mode: screen so the black disappears)
- Behind the card: /assets/landing/jaali-light.png. Stand-in if missing: a narrow, soft,
  warm-ivory vertical gradient at 35% opacity.
- Bottom left: /assets/landing/urli.png; only the top arc is visible, rising like a planet's
  horizon. Stand-in if missing: a large circle with a thin antique-gold rim gradient and dark
  fill, mostly below the fold.
- Bottom right: /assets/landing/silk.png. Stand-in if missing: a soft blurred burgundy shape.
- Floating: /assets/landing/petals.png. Stand-in if missing: 5 small SVG petal shapes in #6E0F1F.
- If /assets/landing/hero-loop.mp4 exists, play it muted, looped and inline behind everything,
  with /assets/landing/hero-bg.jpg as its poster, and skip the separate layers. If only
  hero-bg.jpg exists, use it as a static background.

MOTION (slow and restrained; turn all of it off with prefers-reduced-motion)
- On load: the urli rises 40px over 1.6s and then stays still; headline lines fade up one after
  another; the card fades in last.
- Petals drift very slowly (20–30s per cycle) with slight mouse parallax.
- The jaali light shaft breathes in opacity (90%↔100%) over 6s.
- The reply text types in once, at a calm pace.
- No shimmer, glow pulses, bounces or sparkles. The mic button may show a slow thin gold ring
  only while actually recording.

=====================================================================
SECTIONS BELOW THE HERO (same page, same dark theme, in this order)
=====================================================================
1. #schedule: Schedule. 4 dark glass cards for Mehendi & Haldi, Sangeet, Muhurat & Shaadi and
   Reception, from /api/card: uppercase date label, function name in Cormorant Garamond, time,
   venue, dress code, a small "Directions" text link using maps_url, and "Add to calendar".

2. #ask: Ask HaanJi. The existing Guest Concierge embedded inline, restyled:
   - big round "Hold to ask" button (ivory ring, dark centre, thin mic icon); hidden with a
     calm "Voice is resting, please type" line when voice is off
   - sample-question chips as gold-outline pills (Hinglish, Kannada, Tamil, English examples)
   - each answer in a glass card with a language chip, "▶ Play" pill, and an expandable
     "Behind this answer" line (e.g. Sarvam speech-to-text → Sarvam chat → Sarvam speech ·
     Flagsmith persona: warm · Level 0)
   - answers the card can't cover say so, and show "Sent to the family" when the question
     goes to the Family Inbox

3. #rsvp: RSVP. The guest's RSVP on record (guests, functions, veg/Jain) in a glass card with
   an "Edit" outline button that uses the existing RSVP flow. Show the cutoff from Flagsmith
   ("RSVPs close 26 Nov, 8 PM") if it exists; after the cutoff show "RSVP closed, please contact
   the family". Small note: "Your RSVP reaches the caterer only after you confirm."

4. How it works: 3 steps with thin-line icons and large light numerals (01, 02, 03):
   "Speak in your language" → "HaanJi answers only from the wedding card" →
   "Confirm your RSVP, and it reaches the caterer only after you say yes".

5. Languages: a slow horizontal marquee of greetings in Cormorant Garamond italic:
   Namaste · Haan ji · Namaskara · Vanakkam · Hello. (Only the 5 supported languages.)

6. #venues: Venues. The venue painting (sharma_reddy_venue_1795418307752.jpg) in a tall frame
   with a thin gold border, plus the venue list from /api/card with "Directions" links.

7. #faqs: FAQs. An accordion built from the wedding card facts (parking/valet, food, dress
   code, kids, gifts). Each item has a small "Ask HaanJi about this" link that pre-fills the
   concierge.

8. "Calm on the busiest minute": a short section for judges and the family, shown only if the
   ops endpoints exist:
   - one line: "When hundreds of guests ask at once during the muhurat, HaanJi slows down
     gracefully, and only after a human approves."
   - a 4-step horizontal flow with thin-line icons: Sarvam AI (hears and answers) → NudgeBee
     (spots the surge, investigates) → Human approval → Flagsmith (switches the degradation
     level)
   - three small status pills from /api/capabilities: "Sarvam AI · Live/Off",
     "Flagsmith · Live/Off", "NudgeBee · Live/Off"
   - outline button "Open Ops Control"

9. For the family: Host Desk teaser listing only the features that exist: Announcements in
   every language, Family Inbox for unanswered questions, live caterer headcount and diet totals,
   private Shagun Ledger, Wedding Wrapped. "Open Host Desk" outline button.

10. #contacts: Footer. Contacts from the wedding card (Guest Hospitality Desk, Transport &
    Valet Lead) with tap-to-call links; a tiny line "Built with Sarvam AI · Flagsmith · NudgeBee"
    with the live status dots; a GitHub link; and a small line "Fictional demonstration data".

=====================================================================
HOST DESK / OPS CONTROL / TEST BENCH
=====================================================================
- Keep all their features and logic. Only restyle them: same nav bar, same background, glass
  cards, gold hairlines, the fonts above, the muted status colours, and the chart palette above.
- Ops Control keeps its "ops room" feel through layout and data density, not through neon or a
  different colour scheme.

=====================================================================
RESPONSIVE
=====================================================================
- Under 768px: stack the headline above the card, headline about 44px, the urli as a thin arc
  behind the buttons, no video, and /assets/landing/hero-mobile.jpg as the background if present.
- The nav collapses to: wordmark + "Ask HaanJi" icon + menu button; the menu opens a full-screen
  dark overlay with all links, language switch, Elder Mode and Team.
- Concierge on mobile: the mic button and text input stay reachable near the bottom of the screen.
- Test at 375px first (guests open the link from WhatsApp), then tablet and desktop.

=====================================================================
ACCESSIBILITY AND PERFORMANCE
=====================================================================
- Contrast meets WCAG AA (check 65% ivory text and gold text on the dark background; raise
  opacity or use light gold #E6CFA3 for small text if needed).
- All buttons and links keyboard-focusable with a visible 1px gold focus ring; skip-to-content
  link; aria-labels on icon-only buttons; announce new answers with aria-live="polite".
- Elder Mode: base text 20px+, 56px buttons, auto-play spoken replies.
- Lazy-load everything below the hero (images, marquee, charts). Load fonts with display=swap.
  Compress images to WebP where possible. Total hero weight under ~1.5 MB on mobile.
- No console errors.

When done: list the files you changed, the image name mapping, and any section you hid because
its endpoint doesn't exist yet.
```

---

## Images to attach in AI Studio

| File name | What it is | Required? |
|---|---|---|
| `jaali-light.png` | Light shaft through a jaali screen, on black | Yes (stand-in otherwise) |
| `urli.png` | Brass urli rim arc, on black | Yes (stand-in otherwise) |
| `silk.png` | Oxblood silk with gold zari, on black | Yes (stand-in otherwise) |
| `petals.png` | Crimson rose petals, on black | Yes (stand-in otherwise) |
| `hero-bg.jpg` | Full hero background / video poster | Optional |
| `hero-mobile.jpg` | Mobile hero background | Optional |
| `hero-loop.mp4` | Hero video loop | Optional |

**Tip:** rename the files to these exact names before you upload them, so AI Studio doesn't have to guess.

## Order with your other prompts

1. Let the currently running feature prompt finish.
2. Paste this prompt with the images.
3. Then carry on with any remaining feature prompts. They'll automatically appear in the sections that were hidden.
