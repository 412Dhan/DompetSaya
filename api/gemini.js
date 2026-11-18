const ALLOWED_ORIGINS = [
    'https://412dhan.github.io',
    'http://localhost:8000',
    'http://127.0.0.1:5500'
];

const PRIMARY_MODEL = 'gemini-3.8-flash';
const RETRYABLE_STATUS_CODES = [429, 503];
const RETRY_DELAY_MS = 1000;
const PER_REQUEST_TIMEOUT_MS = 7500;

// Module-level cache persists across warm Vercel serverless invocations
let cachedFallbackModels = null;

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
 * Sends a content generation request to a specific Gemini model.
 * Catches timeout errors internally so the caller can immediately trigger model fallback.
 *
 * @param {string} modelName - Target Gemini model identifier (without 'models/' prefix).
 * @param {string} promptText - Formatted financial analysis prompt.
 * @param {string} apiKey - Server-side Gemini API key.
 * @returns {Promise<{ok: boolean, status: number, text?: string, errorMessage?: string}>}
 */
async function requestGeminiModel(modelName, promptText, apiKey) {
    const endpointUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    try {
        const upstreamResponse = await fetch(endpointUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: promptText }] }]
            }),
            // Fail fast per model so fallback execution still fits within Vercel's serverless window
            signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS)
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
    } catch (networkError) {
        const isTimeout = networkError.name === 'TimeoutError' || networkError.name === 'AbortError';
        return {
            ok: false,
            status: isTimeout ? 504 : 502,
            errorMessage: isTimeout
                ? 'Koneksi ke server AI timeout. Silakan coba lagi.'
                : `Gagal terhubung ke upstream AI: ${networkError.message}`
        };
    }
}

/**
 * Discovers and caches active text-generation models available for the current API key.
 *
 * @param {string} apiKey - Server-side Gemini API key.
 * @returns {Promise<string[]>} Ordered list of up to 2 fallback model identifiers.
 */
async function getFallbackModels(apiKey) {
    if (Array.isArray(cachedFallbackModels) && cachedFallbackModels.length > 0) {
        return cachedFallbackModels;
    }

    const modelsEndpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    try {
        const listResponse = await fetch(modelsEndpoint, {
            method: 'GET',
            signal: AbortSignal.timeout(4000)
        });

        if (!listResponse.ok) return [];

        const listData = await parseJsonSafely(listResponse);
        const rawModels = Array.isArray(listData.models) ? listData.models : [];

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

        const prioritizedModels = validModels
            .sort((modelA, modelB) => {
                const scoreA = (modelA.includes('hydrogen') || modelA.includes('flash')) ? 0 : 1;
                const scoreB = (modelB.includes('hydrogen') || modelB.includes('flash')) ? 0 : 1;
                return scoreA - scoreB;
            })
            .slice(0, 2);

        if (prioritizedModels.length > 0) {
            cachedFallbackModels = prioritizedModels;
        }

        return prioritizedModels;
    } catch {
        return [];
    }
}

/**
 * Executes model generation with fast-fail timeout handling and cached fallback models.
 *
 * @param {string} promptText - Formatted financial analysis prompt.
 * @param {string} apiKey - Server-side Gemini API key.
 * @returns {Promise<string>} Generated HTML analysis string.
 * @throws {Error} When primary and fallback models all fail.
 */
async function generateWithFallback(promptText, apiKey) {
    const primaryAttempt = await requestGeminiModel(PRIMARY_MODEL, promptText, apiKey);
    if (primaryAttempt.ok) return primaryAttempt.text;

    let lastStatus = primaryAttempt.status;
    let lastErrorMessage = primaryAttempt.errorMessage;

    // Retry primary model only on fast HTTP 429/503 rejections; skip retry on 504 timeout to save execution budget
    if (RETRYABLE_STATUS_CODES.includes(primaryAttempt.status)) {
        await sleep(RETRY_DELAY_MS);
        const retryAttempt = await requestGeminiModel(PRIMARY_MODEL, promptText, apiKey);
        if (retryAttempt.ok) return retryAttempt.text;

        lastStatus = retryAttempt.status;
        lastErrorMessage = retryAttempt.errorMessage;
    }

    const fallbackModels = await getFallbackModels(apiKey);
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
        return response.status(statusCode).json({ error: error.message });
    }
};