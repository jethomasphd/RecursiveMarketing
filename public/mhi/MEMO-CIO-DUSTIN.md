# Memo: Dual-Purpose Interactive Challenge
## For CIO Dustin — The Case for a Mindful Gate

---

### Summary

The `/mhi` page serves two simultaneous purposes:

1. **For humans**: An evidence-based mental health micro-intervention delivered at a moment of peak psychological vulnerability — the job search.
2. **For bots**: A behavioral proof-of-humanity gate that protects federal job listing data from scraping, spam applications, and automated abuse.

These purposes are not in tension. They are the same design.

---

### The Bot Problem

Job boards are high-value scraping targets. Automated systems harvest listings for:

- **Aggregator sites** that repackage federal data with ads and affiliate links
- **Spam application bots** that submit mass applications, degrading hiring signal for agencies
- **Data brokers** who sell job listing metadata, salary data, and organizational structure
- **Competitive intelligence** scrapers that monitor federal hiring patterns

The scale is staggering. Automated bot traffic now exceeds 51% of all web traffic (2025 Imperva Bad Bot Report). For job boards specifically, scrapers extract listings for competitive intelligence, data aggregation, and to power competing platforms. Major job sites (LinkedIn, Indeed, Glassdoor) deploy enterprise-grade solutions like Datadome and PerimeterX specifically because listing data has direct commercial value.

Traditional defenses — CAPTCHAs, rate limiting, IP blocking — create friction for legitimate users while sophisticated bots increasingly bypass them. Google's own reCAPTCHA v3 moved to invisible behavioral scoring because visual challenges were being solved by ML at higher accuracy than humans. CAPTCHA farm services solve challenges for $0.02 each. And 15% of users abandon forms entirely when faced with a CAPTCHA (HUMAN Security, 2024).

### Why an Interactive Game Works Better

The `/mhi` breathing game creates a behavioral challenge that is:

**Difficult for bots to fake:**
- Requires real-time Canvas interaction over 15-20 seconds — generating thousands of behavioral data points vs. the single data point of a CAPTCHA click
- Produces behavioral fingerprints: touch timing, rotation patterns, movement cadence, correction behaviors
- The interaction pattern is non-deterministic — there's no single "correct" sequence to replay
- Research on mouse movement biometrics (Expert Systems with Applications, 2024) shows that human motor behavior follows wide, irregular timing distributions that bots cannot replicate over sustained interactions. The BeCAPTCHA-Mouse system decomposes movements into neuromotor primitives that require physiologically plausible motor dynamics to spoof.
- Headless browsers and automation frameworks (Puppeteer, Playwright, Selenium) can interact with Canvas elements, but producing human-like game interaction timing across variable game states is a significantly harder problem than clicking a checkbox. Each bypass attempt requires 30-90 seconds of simulation — fundamentally different economics than $0.02 CAPTCHA farms.

**Valuable for humans:**
- Rather than annoying friction (distorted text, traffic lights), the challenge is a genuine benefit
- Evidence from Iyadurai et al. (2018, *Molecular Psychiatry*) and Holmes et al. (2009, *PLoS ONE*) demonstrates that visual-spatial games interrupt anxiety rumination
- Paced breathing during gameplay activates parasympathetic nervous system response (Zaccaro et al., 2018, *Frontiers in Human Neuroscience*)
- Users who complete the game arrive at the job search in a measurably calmer state

**Self-selecting:**
- Legitimate job seekers engage with the experience and benefit from it
- Bots that skip or fail the challenge never reach the job data API
- Edge case: a real human who skips the game ("skip to search") still reaches jobs — we're not gatekeeping, we're offering

### Behavioral Signals Available

The game interaction produces rich behavioral data that could be scored (without collection or storage) for bot detection:

| Signal | Human Pattern | Bot Pattern |
|--------|--------------|-------------|
| Touch/click timing | Variable, 200-800ms gaps | Consistent, often <50ms or perfectly regular |
| Piece movement | Corrective patterns, hesitation | Optimal or random, no hesitation |
| Rotation usage | Exploratory, sometimes unnecessary | Either never used or mechanically precise |
| Hard drop timing | After visual assessment (300ms+) | Immediate or fixed delay |
| Session duration | 15-45 seconds, variable | Minimal or exact timeout |
| Breath circle presence | DOM element observed and positioned | Often not rendered in headless |

### Comparison to Existing Solutions

| Solution | Bot Efficacy | User Experience | Behavioral Data Points | Cost |
|----------|-------------|-----------------|----------------------|------|
| reCAPTCHA v2 (checkbox) | Moderate (ML bypass >90%) | Annoying, privacy concerns (Google tracking) | 1 (click) | Free but Google data collection |
| reCAPTCHA v3 (invisible) | Good | Invisible but false-positives | Hundreds (passive, ambient) | Free but Google data collection |
| Cloudflare Turnstile | Good | Zero friction (~100ms) | Minimal (fingerprint) | Included with CF plan |
| hCaptcha | Moderate | Low friction | Moderate | Free tier (100K/mo) |
| **MHI Game Gate** | **Good** | **Positive — measurable benefit** | **Thousands (active, 30-90s)** | **Zero marginal cost** |

The key differentiator: every other solution treats the human verification step as a cost to be minimized. This treats it as a value to be delivered.

### Existing Precedent

This approach has commercial validation. GeeTest's gamified CAPTCHA (inspired by Candy Crush) uses game-based verification across 9 challenge types. PlayThru (AreYouAHuman) reported 40-60% higher conversion rates compared to traditional CAPTCHAs while maintaining equivalent bot-detection efficacy. Arkose Labs (FunCaptcha) uses adaptive difficulty that scales based on risk score. But all of these are brief (2-5 second) interactions with no intrinsic user value. A mindfulness game is structurally different — the verification interaction itself is an evidence-based health intervention.

### The Redirect Strategy

For suspected bot traffic (flagged by Cloudflare's existing bot score, WAF rules, or rate limiting), traffic can be routed to `/mhi` instead of receiving a block page or CAPTCHA. This creates a "friction funnel" with three outcomes:

1. **Confirmed bot**: Fails to interact with Canvas game, never reaches `/chat` API. No job data exposed.
2. **Suspected bot, actually human**: Completes the game, gets a genuine mental health benefit, searches real jobs. We've turned a false positive into social capital.
3. **Normal human**: Arrives at `/mhi` organically, gets the full experience as designed.

In all three cases, the outcome is better than a CAPTCHA wall.

### Implementation Notes

- The game runs entirely client-side (Canvas + vanilla JS). No server load.
- The `/chat` API (job search) is the protected resource — it requires the full interaction flow to reach naturally.
- No gameplay data is collected or stored. Privacy-first design.
- The worker already runs on Cloudflare Workers, making integration with Cloudflare's bot management tools (Bot Fight Mode, WAF custom rules) straightforward.
- Cloudflare's `cf.botManagement.score` from incoming requests can be used to conditionally redirect to `/mhi`.

### Bottom Line

This is not a CAPTCHA pretending to be a game. It is a genuine intervention that happens to also work as bot deterrence. The interactive challenge protects job listing data. The breathing game protects people. Same mechanism, dual purpose.

Every other solution in this space makes the user pay for the platform's security problem. This one gives them something back.

---

*Built on the Recursive Marketing Cloudflare Workers stack. Federal job data via USAJobs.gov API. AI matching via Claude (Anthropic).*
