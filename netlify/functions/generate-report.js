/**
 * LISTING LENS — Generate Report (Session Validator)
 *
 * Validates session exists, returns a jobId.
 * The BROWSER then calls generate-report-background directly.
 * No server-to-server function calls — that was the bug.
 */

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');
const SITE_ID = '723a91f3-c306-48fd-b0d7-382ba89fb9a0';

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

    try {
        const body = JSON.parse(event.body || '{}');
        const sessionId = body.sessionId;
        if (!sessionId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'sessionId required' }) };

        const store = getStore({ name: 'listing-lens-sessions', siteID: SITE_ID, token: process.env.NETLIFY_TOKEN });
        let meta;
        try { meta = await store.get(sessionId + '/meta', { type: 'json' }); } catch (_) { meta = null; }

        if (!meta) return { statusCode: 410, headers, body: JSON.stringify({ error: 'Session expired', message: 'Please re-upload your screenshots.' }) };

        const jobId = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
        console.log('Session valid. jobId:', jobId);
        return { statusCode: 200, headers, body: JSON.stringify({ jobId }) };

    } catch (err) {
        console.error('Error:', err.message);
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
