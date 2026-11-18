/**
 * Vercel Serverless Function acting as a secure proxy for Gemini API.
 * Validates request origin to prevent unauthorized third-party usage.
 *
 * @param {import('http').IncomingMessage} request
 * @param {import('http').ServerResponse} response
 */
module.exports = async function handler(request, response) {
    // Restrict access strictly to your GitHub Pages domain (and local testing)
    const allowedOrigins = [
        'https://412dhan.github.io',
        'http://localhost:8000',
        'http://127.0.0.1:5500'
    ];
    const requestOrigin = request.headers.origin;

    if (allowedOrigins.includes(requestOrigin)) {
        response.setHeader('Access-Control-Allow-Origin', requestOrigin);
    }

    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle browser CORS preflight request before processing POST payload
    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }

    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!allowedOrigins.includes(requestOrigin)) {
        return response.status(403).json({ error: 'Forbidden: Origin tidak diizinkan.' });
    }

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
        return response.status(500).json({ error: 'Server configuration error: GEMINI_API_KEY missing.' });
    }

    try {
        const { prompt } = request.body || {};
        if (!prompt || typeof prompt !== 'string') {
            return response.status(400).json({ error: 'Invalid request: prompt is required.' });
        }

        const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${geminiApiKey}`;
        const geminiResponse = await fetch(geminiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }]
            })
        });

        const geminiData = await geminiResponse.json();

        if (!geminiResponse.ok) {
            const upstreamMessage = geminiData?.error?.message || `Gemini API Error (${geminiResponse.status})`;
            return response.status(geminiResponse.status).json({ error: upstreamMessage });
        }

        const analysisText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!analysisText) {
            return response.status(502).json({ error: 'Invalid response structure from Gemini API.' });
        }

        return response.status(200).json({ result: analysisText });
    } catch (error) {
        return response.status(500).json({ error: `Internal Proxy Error: ${error.message}` });
    }
};
