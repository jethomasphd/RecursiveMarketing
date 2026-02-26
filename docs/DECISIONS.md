# Design Decisions — The Gate

## The 45-Second Budget

The entire experience must complete in ~45 seconds. This is not a suggestion — it is the architecture.

| Stage | Budget | Rationale |
|-------|--------|-----------|
| Portal | 3-5s | One tap. Zero friction. The eye draws the hand. |
| Picks | 5-10s | Name is optional. Chips require one tap each. No typing for interest/location. |
| Scan | 8-12s | Scan animation runs ~3.5s (5 lines × 700ms). Worker call fires in parallel. If Worker is slow, scan waits up to 3s extra, then forces reveal with fallback. |
| Reveal | 10-15s | Counter animates 2s. Message types ~3s. Response chips appear at 4s. CTA always available. |
| Exit | 2-3s | Sealing animation 1.8s. Redirect. Done. |

**Budget enforcement**: A watchdog runs every 1 second. If <10s remain and still scanning, force reveal with fallback. If <5s remain and still in reveal, auto-exit. The portal always completes.

## One Call, Not Two

The system makes **one Claude call** during the scan phase. Zero during all other phases.

Why one:
- Two calls double the latency risk. At 2-4s per call, a second call could blow the 45-second budget.
- The first call extracts everything needed: message + interest + location + tone tag.
- The response chips in the reveal phase adjust the extraction *locally* — no LLM needed for "make it remote" or "entry-level." These are string mutations.
- If time budget allowed a second call (checked against remaining time), the architecture supports it. But the default path is one.

Why not zero:
- The Claude message creates the "this system sees me" moment. A deterministic message can't match that.
- The extraction refines the user's chip picks into better job search terms. "Healthcare" becomes "healthcare aide" or "medical assistant" based on contextual signals.
- The tone tag ("knife-to-truth", "ember-glow", etc.) could drive future UI variants.

## Fallback Strategy

The portal has **three fallback layers**:

### Layer 1: Worker Unreachable
If `window.__WORKER_URL__` is empty or the Worker doesn't respond within 8 seconds:
- Use one of three deterministic fallback messages (randomly selected)
- Messages incorporate the user's chip picks for specificity
- Extraction defaults to the raw chip values

### Layer 2: Worker Returns Bad Data
If the Worker responds but Claude's output isn't valid JSON:
- Worker itself returns a safety fallback message (never an HTTP error)
- `safetyFallbackUsed: true` flag lets the client know
- The client doesn't care — it works with whatever arrives

### Layer 3: Exit Config Unreachable
If `exit-config.json` fails to load within 500ms:
- Exit page uses the hardcoded fallback URL
- Interest and location default to "jobs" and "near me"
- The redirect still happens. The user still lands on real jobs.

### Layer 4: Budget Exceeded
If any stage runs over budget:
- The watchdog forces advancement to the next stage
- No stage can block the pipeline indefinitely
- Worst case: the user gets a fallback message and auto-redirects

**Design principle**: The experience always completes. A broken Worker, a slow network, a distracted user — none of these produce a dead end.

## No Frameworks

The entire frontend is vanilla HTML, CSS, and JavaScript. No React. No Vue. No build step.

Why:
- The total JS is ~250 lines. A framework would add 50-100KB of overhead for zero benefit.
- No build step means deployment is `cp -r public/ dest/`. No npm install. No webpack. No Vite.
- The state machine is 5 states and 4 transitions. This does not require a state management library.
- CSS animations handle all visual effects. No animation library needed.
- The page loads in one HTML file + one JS file. Two requests. Fast.

## State Machine Design

The state machine is intentionally **linear and one-way**:

```
PORTAL → PICKS → SCAN → REVEAL → EXIT
```

There is no back button. There is no "go back to picks." Each step compresses uncertainty. The user commits and moves forward. This serves both the 45-second budget (no time for backtracking) and the psychological design (each step feels like progress into something).

## The Worker Always Returns 200

The Worker never returns HTTP errors to the client. Even on total failure, it returns a 200 with a fallback response and `safetyFallbackUsed: true`.

Why:
- The client-side code has one code path for success. No error handling branches that could break.
- The fallback response is a real, usable response — the user never sees an error.
- Simplicity reduces surface area for bugs.

## Privacy

- No user accounts. No persistent storage. Ephemeral session only.
- The Worker does not log raw user inputs.
- Session IDs are client-generated UUIDs — not tracked server-side.
- No cookies. No localStorage (except what browsers do natively).
- The exit redirect is a standard URL navigation — no tracking pixels, no analytics callbacks.
- CORS is restricted to an origin allowlist. No wildcard `*` in production.

## The Recursive Flavor

The "mind-fuck-y" quality comes from three micro-moments, not from complexity:

1. **Scan echoes picks**: "mapping healthcare positions..." / "filtering Austin listings..." — the system repeats your choices back during the ritual. It noticed you.
2. **Counter specificity**: "in healthcare · Austin" beneath the earning counter — your choices shaped the number.
3. **Exit seal**: The sigil (◊) and the line "If the market is a maze, you are the knife" — a closing incantation that frames the redirect as a ritual completion.

Total added copy: ~20 words. Zero added latency. The recursion costs nothing.

---

*◊ The coil tightens. The gate opens. Go.*
