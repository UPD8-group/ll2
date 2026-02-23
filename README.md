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

Hardcoded in functions: `723a91f3-c306-48fd-b0d7-382ba89fb9a0`
Update if site is recreated.
