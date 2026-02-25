/**
 * LISTING LENS — Stream Report
 *
 * Streams Claude's response token-by-token via Server-Sent Events.
 * Browser receives the HTML report as it's generated — user sees it build live.
 *
 * Route: POST /api/stream-report
 * Body:  { sessionId, paymentIntentId }
 *
 * SSE events:
 *   data: {"type":"chunk","text":"..."}   — HTML fragment
 *   data: {"type":"done","reportId":"LL-XXXXX"}
 *   data: {"type":"error","message":"..."}
 */

const Anthropic    = require('@anthropic-ai/sdk');
const fs           = require('fs');
const path         = require('path');
const { getStore } = require('@netlify/blobs');

const SITE_ID = 'b95526e0-71f5-445b-97fb-eac488509a38';

function blobStore() {
    return getStore({ name: 'listing-lens-sessions', siteID: SITE_ID, token: process.env.NETLIFY_TOKEN });
}

function loadPrompt(filename) {
    const locations = [
        path.join(process.cwd(), 'prompts', filename),
        path.join(__dirname, '..', '..', 'prompts', filename),
    ];
    for (const p of locations) {
        try { return fs.readFileSync(p, 'utf-8'); } catch (_) {}
    }
    return null;
}

async function verifyPayment(paymentIntentId) {
    if (process.env.BETA_MODE === 'true') return { valid: true };
    if (!paymentIntentId) return { valid: false, reason: 'No payment intent ID' };
    try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (intent.status !== 'succeeded') return { valid: false, reason: 'Payment not succeeded' };
        if (![200, 500, 1000].includes(intent.amount)) return { valid: false, reason: 'Invalid amount' };
        if (intent.currency !== 'aud') return { valid: false, reason: 'Wrong currency' };
        if (intent.metadata && intent.metadata.report_generated === 'true') return { valid: false, reason: 'Already used' };
        await stripe.paymentIntents.update(paymentIntentId, {
            metadata: Object.assign({}, intent.metadata, { report_generated: 'true' })
        });
        return { valid: true };
    } catch (err) {
        return { valid: false, reason: err.message };
    }
}

exports.handler = async (event) => {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const store = blobStore();

    try {
        const body      = JSON.parse(event.body || '{}');
        const sessionId = body.sessionId;
        const paymentId = body.paymentIntentId;

        if (!sessionId) {
            return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'sessionId required' }) };
        }

        // Verify payment
        const payment = await verifyPayment(paymentId);
        if (!payment.valid) {
            return { statusCode: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Payment verification failed: ' + payment.reason }) };
        }

        // Load session
        let meta;
        try { meta = await store.get(sessionId + '/meta', { type: 'json' }); } catch (_) { meta = null; }
        if (!meta) {
            return { statusCode: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Session expired', message: 'Please re-upload your screenshots.' }) };
        }

        // Load screenshots
        const screenshots = [];
        for (let i = 0; i < meta.screenshotCount; i++) {
            try {
                const blob     = await store.get(sessionId + '/screenshot-' + i, { type: 'arrayBuffer' });
                const blobMeta = await store.getMetadata(sessionId + '/screenshot-' + i);
                if (blob) screenshots.push({
                    base64:   Buffer.from(blob).toString('base64'),
                    mimeType: (blobMeta && blobMeta.metadata && blobMeta.metadata.mimeType) || 'image/jpeg'
                });
            } catch (e) { console.warn('Screenshot ' + i + ' missing:', e.message); }
        }

        if (screenshots.length === 0) {
            return { statusCode: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Screenshots expired or missing' }) };
        }

        // Load prompt
        let systemPrompt = loadPrompt('fast-universal-v2.md');
        if (!systemPrompt) {
            return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Prompt file missing' }) };
        }

        const reportId = 'LL-' + Math.random().toString(36).substring(2, 7).toUpperCase();
        const today    = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
        systemPrompt  += '\n\n---\nReport ID: ' + reportId + '\nDate: ' + today + '\nScreenshots: ' + screenshots.length + '\n\nOutput ONLY valid HTML starting with <!DOCTYPE html>. No markdown, no code fences.';

        // Stream from Claude
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const stream = await client.messages.stream({
            model:      'claude-sonnet-4-6',
            max_tokens: 6000,
            system:     systemPrompt,
            messages:   [{
                role: 'user',
                content: [
                    ...screenshots.map(s => ({ type: 'image', source: { type: 'base64', media_type: s.mimeType, data: s.base64 } })),
                    { type: 'text', text: 'Analyse this listing and generate the complete Listing Lens buyer intelligence report as standalone HTML.' }
                ]
            }]
        });

        // Collect full HTML while streaming
        let fullHtml = '';
        const chunks = [];

        for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                const text = event.delta.text;
                fullHtml += text;
                chunks.push(JSON.stringify({ type: 'chunk', text }));
            }
        }

        chunks.push(JSON.stringify({ type: 'done', reportId }));

        // Cleanup screenshots
        try {
            const deletes = [];
            for (let i = 0; i < meta.screenshotCount; i++) deletes.push(store.delete(sessionId + '/screenshot-' + i));
            deletes.push(store.delete(sessionId + '/meta'));
            await Promise.all(deletes);
        } catch (_) {}

        // Return as SSE body — Netlify doesn't support true streaming but
        // we return all chunks at once, which the client reassembles.
        // For true streaming, this function would need to be replaced with
        // an edge function. This approach gives the same result with a single
        // response delivery — client animates the assembly.
        const sseBody = chunks.map(c => 'data: ' + c).join('\n\n') + '\n\n';

        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'X-Report-Id': reportId,
            },
            body: sseBody
        };

    } catch (err) {
        console.error('Stream error:', err.message);
        const errBody = 'data: ' + JSON.stringify({ type: 'error', message: err.message || 'Unknown error' }) + '\n\n';
        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' },
            body: errBody
        };
    }
};
