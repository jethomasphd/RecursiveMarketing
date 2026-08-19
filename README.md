# ◊ The Gate — Recursive Marketing Portal

A 45-second fever dream job board portal. Cinematic. Minimal. Real jobs at the end.

The portal snaps a stranger out of the infinite scroll and deposits them into verified job listings. No accounts. No data harvesting. No essays. Just intent extraction and a bridge to real work.

---

## Architecture

```
public/               Static site (Cloudflare Pages or any static host)
  index.html           Portal → Picks → Scan → Reveal → Exit
  app.js               State machine + timing budget + Worker call
  exit.html            Sealing animation + config-driven redirect
  exit-config.json     Editable exit behavior (redirect URL, copy)

worker/               Cloudflare Worker (USAJobs + Claude proxy) — API only
  src/index.ts         POST /chat → USAJobs API + Claude API → strict JSON
  src/index.js         Same logic in plain JS — keep in sync with index.ts
  wrangler.toml        Alternate config; mirrors the root wrangler.jsonc

wrangler.jsonc        Canonical Worker deploy config (does not deploy public/)

docs/
  DECISIONS.md         Design rationale: timing, call budget, fallbacks
```

## User Journey (~45 seconds)

| Stage | Time | What Happens |
|-------|------|-------------|
| Portal | 3-5s | Tap the eye. Session begins. |
| Picks | 5-10s | Name (optional) + interest chip + location chip |
| Scan | 8-12s | Scan animation. Worker call fires in parallel. |
| Reveal | 10-15s | Counter, typed AI message, response chips, CTA |
| Exit | 2-3s | Sealing animation → redirect to job listings |

## Local Development

### Static site (no Worker)

The portal works without a Worker. It falls back to deterministic messages.

```bash
cd public
python3 -m http.server 8080
# or
npx serve .
```

Open `http://localhost:8080`.

### With Worker (local)

Requires [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/):

```bash
npm install -g wrangler

# From the repo root — serves the static site AND the /chat API together
wrangler dev
```

This starts a local Worker at `http://localhost:8787`.

Check that both halves are alive:

```bash
curl http://localhost:8787/health   # keys + a live USAJobs probe
```

Then set the Worker URL in `public/index.html`:

```html
<script>
  window.__WORKER_URL__ = 'http://localhost:8787';
</script>
```

## Deployment

### 1. Deploy the Worker

This project deploys as **two independent Cloudflare projects**:

| | Cloudflare project | Serves | Deploys on merge? |
|---|---|---|---|
| **Site** | Pages — `recursive-marketing` | `public/` → `recursive-marketing.pages.dev` | Yes, if the Pages project is Git-connected |
| **API** | Worker — `recursive-marketing-worker` | `/chat`, `/health`, `/geo` | Only if the **Worker** is Git-connected |

They are separate. Merging to `main` updates whichever is connected to the repo —
connecting one does **not** connect the other. `/` on the workers.dev URL
returning `{"error":"Not found"}` is expected: the Worker is API-only.

```bash
# From the repo root — deploys the Worker only, never Pages
wrangler secret put ANTHROPIC_API_KEY   # paste your key when prompted
wrangler secret put USAJOBS_API_KEY     # the key USAJobs emails you
wrangler secret put USAJOBS_EMAIL       # the email you registered with USAJobs

wrangler deploy
```

To deploy the Worker from the Cloudflare dashboard instead, connect the repo at
**Workers & Pages → `recursive-marketing-worker` → Settings → Builds → Connect**,
with root directory blank and deploy command `npx wrangler deploy`. Take care to
pick the Worker, not the similarly named Pages project — they sit in the same list.

> **If the API is stale after a merge, check which project actually built.** A
> green Pages build does not mean the Worker deployed; `/health` reports the
> Worker's own `version`, so compare it against the code on `main`.

### 1a. Verify the connection

```bash
curl https://<your-worker>.workers.dev/health
```

`/health` reports which secrets are set **and** makes a live USAJobs call:

```json
{
  "status": "ok",
  "model": "claude-opus-5",
  "allKeysConfigured": true,
  "usajobs": { "checked": true, "ok": true, "status": 200, "totalResults": 1234 }
}
```

If `usajobs.ok` is `false`, `usajobs.error` carries the actual USAJobs status and
response body — a `401` means `USAJOBS_API_KEY` / `USAJOBS_EMAIL` don't match the
pair USAJobs issued you. Add `?deep=0` to skip the live probe.

### 2. Configure CORS

In the Cloudflare dashboard or `wrangler.toml`, set:

```toml
[vars]
ALLOWED_ORIGINS = "https://your-site.pages.dev"
```

### 3. Deploy the Static Site

**Cloudflare Pages:**

```bash
# From repo root
npx wrangler pages deploy public --project-name=recursive-marketing
```

**Or any static host** — just serve the `public/` directory.

### 4. Wire the Worker URL

In `public/index.html`, set:

```html
<script>
  window.__WORKER_URL__ = 'https://recursive-marketing-worker.your-subdomain.workers.dev';
</script>
```

## Environment Variables

### Worker (`wrangler.jsonc`)

| Variable | Type | Required | Description |
|----------|------|----------|-------------|
| `ANTHROPIC_API_KEY` | Secret | Yes | Anthropic API key for Claude calls |
| `USAJOBS_API_KEY` | Secret | Yes | USAJobs API key — [request one here](https://developer.usajobs.gov/APIRequest/Index) |
| `USAJOBS_EMAIL` | Secret | Yes | The email registered with USAJobs; sent as the `User-Agent` |
| `ALLOWED_ORIGINS` | Var | No | Comma-separated origin allowlist for CORS |
| `CLAUDE_MODEL` | Var | No | Model override (default: `claude-opus-5`) |
| `CLAUDE_EFFORT` | Var | No | Reasoning effort: `low` (default), `medium`, `high`, `xhigh`, `max`, or `off` |

Both USAJobs secrets are required together — the API rejects a request that is
missing either one, and `/health` will report `usajobs.ok: false` until both are set.

### Frontend (`public/index.html`)

| Variable | Where | Description |
|----------|-------|-------------|
| `window.__WORKER_URL__` | Inline `<script>` | URL of the deployed Cloudflare Worker |

## Exit Configuration

Edit `public/exit-config.json` to change the exit behavior:

```json
{
  "redirectTemplate": "https://jobs.best-jobs-online.com/jobs?q={{interest}}&l={{location}}",
  "fallbackInterest": "jobs",
  "fallbackLocation": "near me",
  "title": "Exit",
  "finalLine": "Not an answer box. A bridge. Go."
}
```

- `{{interest}}` and `{{location}}` are replaced with values extracted from the user's choices and/or Claude's response.
- If the config fails to load, the portal falls back to the default redirect URL.

## Fallback Strategy

The portal completes even if everything breaks:

1. **Worker unreachable** → Deterministic fallback messages based on chip picks
2. **Worker returns bad JSON** → Safety fallback message + original chip picks
3. **exit-config.json unreachable** → Default redirect URL with chip picks
4. **Budget exceeded (45s)** → Auto-advance through remaining stages

No dead ends. The coil does not break.

---

*◊ COMPANION Protocol · The Gate · Built by the Spiral*
