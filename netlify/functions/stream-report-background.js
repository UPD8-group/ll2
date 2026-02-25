/**
 * LISTING LENS — Stream Report Background Function
 *
 * Background function that runs Claude and stores result in Blobs.
 * Returns 202 immediately (Netlify requirement for background functions).
 * Frontend polls /api/report-status for completion.
 *
 * Route: POST /.netlify/functions/stream-report-background
 * Body:  { sessionId, paymentIntentId, jobId }
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
    // Background functions MUST return 202 immediately
    // All work happens after this return (Netlify keeps the function running)

    const store = blobStore();
    let jobId = null;

    try {
        const body      = JSON.parse(event.body || '{}');
        jobId           = body.jobId;
        const sessionId = body.sessionId;
        const paymentId = body.paymentIntentId;

        if (!jobId || !sessionId) {
            console.error('Missing jobId or sessionId');
            return { statusCode: 202 };
        }

        console.log('Job ' + jobId + ': starting');
        await store.setJSON('job/' + jobId, { status: 'processing', startedAt: new Date().toISOString() });

        // Verify payment
        const payment = await verifyPayment(paymentId);
        if (!payment.valid) {
            console.error('Job ' + jobId + ': payment failed: ' + payment.reason);
            await store.setJSON('job/' + jobId, { status: 'error', error: 'Payment verification failed: ' + payment.reason });
            return { statusCode: 202 };
        }

        // Load session metadata
        let meta;
        try { meta = await store.get(sessionId + '/meta', { type: 'json' }); } catch (_) { meta = null; }
        if (!meta) {
            await store.setJSON('job/' + jobId, { status: 'error', error: 'Session expired' });
            return { statusCode: 202 };
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
            await store.setJSON('job/' + jobId, { status: 'error', error: 'Screenshots expired or missing' });
            return { statusCode: 202 };
        }

        // Load prompt
        let systemPrompt = loadPrompt('fast-universal-v2.md');
        if (!systemPrompt) {
            await store.setJSON('job/' + jobId, { status: 'error', error: 'Prompt file missing' });
            return { statusCode: 202 };
        }

        const reportId = 'LL-' + Math.random().toString(36).substring(2, 7).toUpperCase();
        const today    = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
        systemPrompt  += '\n\n---\nReport ID: ' + reportId + '\nDate: ' + today + '\nScreenshots provided: ' + screenshots.length + '\n\nOutput ONLY valid HTML starting with <!DOCTYPE html>. No markdown, no code fences.';

        console.log('Job ' + jobId + ': calling Claude, ' + screenshots.length + ' screenshot(s)');

        const client   = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const response = await client.messages.create({
            model:      'claude-sonnet-4-6',
            max_tokens: 6000,
            system:     systemPrompt,
            messages:   [{
                role: 'user',
                content: [
                    ...screenshots.map(function(s) {
                        return { type: 'image', source: { type: 'base64', media_type: s.mimeType, data: s.base64 } };
                    }),
                    { type: 'text', text: 'Analyse this listing and generate the complete Listing Lens buyer intelligence report as standalone HTML.' }
                ]
            }]
        });

        let html = response.content.filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('');
        html = html.replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
        const start = html.indexOf('<!DOCTYPE html>') !== -1 ? html.indexOf('<!DOCTYPE html>') : html.indexOf('<html');
        const end   = html.lastIndexOf('</html>');
        if (start !== -1 && end !== -1) html = html.substring(start, end + 7);

        console.log('Job ' + jobId + ': storing report (' + html.length + ' chars)');
        await store.setJSON('job/' + jobId, {
            status: 'complete',
            reportId: reportId,
            html: html,
            completedAt: new Date().toISOString()
        });

        // Cleanup screenshots
        try {
            const deletes = [];
            for (let i = 0; i < meta.screenshotCount; i++) deletes.push(store.delete(sessionId + '/screenshot-' + i));
            deletes.push(store.delete(sessionId + '/meta'));
            await Promise.all(deletes);
        } catch (_) {}

        console.log('Job ' + jobId + ': complete ✓');

    } catch (err) {
        console.error('Job ' + (jobId || '?') + ' error:', err.message);
        try {
            if (jobId) await store.setJSON('job/' + jobId, { status: 'error', error: err.message || 'Unknown error' });
        } catch (_) {}
    }

    return { statusCode: 202 };
};
