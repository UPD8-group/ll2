/**
 * LISTING LENS — Upload Screenshots v2.0
 * Category removed — Claude auto-detects from screenshot.
 */

const Busboy     = require('busboy');
const crypto     = require('crypto');
const { getStore } = require('@netlify/blobs');

const MAX_FILES      = 6;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const VALID_MIME     = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const SESSION_TTL_MS = 15 * 60 * 1000;

function parseMultipart(event) {
    return new Promise((resolve, reject) => {
        const fields = {};
        const files  = [];
        const bb     = Busboy({ headers: { 'content-type': event.headers['content-type'] } });

        bb.on('field', (name, val) => { fields[name] = val; });
        bb.on('file', (name, stream, info) => {
            if (!VALID_MIME.includes(info.mimeType)) { stream.resume(); return; }
            const chunks = [];
            let size = 0;
            stream.on('data', chunk => {
                size += chunk.length;
                if (size <= MAX_FILE_BYTES) chunks.push(chunk);
                else stream.destroy();
            });
            stream.on('end', () => {
                if (chunks.length > 0 && files.length < MAX_FILES) {
                    files.push({ mimeType: info.mimeType, buffer: Buffer.concat(chunks) });
                }
            });
        });
        bb.on('finish', () => resolve({ fields, files }));
        bb.on('error', reject);

        const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body || '');
        bb.end(body);
    });
}

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

    try {
        const { files } = await parseMultipart(event);

        if (files.length === 0)
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'No valid images uploaded' }) };

        const sessionId = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
        const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

        const store = getStore({
            name: 'listing-lens-sessions',
            siteID: 'b95526e0-71f5-445b-97fb-eac488509a38',
            token: process.env.NETLIFY_TOKEN
        });

        await Promise.all(
            files.map((f, i) =>
                store.set(sessionId + '/screenshot-' + i, f.buffer, {
                    metadata: { mimeType: f.mimeType, expiresAt }
                })
            )
        );

        await store.setJSON(sessionId + '/meta', {
            screenshotCount: files.length,
            expiresAt,
            createdAt: new Date().toISOString()
        });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                sessionId,
                screenshotCount: files.length,
                expiresInSeconds: 900,
                message: 'Screenshots stored. Session expires in 15 minutes.'
            })
        };

    } catch (err) {
        console.error('Upload error:', err);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Upload failed', message: err.message }) };
    }
};
