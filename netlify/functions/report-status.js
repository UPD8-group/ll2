/**
 * LISTING LENS — Report Status (Polling)
 * Route: GET /api/report-status?jobId=xxx
 */

const { getStore } = require('@netlify/blobs');
const SITE_ID = 'b95526e0-71f5-445b-97fb-eac488509a38';

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

    const jobId = event.queryStringParameters && event.queryStringParameters.jobId;
    if (!jobId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'jobId required' }) };

    try {
        const store = getStore({ name: 'listing-lens-sessions', siteID: SITE_ID, token: process.env.NETLIFY_TOKEN });
        let job;
        try { job = await store.get('job/' + jobId, { type: 'json' }); } catch (_) { job = null; }

        if (!job) return { statusCode: 200, headers, body: JSON.stringify({ status: 'processing' }) };

        if (job.status === 'complete' || job.status === 'error') {
            try { await store.delete('job/' + jobId); } catch (_) {}
        }

        return { statusCode: 200, headers, body: JSON.stringify(job) };

    } catch (err) {
        console.error('Status error:', err);
        return { statusCode: 500, headers, body: JSON.stringify({ status: 'error', error: err.message }) };
    }
};
