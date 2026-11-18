const ALLOWED_ORIGINS = [
    'https://412dhan.github.io',
    'http://localhost:8000',
    'http://127.0.0.1:5500'
];

const PRIMARY_MODEL = 'gemini-3.8-flash';
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
 * Safely parses an HTTP response body as JSON without throwing on malformed payloads.
 *
 * @param {Response} httpResponse - Fetch API Response object.
 * @returns {Promise<object>} Parsed JSON object or empty object on parse failure.
 */
async function parseJsonSafely(httpResponse) {
    try {
        return await httpResponse.json();
    } catch {
        return {};
    }
}

/**
 * Sends a content generation request to a specific Gemini model with timeout protection.
 *
 * @param {string} modelName - Target Gemini model identifier (without 'models/' prefix).
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
        // Prevent Vercel serverless function from hanging on stalled upstream connections
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    const upstreamData = await parseJsonSafely(upstreamResponse);

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
 * Queries the Gemini API model registry to discover active text-generation models
 * available for the current API key, avoiding hardcoded deprecated model IDs.
 *
 * @param {string} apiKey - Server-side Gemini API key.
 * @returns {Promise<string[]>} Ordered list of fallback model identifiers.
 */
async function discoverFallbackModels(apiKey) {
    const modelsEndpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    try {
        const listResponse = await fetch(modelsEndpoint, {
            method: 'GET',
            signal: AbortSignal.timeout(5000)
        });

        if (!listResponse.ok) return [];

        const listData = await parseJsonSafely(listResponse);
        const rawModels = Array.isArray(listData.models) ? listData.models : [];

        // Filter out deprecated generations and non-text specialized endpoints
        const excludedTokens = [
            PRIMARY_MODEL, '1.5', '2.0', '2.5',
            'embedding', 'imagen', 'veo', 'tts',
            'audio', 'aqa', 'robotics', 'computer-use', 'deep-research'
        ];

        const validModels = rawModels
            .filter((modelItem) => {
                const methods = modelItem.supportedGenerationMethods || [];
                const cleanName = (modelItem.name || '').replace('models/', '');
                const isExcluded = excludedTokens.some((token) => cleanName.includes(token));
                return methods.includes('generateContent') && !isExcluded;
            })
            .map((modelItem) => modelItem.name.replace('models/', ''));

        // Prioritize lightweight or experimental flash variants first for faster response
        return validModels.sort((modelA, modelB) => {
            const scoreA = (modelA.includes('hydrogen') || modelA.includes('flash')) ? 0 : 1;
            const scoreB = (modelB.includes('hydrogen') || modelB.includes('flash')) ? 0 : 1;
            return scoreA - scoreB;
        });
    } catch {
        return [];
    }
}

/**
 * Executes model generation with retry and dynamic fallback discovery
 * to mitigate temporary high-demand spikes (HTTP 503/429).
 *
 * @param {string} promptText - Formatted financial analysis prompt.
 * @param {string} apiKey - Server-side Gemini API key.
 * @returns {Promise<string>} Generated HTML analysis string.
 * @throws {Error} When primary and discovered fallback models all fail.
 */
async function generateWithFallback(promptText, apiKey) {
    const primaryAttempt = await requestGeminiModel(PRIMARY_MODEL, promptText, apiKey);
    if (primaryAttempt.ok) return primaryAttempt.text;

    let lastStatus = primaryAttempt.status;
    let lastErrorMessage = primaryAttempt.errorMessage;

    if (RETRYABLE_STATUS_CODES.includes(primaryAttempt.status)) {
        await sleep(RETRY_DELAY_MS);
        const retryAttempt = await requestGeminiModel(PRIMARY_MODEL, promptText, apiKey);
        if (retryAttempt.ok) return retryAttempt.text;

        lastStatus = retryAttempt.status;
        lastErrorMessage = retryAttempt.errorMessage;
    }

    // Dynamically query active models on this API key when primary model is overloaded
    const fallbackModels = await discoverFallbackModels(apiKey);
    for (const candidateModel of fallbackModels) {
        const fallbackAttempt = await requestGeminiModel(candidateModel, promptText, apiKey);
        if (fallbackAttempt.ok) return fallbackAttempt.text;

        lastStatus = fallbackAttempt.status;
        lastErrorMessage = fallbackAttempt.errorMessage;
    }

    const finalError = new Error(
        RETRYABLE_STATUS_CODES.includes(lastStatus)
            ? 'Server AI Google sedang padat sementara. Tunggu beberapa detik lalu coba lagi.'
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
