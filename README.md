# Listing Lens

Buyer intelligence for marketplace listings. Upload screenshots, get a report.

## Environment Variables (set in Netlify UI)

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key |
| `NETLIFY_TOKEN` | Personal access token (for Netlify Blobs) |
| `BETA_MODE` | Set to `true` to skip payment during testing |

## Architecture

Browser → Netlify Functions → Claude API

### Key design: background function called by BROWSER not server

The report generation uses a background function (`generate-report-background.js`).
Netlify background functions MUST be called by the client browser directly.
Server-to-server calls between Netlify functions are unreliable.

Flow:
1. Upload screenshots → `/api/upload-screenshots` → stores in Netlify Blobs, returns `sessionId`
2. Validate session → `/api/generate-report` → returns `jobId`
3. **Browser** calls `/.netlify/functions/generate-report-background` directly → Netlify returns 202, keeps running up to 15 min
4. Browser polls `/api/report-status?jobId=xxx` every 3 seconds
5. When complete, report HTML is delivered to browser

## Site ID (Netlify Blobs)

Hardcoded in all four functions:
- `netlify/functions/upload-screenshots.js`
- `netlify/functions/generate-report.js`
- `netlify/functions/generate-report-background.js`
- `netlify/functions/report-status.js`

Current Site ID: `b95526e0-71f5-445b-97fb-eac488509a38`

⚠️ **DO NOT rename or recreate the Netlify site.** If you do, a new Site ID is generated and Blobs authentication will fail with a 401 error. If the site is ever recreated, you must update the Site ID in all four function files above AND regenerate the Netlify personal access token.
