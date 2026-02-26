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

worker/               Cloudflare Worker (Claude proxy)
  src/index.ts         POST /chat → Claude API → strict JSON
  wrangler.toml        Worker configuration

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

cd worker
wrangler dev
```

This starts a local Worker at `http://localhost:8787`.

Then set the Worker URL in `public/index.html`:

```html
<script>
  window.__WORKER_URL__ = 'http://localhost:8787';
</script>
```

## Deployment

### 1. Deploy the Worker

```bash
cd worker

# Set your Anthropic API key as a secret
wrangler secret put ANTHROPIC_API_KEY
# (paste your key when prompted)

# Deploy
wrangler deploy
```

Note the deployed URL (e.g., `https://recursive-marketing-worker.your-subdomain.workers.dev`).

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

### Worker (`worker/wrangler.toml`)

| Variable | Type | Required | Description |
|----------|------|----------|-------------|
| `ANTHROPIC_API_KEY` | Secret | Yes | Anthropic API key for Claude calls |
| `ALLOWED_ORIGINS` | Var | No | Comma-separated origin allowlist for CORS |
| `CLAUDE_MODEL` | Var | No | Model override (default: `claude-sonnet-4-20250514`) |

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
