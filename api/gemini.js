const ALLOWED_ORIGINS = [
    'https://412dhan.github.io',
    'http://localhost:8000',
    'http://127.0.0.1:5500'
];

const CANDIDATE_MODELS = [
    'gemini-3.8-flash',
    'gemini-2.5-flash'
];

const RETRYABLE_STATUS_CODES = [429, 503];
const RETRY_DELAY_MS = 1500;
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Pauses execution for a specified duration before retrying a transient failure.
 *
 * @param {number} durationMs - Delay duration in milliseconds.
 * @returns {Promise<void>}
 */
function sleep(durationMs) {
    return new Promise((resolve) => setTimeout(resolve, durationMs));
}

/**
 * Sends a single content generation request to a specific Gemini model with timeout protection.
 *
 * @param {string} modelName - Target Gemini model identifier.
 * @param {string} promptText - Formatted financial analysis prompt.
 * @param {string} apiKey - Server-side Gemini API key.
 * @returns {Promise<{ok: boolean, status: number, text?: string, errorMessage?: string}>}
 */
async function requestGeminiModel(modelName, promptText, apiKey) {
    const endpointUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const upstreamResponse = await fetch(endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: promptText }] }]
        }),
        // Prevent Vercel serverless function from hanging indefinitely on stalled upstream connections
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    const upstreamData = await upstreamResponse.json();

    if (!upstreamResponse.ok) {
        return {
            ok: false,
            status: upstreamResponse.status,
            errorMessage: upstreamData?.error?.message || `Gemini API Error (${upstreamResponse.status})`
        };
    }

    const generatedText = upstreamData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!generatedText) {
        return {
            ok: false,
            status: 502,
            errorMessage: 'Struktur respons dari Gemini API tidak valid.'
        };
    }

    return { ok: true, status: 200, text: generatedText };
}

/**
 * Executes model generation with automatic retry and fallback across candidate models
 * to mitigate temporary high-demand spikes (HTTP 503/429).
 *
 * @param {string} promptText - Formatted financial analysis prompt.
 * @param {string} apiKey - Server-side Gemini API key.
 * @returns {Promise<string>} Generated HTML analysis string.
 * @throws {Error} When all candidate models fail.
 */
async function generateWithFallback(promptText, apiKey) {
    let lastStatus = 500;
    let lastErrorMessage = 'Gagal terhubung ke layanan AI.';

    for (const modelName of CANDIDATE_MODELS) {
        const firstAttempt = await requestGeminiModel(modelName, promptText, apiKey);
        if (firstAttempt.ok) return firstAttempt.text;

        lastStatus = firstAttempt.status;
        lastErrorMessage = firstAttempt.errorMessage;

        // Retry once on the same model only if the error is a transient load/rate spike
        if (RETRYABLE_STATUS_CODES.includes(firstAttempt.status)) {
            await sleep(RETRY_DELAY_MS);
            const secondAttempt = await requestGeminiModel(modelName, promptText, apiKey);
            if (secondAttempt.ok) return secondAttempt.text;

            lastStatus = secondAttempt.status;
            lastErrorMessage = secondAttempt.errorMessage;
        }
    }

    const finalError = new Error(
        RETRYABLE_STATUS_CODES.includes(lastStatus)
            ? 'Server AI Google sedang mengalami lonjakan trafik sementara. Tunggu beberapa detik lalu coba lagi.'
            : lastErrorMessage
    );
    finalError.statusCode = lastStatus;
    throw finalError;
}

/**
 * Vercel Serverless Function acting as a secure proxy for Gemini API.
 * Validates request origin to prevent unauthorized third-party usage.
 *
 * @param {import('http').IncomingMessage} request
 * @param {import('http').ServerResponse} response
 */
module.exports = async function handler(request, response) {
    const requestOrigin = request.headers.origin;

    if (ALLOWED_ORIGINS.includes(requestOrigin)) {
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

    if (!ALLOWED_ORIGINS.includes(requestOrigin)) {
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

        const analysisText = await generateWithFallback(prompt, geminiApiKey);
        return response.status(200).json({ result: analysisText });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        const message = error.name === 'TimeoutError'
            ? 'Koneksi ke server AI timeout. Silakan coba lagi.'
            : error.message;
        return response.status(statusCode).json({ error: message });
    }
};
