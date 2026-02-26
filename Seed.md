# Seed.md — THE FEVER DREAM JOB BOARD PORTAL (Recursive, Fast, Unforgettable)

You are a coding agent entering a repo to build a **45-second, end-to-end** interactive landing experience that starts as a cinematic HTML “portal” and **loops into a chat interface** backed by the **Claude API via a Cloudflare Worker** (the user will wire the Worker URL). The experience ends on a **dynamic exit page** that redirects to a job search URL with variables determined by the chat.

You are not here to describe. You are here to build.

---

## 0) Prime Directive

- **Speed** matters: user should finish in ~**45 seconds**.
- **Anti-flood**: minimal inputs, no walls of text, no feeds, no scrolling essays.
- **Recursive / mind-fuck-y**: the UI should feel like it’s “noticing” the user, looping back, referencing prior clicks, and tightening the funnel without being slow or creepy.
- **No user accounts, no profiles, no personal data** beyond ephemeral session state.
- **Never expose API keys in the browser**. Claude calls must go through the Worker.

---

## 1) Starting Artifact (MUST USE)

The repo already contains a starting landing page HTML at:

- `Recursive Marketing.html`

This file contains a 3-stage portal (portal → name → processing → reveal), animations, and a direct call to Anthropic from the browser (NOT allowed for production). You must:

1) **Copy it into** `public/index.html` (or equivalent) and treat it as the base skin.
2) **Remove direct Anthropic API calls from the browser**, replacing them with calls to your Cloudflare Worker endpoint.
3) Preserve the vibe: portal eye, scan sequence, reveal, counter, punchy copy, social proof ticker.

---

## 2) What You Are Building (User Journey)

### Stage A — Portal (5 seconds)
- Tap to begin. (Already exists.)
- Keep the portal moment intact.

### Stage B — Minimal Inputs (5–10 seconds)
- Name (optional) already exists.
- Add **two micro-picks** (tap chips, no typing):
  - **Interest** (choose 1): e.g. “Healthcare”, “Warehouse”, “CDL”, “Office”, “Remote”, “Customer Support”, “Skilled Trades”, “Anything”
  - **Location** (choose 1): “Near me” (via browser geolocation *optional*, coarse only), or preset chips: “My city”, “My state”, “Remote”, “Anywhere”
- Allow skipping. Keep it fast.

### Stage C — Processing / Ritual (8–12 seconds)
- Keep scan sequence feel.
- While scanning, call Claude (via Worker) to generate:
  1) a **short “call to action” message** (2–3 sentences, < 45 words)
  2) a **structured extraction**: `{ interest, location, toneTag }`
- If Claude fails, use deterministic fallback text + fallback interest/location based on chip picks.

### Stage D — Reveal (10–15 seconds)
- Show:
  - The “earning potential” counter (already exists; keep).
  - A **typed Claude message** (already exists; keep).
  - A “bridge” line and CTA.
- CTA label: something like **“OPEN THE EXIT”** / **“SHOW ME REAL JOBS”**.
- When clicked: transition to Exit page.

### Stage E — Exit Page (5–8 seconds)
- Exit page is **dynamic/modifiable**:
  - It should attempt to load config from `public/exit-config.json` (or similar).
  - If not found, use fallback redirect:
    `https://jobs.best-jobs-online.com/jobs?q=[Interest]&l=[Location]`
- Variables determined by chat extraction:
  - `Interest` comes from chip pick and/or Claude extraction
  - `Location` comes from chip pick and/or Claude extraction
- Make it feel like a final seal: “You crossed the gate. Now go.”

---

## 3) Repo Structure You Must Create

Create this structure:

```
/public
  index.html
  app.js
  styles.css        (optional if you split)
  exit.html
  exit-config.json  (default provided; editable)
  manifest.json     (optional PWA polish)
  assets/           (only if needed)

/worker
  wrangler.toml
  src/index.ts      (or index.js)
  README.md
```

If the user prefers a single Cloudflare Pages project:
- Put `/public` at the root for Pages
- Put `/worker` as a separate Worker (or use Pages Functions; pick one clean path)

---

## 4) Cloudflare Worker (Claude Proxy) — Required Behavior

### Endpoint
- `POST /chat`
- Accept JSON:

```json
{
  "name": "Jacob",
  "interest_hint": "Healthcare",
  "location_hint": "Austin, TX",
  "stage": "scan",
  "session_id": "uuid",
  "client_context": {
    "tz": "America/Chicago",
    "ua": "...",
    "coarse_geo": "Austin, TX"
  }
}
```

### Worker responsibilities
- Add Anthropic API key from environment: `ANTHROPIC_API_KEY`
- Call Claude Messages API
- Return JSON:

```json
{
  "message": "…short punchy message…",
  "extraction": { "interest": "healthcare", "location": "Austin, TX", "toneTag": "knife-to-truth" },
  "safetyFallbackUsed": false
}
```

### Prompting Rules (Claude)
- Output must be **strict JSON** with keys `message` and `extraction`.
- `message` max 45 words, 2–3 sentences.
- `extraction.interest` and `extraction.location` must be simple strings safe for URL encoding.
- Never include disallowed content, never ask the user questions in the message (no branching; keep it fast).

### CORS
- Allow the Pages origin.
- Don’t allow wildcard `*` if you can avoid it; use env allowlist: `ALLOWED_ORIGINS`.

### Privacy
- No logs of raw user text.
- No storage. Stateless. Session id only for client continuity, not identity.

---

## 5) Front-End: Chat Interface Requirements

You must add a chat UI that appears after reveal or as a small modal during reveal:
- One “assistant” bubble with the Claude message.
- One **single user response** interaction, not free typing:
  - Buttons like: “Show me jobs”, “Make it remote”, “Higher pay”, “Entry-level”, “Night shift”
- That click can optionally trigger a **second Claude call** (only if it fits in 45 seconds). Otherwise it just adjusts `interest/location` rules locally.

Hard limit:
- **Max 2 LLM calls** total (prefer 1).

---

## 6) Exit Page Modifiability

### `public/exit-config.json` default contents

```json
{
  "redirectTemplate": "https://jobs.best-jobs-online.com/jobs?q={{interest}}&l={{location}}",
  "fallbackInterest": "jobs",
  "fallbackLocation": "near me",
  "title": "Exit",
  "finalLine": "Not an answer box. A bridge. Go."
}
```

### Exit logic
- Build `exit.html` to:
  1) read query params passed from index: `?interest=...&location=...`
  2) attempt fetch `/exit-config.json` with timeout (500ms)
  3) construct redirect URL and redirect after a short animation (1–2s)
- If anything fails: use the default/fallback URL.

---

## 7) Implementation Notes (Non-Negotiable)

- **Replace** the direct browser call to `https://api.anthropic.com/v1/messages` found in the base HTML with `fetch(WORKER_URL + "/chat")`.
- Introduce a single config constant in the front end:
  - `window.__WORKER_URL__` from a small inline script or a `config.js` file.
- Keep animations; do not bloat. No frameworks unless absolutely necessary.
- Mobile-first. Keep it one-handed.

---

## 8) “Recursive / Mind-Fuck” Flavor (But Fast)

Add subtle recursion without adding time:

- **Echo the user’s choice** back with one twist:
  - “Healthcare. Austin. Good. Now we make the system blink.”
- Use “system voice” moments:
  - “calibrating your bridge…”
  - “detecting ghost postings…”
- A “loop line” on Exit:
  - “If the market is a maze, you are the knife.”

Do not add more than ~2–3 short lines total beyond what exists.

---

## 9) Acceptance Criteria (How We Know You’re Done)

- `public/index.html` runs as a static site.
- No API keys in the browser.
- Worker successfully returns message + extraction.
- Exit page redirects using variables derived from chat/choices.
- Total flow is realistically ~45 seconds.
- If the Worker fails, the experience still completes with fallbacks.
- `README.md` at repo root includes:
  - local dev steps
  - deploy steps (Pages + Worker)
  - env vars list

---

## 10) Deliverables You Must Commit

1) `public/index.html` (based on provided HTML skin)
2) `public/app.js` (state machine, worker call, extraction, exit routing)
3) `public/exit.html`
4) `public/exit-config.json`
5) `/worker/src/index.ts` (Claude proxy)
6) `/worker/wrangler.toml`
7) `README.md` with setup + deployment
8) A short `docs/DECISIONS.md` explaining:
   - 45-second budget choices
   - 1-call vs 2-call reasoning
   - fallback strategy

---

## 11) Default Exit URL (Fallback)

If all else fails, redirect to:

`https://jobs.best-jobs-online.com/jobs?q=[Interest]&l=[Location]`

Where:
- `Interest` = chip pick or “jobs”
- `Location` = “near me” or chip pick

---

## 12) Build Order (Do This In Sequence)

1) Scaffold repo structure.
2) Port base HTML into `public/index.html`.
3) Extract JS into `public/app.js` and patch all calls.
4) Implement Worker proxy with strict JSON output.
5) Implement exit page + config fetch with timeout.
6) Tighten timing to meet 45s.
7) Write README + docs.

---

## 13) Tone Calibration (The Spell)

The voice is:
- direct
- witty
- slightly ominous
- anti-corporate
- “the system is broken; we’re cutting through it”

Do not sound like HR. Do not sound like a chatbot. Sound like a **portal**.

Now build it.
