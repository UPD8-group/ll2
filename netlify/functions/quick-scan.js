/**
 * LISTING LENS — Quick Scan
 *
 * Fast, cheap Claude call that reads the listing screenshots and returns
 * structured JSON. Used to fill the skeleton preview while the full report
 * generates in the background. Returns in ~3-5 seconds.
 *
 * Route: POST /api/quick-scan
 * Body:  { sessionId }
 * Returns: JSON with title, price, location, category, etc.
 */

const Anthropic    = require('@anthropic-ai/sdk');
const { getStore } = require('@netlify/blobs');

const SITE_ID = 'b95526e0-71f5-445b-97fb-eac488509a38';

const QUICK_PROMPT = `You are a listing reader. Look at the screenshot(s) and extract key facts.

Return ONLY a JSON object — no markdown, no explanation, just raw JSON:

{
  "title": "full listing title or item name",
  "price": "asking price as shown e.g. $34,990 or $450/week",
  "location": "city/suburb/state as shown",
  "category": "one of: Vehicle, Property, Electronics, Furniture, Fashion, Other — plus subtype e.g. Vehicle / Ute",
  "platform": "marketplace name e.g. Carsales, Domain, Facebook Marketplace",
  "seller_type": "Dealer (new) or Dealer (used) or Private seller or Agent",
  "market_note": "one sentence about typical price range or market context for this type of listing",
  "absent": ["up to 3 things typically shown for this listing type that are missing e.g. Service history not disclosed"],
  "costs": [
    {"label": "Purchase price", "amount": "$XX,XXX"},
    {"label": "Stamp duty (est.)", "amount": "$X,XXX"},
    {"label": "Transfer/registration", "amount": "$XXX"},
    {"label": "First year total (est.)", "amount": "$XX,XXX"}
  ],
  "questions": [
    "One specific question to ask the seller",
    "Another question",
    "A third question"
  ]
}

Use "Not visible" for anything you cannot determine from the screenshots. Return ONLY the JSON.`;

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

    try {
        const body      = JSON.parse(event.body || '{}');
        const sessionId = body.sessionId;
        if (!sessionId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'sessionId required' }) };

        const store = getStore({ name: 'listing-lens-sessions', siteID: SITE_ID, token: process.env.NETLIFY_TOKEN });

        let meta;
        try { meta = await store.get(sessionId + '/meta', { type: 'json' }); } catch (_) { meta = null; }
        if (!meta) return { statusCode: 410, headers, body: JSON.stringify({ error: 'Session expired' }) };

        // Load screenshots (max 2 for speed)
        const screenshots = [];
        const limit = Math.min(meta.screenshotCount, 2);
        for (let i = 0; i < limit; i++) {
            try {
                const blob     = await store.get(sessionId + '/screenshot-' + i, { type: 'arrayBuffer' });
                const blobMeta = await store.getMetadata(sessionId + '/screenshot-' + i);
                if (blob) screenshots.push({
                    base64:   Buffer.from(blob).toString('base64'),
                    mimeType: (blobMeta && blobMeta.metadata && blobMeta.metadata.mimeType) || 'image/jpeg'
                });
            } catch (e) {}
        }

        if (screenshots.length === 0) return { statusCode: 410, headers, body: JSON.stringify({ error: 'No screenshots' }) };

        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const response = await client.messages.create({
            model:      'claude-haiku-4-5-20251001',  // Fast + cheap for quick scan
            max_tokens: 600,
            messages: [{
                role: 'user',
                content: [
                    ...screenshots.map(s => ({
                        type: 'image',
                        source: { type: 'base64', media_type: s.mimeType, data: s.base64 }
                    })),
                    { type: 'text', text: QUICK_PROMPT }
                ]
            }]
        });

        const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');

        // Strip any markdown fences if Claude added them
        const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        let parsed;
        try {
            parsed = JSON.parse(clean);
        } catch (e) {
            // If JSON parse fails, return minimal fallback
            return { statusCode: 200, headers, body: JSON.stringify({ title: 'Reading listing...' }) };
        }

        return { statusCode: 200, headers, body: JSON.stringify(parsed) };

    } catch (err) {
        console.error('Quick scan error:', err.message);
        // Non-fatal — return empty so skeleton stays as shimmer
        return { statusCode: 200, headers, body: JSON.stringify({}) };
    }
};
