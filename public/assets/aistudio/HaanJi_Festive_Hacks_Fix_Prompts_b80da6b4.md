# HaanJi: AI Studio prompts for Festive Hacks fixes

**Event:** Festive Hacks, BIEC Bengaluru, Wed 25 Nov. Submissions close at **5 PM**.
**To be eligible:** the app must actually run, it must use **Sarvam AI + Flagsmith + NudgeBee**, and you need a **public repo + README + demo video**.

## What's missing on the live site (haanji-eight.vercel.app)

| #   | Gap                                                                          | Fix                                 |
| --- | ---------------------------------------------------------------------------- | ----------------------------------- |
| 1   | `/api/capabilities` returns `live_ai:false, flagsmith:false, nudgebee:false` | Prompt 1, plus the manual keys step |
| 2   | Voice is off ("Voice is off on this demo")                                   | Prompt 2                            |
| 3   | A Hinglish question got an English answer (offline fallback)                 | Prompt 3                            |
| 4   | Judges can't see the three sponsor tools working                             | Prompt 4                            |
| 5   | The NudgeBee → Flagsmith loop isn't easy to demo                             | Prompt 5                            |
| 6   | Flagsmith use isn't shown off (second prize is for Flagsmith)                | Prompt 6                            |
| 7   | The page reads as a generic concierge, not a festive-season problem          | Prompt 7                            |
| 8   | There's no README a stranger can set up from                                 | Prompt 8                            |
| 9   | There's no guided demo flow for the video                                    | Prompt 9                            |
| 10  | Final check                                                                  | Prompt 10                           |

Paste **one prompt at a time** into AI Studio (Build). After each one, test the app before moving on.

---

## Prompt 1: Turn on the sponsor integrations and make status honest

```
HaanJi currently reports /api/capabilities = {"live_ai":false,"flagsmith":false,"nudgebee":false}
on the deployed site. I need all three sponsor integrations (Sarvam AI, Flagsmith, NudgeBee)
to switch on correctly once their keys are present.

Please:
1. Find every environment variable the app reads for Sarvam AI, Flagsmith and NudgeBee
   (e.g. SARVAM_API_KEY, the Flagsmith environment/server key, NudgeBee URL/token/webhook).
   List them all, with their exact names, in a new file `.env.example` that has a one-line
   comment above each one saying where to get it.
2. Make /api/capabilities compute each flag from a REAL check, not just "is the key set":
   - live_ai: true only if a tiny Sarvam call (e.g. a 1-word translate) succeeds.
   - flagsmith: true only if fetching flags from Flagsmith succeeds.
   - nudgebee: true only if the NudgeBee endpoint is reachable/authenticated.
   Cache the result for 60 seconds so we don't burn rate limits.
3. Extend the response to include a reason for each, e.g.
   {"live_ai":true,"flagsmith":false,"flagsmith_reason":"FLAGSMITH_ENV_KEY not set", ...}
   Never return secret values.
4. Log one clear startup line per integration: "[HaanJi] Sarvam: ON" / "OFF (reason)".
5. Do not change any existing guest-facing feature or UI layout.
```

**Manual step (you have to do this yourself):** add the keys in **Vercel → Project → Settings → Environment Variables**, set them for Production, then **Redeploy**. If you test inside AI Studio, add the same keys under its Secrets. Then open `/api/capabilities` and confirm all three are `true`.

---

## Prompt 2: Turn voice on (Sarvam speech-to-text + text-to-speech)

```
On the guest page, the "Hold to ask" button shows "Voice is off on this demo. Please type
your question below." I want voice working end-to-end with Sarvam AI when live_ai is true.

Please:
1. When live_ai is true, enable "Hold to ask": record mic audio while held, send it to the
   backend, transcribe with Sarvam speech-to-text, and show the transcript as
   "Heard: <text>" (this line already exists for typed questions).
2. Speak the answer back with Sarvam text-to-speech in the SAME language as the question.
   Add a small play/stop button next to each answer.
3. When "Elder Mode" is ON, auto-play the spoken answer, use a slower voice speed, and
   make the answer text larger.
4. Respect the existing Flagsmith "voice rollout" flag: if the flag says voice is off for
   this guest, show "Voice is paused right now, please type" instead of the button.
5. If the mic permission is denied or Sarvam fails, fall back to typing gracefully, with a
   friendly message in the guest's language. No crashes, no blank states.
6. Keep the "Voice is off" message only for when live_ai is false.
```

---

## Prompt 3: Reply in the guest's language every time (including the offline fallback)

```
Bug: when I ask "Sangeet kitne baje start hoga aur kahan hai?" (Hinglish), the answer comes
back in English: "Sangeet Night is on 28 Nov 2026 at 7:30 PM at Lotus Courtyard, Tamarind Tree."
The language promise is the core of HaanJi, so this must never happen.

Please:
1. Detect the question's language (Hindi, Hinglish, English, Kannada, Tamil). If the
   language selector is not on "Auto Language", use the selected language instead.
2. Live mode (Sarvam on): make sure the final answer is in the detected language. If the
   chat model answers in English, translate it with Sarvam translate before showing it.
3. Offline fallback (Sarvam off): add answer templates for all 5 languages for every card
   fact (event time, venue, dress code, parking/valet, food incl. Jain/veg, RSVP confirmation),
   filled from the wedding card data. Example Hinglish:
   "Sangeet 28 Nov ko shaam 7:30 baje Lotus Courtyard, Tamarind Tree mein hai."
4. Show a small language chip on each answer (e.g. "Hinglish", "ಕನ್ನಡ") so judges can see it.
5. Keep the rule that answers come only from the wedding card. If the card doesn't have the
   answer, say so in the guest's language and offer to pass the question to the family.
6. Test with all 5 sample questions on the page and confirm each answers in its language.
```

---

## Prompt 4: Make the sponsor tools visible to judges

```
Judges must see Sarvam AI, Flagsmith and NudgeBee actually working. The "How HaanJi works"
section already lists them (Sarvam: hears/understands/speaks; Flagsmith: degradation level,
RPM budget, voice rollout, persona experiment; NudgeBee: receives alert, investigates,
asks a human before any flag change).

Please:
1. Turn "How HaanJi works" into a clear 3-card panel, one card per sponsor tool, each with:
   - a live status pill driven by /api/capabilities (green "Live" / grey "Off: <reason>")
   - one sentence on what it does in HaanJi
   - the last real event it handled, e.g. "Sarvam: transcribed a Tamil question 12s ago",
     "Flagsmith: degradation level = 0, persona = warm", "NudgeBee: 1 incident awaiting approval"
2. On each guest answer, add a tiny expandable "Behind this answer" line, e.g.
   "Sarvam STT (ta) → Sarvam chat → Sarvam TTS · Flagsmith persona: warm · Level 0".
3. Update the demo note at the bottom: show "Live AI by Sarvam is ON" when it is on, and keep
   the offline-fallback note only when it is off.
4. Keep the red Indian-wedding theme (maroon #6B1E2E, gold #C9A96E). No sci-fi styling.
```

---

## Prompt 5: Make the NudgeBee → human approval → Flagsmith loop demoable in 60 seconds

```
The Ops Control Plane already has a surge simulator ("A surge sends real guest turns through
the shared Sarvam limiter. Degradation flags change only after a human approves."), a
NudgeBee approval path that calls POST /ops/degrade, and a "Flagsmith Unreachable" fault switch.
I need this to be a clean, reliable 60-second demo.

Please:
1. Add a single "Run Muhurat Rush demo" button on the ops page that:
   a) starts a surge (simulated burst of guest questions during the muhurat at 9:30 AM),
   b) shows the request rate approaching the 60 RPM Sarvam cap on the chart,
   c) fires the alert to NudgeBee and shows "NudgeBee investigating…" then its diagnosis,
   d) waits for human approval (in NudgeBee when configured, otherwise local Approve/Reject),
   e) on approval, NudgeBee calls POST /ops/degrade, the Flagsmith degradation level goes 0 → 1,
      and the guest page visibly switches (e.g. voice paused, shorter text answers),
   f) "End surge" restores level 0.
2. Show a step-by-step timeline on the page (Alert → Investigate → Approve → Flag changed →
   Guests protected) with timestamps, so it reads well in a screen recording.
3. Show the actual Flagsmith flag value before and after, read back from Flagsmith (not local state).
4. Make it safe to run several times in a row. Reset everything cleanly.
5. If NudgeBee is not configured, label the local approval clearly as "local rehearsal" (the
   label already exists) so we never overclaim.
```

---

## Prompt 6: Showcase Flagsmith (for the "Best use of Flagsmith" prize)

```
Second prize is "best use of Flagsmith", so I want our Flagsmith usage to be obvious and solid.
We already use it for: degradation level, RPM budget, voice rollout, and a formal-vs-warm
persona experiment.

Please:
1. Add a "Flags" panel on the ops page listing every Flagsmith flag/remote config HaanJi reads,
   with its current value, what it controls, and when it was last fetched.
2. Persona experiment: assign each guest to "formal" or "warm" via Flagsmith (with guest id as
   the identity), log which arm answered, and show a small results table (answers per arm,
   RSVPs completed per arm). Keep the existing "honest reading" note so we don't overclaim
   from tiny numbers.
3. Voice rollout: use a Flagsmith percentage rollout (e.g. 50% of guests get voice) and show
   which guests are in it.
4. Elder Mode default: add a Flagsmith flag so the family can turn Elder Mode on by default for
   specific guests (e.g. grandparents) without a redeploy.
5. Keep the "Flagsmith Unreachable" fault switch; when it's on, confirm all getters fall back
   to safe defaults (Level 0) and the guest page still works.
6. Put the flag names and defaults in one config file so the README can list them.
```

---

## Prompt 7: Frame it as a festive-season wedding problem

```
The hackathon asks for "one real problem from the festive season (Diwali to New Year)".
HaanJi's problem: during wedding season, families get flooded with the same guest questions
(timings, venue, parking, food, RSVPs) in many languages, and elders struggle with English-only
apps. Make the landing/guest page tell this story in 5 seconds.

Please:
1. Add a short hero line above the schedule, e.g.
   "Wedding season, sorted. Guests ask in their own language. HaanJi answers from the card.
   The family stops answering the same 200 calls."
2. Add a compact 3-step strip: "Ask (voice or text, 5 languages)" → "Answered from the wedding
   card only" → "RSVP confirmed, then sent to the caterer".
3. On RSVP confirmation, show a clear summary card (guests, functions, Jain/veg counts) and
   state that it is sent to the caterer only after the guest confirms (this rule already exists).
4. Keep the existing red Indian-wedding theme with flowers. Mobile-first, since guests open it
   from a WhatsApp link.
5. Don't add new big features. Keep scope narrow.
```

---

## Prompt 8: Write a README someone else can set up from

```
Write a complete README.md for the HaanJi repo (github.com/Nagaraj1399/HaanJi) so a judge
can clone and run it without help. Include:
1. One-paragraph problem + solution (festive wedding season, multilingual guests, card-only
   answers, confirmed RSVPs).
2. Screenshot/GIF placeholders: guest page, voice answer in Tamil, ops page, NudgeBee approval.
3. "How we use the sponsor tools", one section each for Sarvam AI (STT, chat, TTS, translate),
   Flagsmith (every flag, its default, and what it controls), and NudgeBee (alert → investigate
   → human approval → POST /ops/degrade). Include a simple architecture diagram in Mermaid.
4. Setup: prerequisites, clone, install, copy .env.example to .env, where to get each key,
   run locally, deploy to Vercel (env vars + redeploy).
5. How to verify: open /api/capabilities, expect all true, and run the "Muhurat Rush demo".
6. Offline mode: what still works with no keys (the card-only fallback in all 5 languages).
7. API endpoints list (/api/card, /api/capabilities, /api/ops-proxy/*, /ops/degrade, etc.).
8. Team, demo video link placeholder, live URL: https://haanji-eight.vercel.app
9. Known limitations, written honestly.
Write it in plain, short sentences.
```

**Manual step:** make the GitHub repo **public** and paste the demo video link into the README.

---

## Prompt 9: Add a guided demo mode for recording the video

```
Add a hidden "Demo mode" (open with ?demo=1) that helps me record a 2–3 minute demo video.

Please:
1. Show a small floating checklist with these steps, each clickable to jump there:
   1) Hinglish text question: "Sangeet kitne baje start hoga aur kahan hai?"
   2) Kannada voice question about the muhurat (answer spoken in Kannada)
   3) Tamil question (answer in Tamil)
   4) RSVP: "Hum 4 log, 2 Jain, shaadi", confirm, show "sent to caterer"
   5) Elder Mode ON: big text + slower spoken answer
   6) Ops page: Run Muhurat Rush → NudgeBee diagnosis → Approve → Flagsmith level 0→1 →
      guest page degrades gracefully → End surge
   7) Flags panel + persona experiment
2. Tick each step automatically when it is completed.
3. Add a "Reset demo" button that clears demo RSVPs and resets flags to defaults.
4. Demo mode must not change behaviour for normal guests.
```

---

## Prompt 10: Final pre-submission check

```
Do a final pre-submission check of HaanJi and fix anything broken:
1. /api/capabilities: all three integrations report true with the keys set, and the app
   still works (offline fallback) with no keys.
2. All 5 sample questions answer correctly and in the right language, in both live and
   offline mode.
3. Voice works on mobile Chrome (Android) and desktop Chrome; mic-denied falls back to text.
4. RSVP is only sent to the caterer after explicit confirmation.
5. Muhurat Rush demo runs 3 times in a row without errors.
6. No API keys or secrets in frontend code, logs, or the repo; .env is in .gitignore.
7. No console errors on page load; page loads fast on mobile.
8. README setup steps match the actual env var names and scripts.
List what you checked and what you fixed.
```

---

## Advanced features to improve your chances of winning

**Do Prompts 1–10 first.** A working app with all three sponsor tools live beats extra features that are half done.
Then pick **2–3** of the features below, starting with Tier A. Each one is chosen because it does at least one of these:
uses the sponsor tools more deeply, ties HaanJi more tightly to wedding season, or makes a strong moment in the demo video.

| #   | Feature                                                        | Sponsor tools               | Why judges care                                                     | Effort    |
| --- | -------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------- | --------- |
| A1  | Multilingual family announcements (voice + text)               | Sarvam, Flagsmith           | One message reaches every guest in their own language               | ~1 hr     |
| A2  | Family Inbox: HaanJi learns from what it couldn't answer       | Sarvam                      | Shows the "card-only" rule is safe and still useful                 | ~1–1.5 hr |
| A3  | Live caterer headcount + RSVP cutoff                           | Flagsmith                   | Solves a real money problem (wasted food)                           | ~1 hr     |
| A4  | Sarvam cost/abuse incident → NudgeBee cost runbook             | NudgeBee, Flagsmith, Sarvam | Uses NudgeBee's cost-reduction side, not just alerts                | ~1–1.5 hr |
| B1  | Voice Shagun Ledger + thank-you notes in each guest's language | Sarvam                      | Directly matches the organizers' "shagun ledger" example            | ~1.5–2 hr |
| B2  | Venue-proof offline mode (installable, works on weak network)  | —                           | Real wedding-venue problem; strong reliability story                | ~1 hr     |
| B3  | "Wedding Wrapped" summary for the family                       | Sarvam                      | Memorable closing shot for the video; ties to the "Wrapped" example | ~45 min   |

**Recommended pick if time is short:** A1 + A4 + B3. That gives you a deeper use of each sponsor tool and a strong ending for the video.

---

### Prompt A1: Multilingual family announcements

```
Add a "Family Announcements" feature (the app already has announcements with translations,
e.g. announcements[0].translations.ta. Build on that, don't duplicate it).

1. On a family/host page, let the family type OR speak one update in any language,
   e.g. "Baraat 30 minute late hai, 10:00 baje tak aayegi".
2. Use Sarvam to transcribe (if spoken), then translate into Hindi, Hinglish, English,
   Kannada and Tamil, and generate Sarvam text-to-speech audio for each.
3. Show a preview of all 5 versions before sending; the family must click "Send to guests".
4. Guests see a banner in THEIR language at the top of the guest page, with a play button.
   Elder Mode guests get the audio auto-played.
5. Add a Flagsmith flag "announcements_enabled" as a kill switch, and a Flagsmith remote
   config for max announcements per hour (to protect the Sarvam rate limit).
6. Keep the maroon/gold wedding theme.
```

### Prompt A2: Family Inbox (HaanJi learns safely)

```
When HaanJi can't answer from the wedding card, it currently says so. Turn that into a
"Family Inbox":

1. Save every unanswered question with guest name, language, original text and an English
   translation (Sarvam translate).
2. Add a Family Inbox page listing them, grouped by similar questions (e.g. 6 guests asked
   about "Is there a shuttle from the airport?").
3. The family replies once in any language → the reply is added to the wedding card as a new
   fact → every guest who asked gets the answer in their own language (Sarvam translate + TTS).
4. Show on the guest's answer: "Answered by the family".
5. Never let the AI invent the answer. Only family-approved facts get added to the card.
6. Show a counter: "HaanJi answered 92% from the card, the family answered 8%".
```

### Prompt A3: Live caterer headcount + RSVP cutoff

```
Add a "Caterer View" that turns confirmed RSVPs into a live headcount.

1. For each function (Mehendi & Haldi, Sangeet, Muhurat & Shaadi, Reception) show:
   total guests, adults/kids, veg / Jain / non-veg counts, and change since yesterday.
2. Only count RSVPs the guest has explicitly confirmed (this rule already exists).
3. Add a Flagsmith remote config "rsvp_cutoff" per function (date-time). After the cutoff,
   guests see "RSVP closed, please call the family" in their language, and the caterer
   count locks. The family can change the cutoff in Flagsmith without a redeploy.
4. Add a shareable read-only caterer link and a CSV download.
5. Add a simple "food waste avoided" estimate: compare the confirmed count with a typical
   "invite count + 20%" buffer.
```

### Prompt A4: Sarvam cost/abuse incident → NudgeBee cost runbook

```
Extend the Ops Control Plane with a second incident type: "Sarvam spend spike".
(The app already estimates Sarvam calls/min and INR cost and has a 60 RPM limiter.)

1. Track live Sarvam usage: calls/min, estimated INR spent today, and cost per guest answer.
2. Add a Flagsmith remote config "daily_sarvam_budget_inr". When spend is on track to cross
   it (or one guest id sends too many requests, e.g. a stuck loop or a prank), raise an
   incident to NudgeBee with evidence: top guest ids, calls by endpoint (STT/TTS/chat/translate),
   and the projected spend.
3. NudgeBee investigates and recommends a cost runbook, e.g.:
   - switch TTS off for non-elder guests,
   - serve cached answers for repeated questions,
   - rate-limit the noisy guest id.
4. Nothing changes until a human approves (in NudgeBee, or local approval clearly labelled
   "local rehearsal"). On approval, flip the matching Flagsmith flags and show the cost curve
   bending down.
5. Add a "Simulate prank spam" button for the demo, plus a clean reset.
6. Add answer caching: identical question + language → reuse the last answer and audio
   (saves Sarvam calls). Show "cache hit rate" on the ops page.
```

### Prompt B1: Voice Shagun Ledger + thank-you notes

```
Add a private "Shagun Ledger" for the family (family-only page, not visible to guests).

1. The family can speak or type entries in any language, e.g.
   "Sharma uncle ne 5100 diye aur chaandi ka sikka" or "Reddy aunty ₹2,001 cheque".
   Use Sarvam to transcribe and extract: giver name, amount, gift item, function, cash/UPI/cheque.
2. Show each parsed entry for the family to confirm or edit before saving.
3. Show totals by function and by side of the family, and a search box.
4. After the wedding, generate a personal thank-you message for each giver in THEIR preferred
   language (from their guest profile), with a Sarvam TTS voice note, ready to copy into WhatsApp.
   The family reviews each one before it is used. HaanJi never sends anything by itself.
5. Store the ledger only for this wedding, and add a "Delete ledger" button.
6. Add a Flagsmith flag "shagun_ledger_enabled".
```

### Prompt B2: Venue-proof offline mode

```
Wedding venues often have weak mobile network. Make the guest page work offline:

1. Make HaanJi an installable PWA ("Add to home screen") with the wedding name and maroon
   theme color #6B1E2E.
2. Cache the wedding card, schedule, venue map links and the offline answer templates for
   all 5 languages, so common questions still work with no network.
3. Queue RSVPs and questions while offline and send them when the network returns, with a
   clear "Saved, will send when online" message in the guest's language.
4. Show a small "Offline: answers from saved card" pill when there's no connection.
5. Test with Chrome DevTools offline mode.
```

### Prompt B3: "Wedding Wrapped" summary

```
Add a "Wedding Wrapped" screen for the family (inspired by Spotify Wrapped), shown after the
event or via a button on the family page.

1. Animated card-by-card story (tap to advance), in the maroon/gold wedding theme with flowers:
   - questions HaanJi answered, and calls saved for the family
   - languages used (with a breakdown chart), and the most-asked question
   - total guests confirmed per function, veg/Jain split
   - top moment: the busiest minute (e.g. during the muhurat) and how HaanJi handled it
   - Sarvam spend vs. budget, and cache savings
2. A final shareable card image the family can post.
3. Option to narrate the story with Sarvam TTS in the family's chosen language.
4. Use only real data from the app (no made-up numbers). If there's not enough data, use the
   demo data from ?demo=1 and label it "Demo".
```

---

## Pitch tips that cost no code

- **Open with the pain:** "In wedding season, a family gets hundreds of the same calls: what time, where, parking, Jain food. Half the guests are more comfortable in Kannada, Tamil or Hindi than English."
- **Show one guest, then show the scale:** start with a Tamil voice question answered in Tamil, then the Muhurat Rush incident.
- **Name each sponsor tool on screen when it does something.** The judges have to check all three.
- **Say what HaanJi will NOT do:** it won't invent answers, won't send RSVPs without confirmation, and won't change flags without a human. Trust is a strong story.
- **End with Wedding Wrapped** (if you build it) as the final shot of the video.

---

## Manual checklist (AI Studio can't do these)

- [ ] Add the Sarvam / Flagsmith / NudgeBee keys in Vercel env vars, then **Redeploy**
- [ ] `/api/capabilities` shows all three as `true` on the live URL
- [ ] Set up the NudgeBee workflow so its approval calls your `POST /ops/degrade` URL
- [ ] Make the GitHub repo **public**
- [ ] Record a 2–3 min demo video (use `?demo=1`) and add the link to the README
- [ ] Every team member applied and was accepted on Luma
- [ ] Submit before **5 PM, 25 Nov**
