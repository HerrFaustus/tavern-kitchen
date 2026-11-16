import { throwIfSignalAborted, waitForAbortableDelay } from '../../../shared/common/abort-utils.js';

const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 502, 503, 504]);
const NON_RETRYABLE_HTTP_STATUSES = new Set([400, 401, 403, 404, 405, 422]);
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 300;
const DEFAULT_MAX_DELAY_MS = 2500;
const DEADLINE_SAFETY_MARGIN_MS = 250;

const endpointTokenParamCache = new Map();

/**
 * Redact raw, URL-encoded, header, and query-parameter API keys from error text or logs.
 *
 * @param {unknown} text
 * @param {string} [apiKey]
 * @returns {string}
 */
export function redactApiKeySecrets(text, apiKey = '') {
    let output = typeof text === 'string' ? text : String(text ?? '');
    const trimmedKey = String(apiKey || '').trim();
    if (trimmedKey) {
        output = output.split(trimmedKey).join('[redacted]');
        const encoded = encodeURIComponent(trimmedKey);
        if (encoded && encoded !== trimmedKey) {
            output = output.split(encoded).join('[redacted]');
        }
    }
    output = output
        .replace(/\b(Bearer\s+)(?!\[redacted\])[A-Za-z0-9._~+/=-]{6,}/gi, '$1[redacted]')
        .replace(/([?&](?:api_?key|key|token|access_token)=)(?!\[redacted\])[^&#\s]+/gi, '$1[redacted]')
        .replace(/((?:x-api-key|x-goog-api-key|authorization)\s*[:=]\s*)(?!\[redacted\])[^\s,;]+/gi, '$1[redacted]');
    return output;
}

/**
 * Redact API key secrets inside an Error instance without losing code/status metadata.
 *
 * @template {Error} T
 * @param {T | unknown} error
 * @param {string} [apiKey]
 * @returns {T | Error}
 */
export function sanitizeErrorSecrets(error, apiKey = '') {
    if (!(error instanceof Error)) {
        return new Error(redactApiKeySecrets(error, apiKey));
    }
    const clean = redactApiKeySecrets(error.message, apiKey);
    if (clean !== error.message) {
        error.message = clean;
    }
    return error;
}

function readErrorMessageText(error) {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object') {
        const record = /** @type {{ message?: unknown, error?: { message?: unknown } }} */ (error);
        if (typeof record.message === 'string') return record.message;
        if (typeof record.error?.message === 'string') return record.error.message;
    }
    return String(error ?? '');
}

/**
 * Extract numeric HTTP status code from SDK/fetch/host error objects when present.
 *
 * @param {unknown} error
 * @returns {number | null}
 */
export function getErrorHttpStatus(error) {
    if (!error || typeof error !== 'object') return null;
    const err = /** @type {Record<string, unknown>} */ (error);
    const candidates = [
        err.status,
        err.statusCode,
        err.httpStatus,
        /** @type {{ status?: unknown } | undefined} */ (err.response)?.status,
        /** @type {{ status?: unknown } | undefined} */ (err.cause)?.status,
    ];
    for (const candidate of candidates) {
        const numeric = Number(candidate);
        if (Number.isInteger(numeric) && numeric >= 100 && numeric <= 599) {
            return numeric;
        }
    }
    const msg = readErrorMessageText(error);
    const match = msg.match(/\bHTTP\s*[:\s]*(\d{3})\b/i) || msg.match(/^\s*\[(\d{3})\b/);
    if (match) {
        const numeric = Number(match[1]);
        if (Number.isInteger(numeric) && numeric >= 100 && numeric <= 599) {
            return numeric;
        }
    }
    return null;
}

/**
 * Determine whether a failed LLM request is a transient error safe to retry with backoff.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isRetryableTransientError(error) {
    if (!error) return false;
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        return false;
    }
    const errObj = typeof error === 'object' ? /** @type {Record<string, unknown>} */ (error) : {};
    if (errObj.code === 'ABORT_ERR') return false;

    const status = getErrorHttpStatus(error);
    if (status !== null) {
        if (NON_RETRYABLE_HTTP_STATUSES.has(status)) return false;
        return RETRYABLE_HTTP_STATUSES.has(status);
    }

    const code = String(errObj.code || '').toUpperCase();
    if (['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ERR_NETWORK', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(code)) {
        return true;
    }

    const msg = readErrorMessageText(error).toLowerCase();
    if (msg.includes('abort') || msg.includes('cancelled') || msg.includes('canceled')) {
        return false;
    }
    return (
        msg.includes('network error')
        || msg.includes('failed to fetch')
        || msg.includes('fetch failed')
        || msg.includes('load failed')
        || msg.includes('socket hang up')
        || msg.includes('connection error')
        || msg.includes('econnreset')
        || msg.includes('etimedout')
        || msg.includes('rate limit')
        || msg.includes('too many requests')
        || msg.includes('service unavailable')
        || msg.includes('bad gateway')
        || msg.includes('gateway timeout')
    );
}

/**
 * Read bounded Retry-After delay (ms) from error headers if supplied by the server.
 *
 * @param {unknown} error
 * @param {number} [maxDelayMs]
 * @returns {number | null}
 */
export function parseRetryAfterMs(error, maxDelayMs = DEFAULT_MAX_DELAY_MS) {
    if (!error || typeof error !== 'object') return null;
    const err = /** @type {Record<string, unknown>} */ (error);
    const headers = err.headers || /** @type {{ headers?: unknown } | undefined} */ (err.response)?.headers;
    if (!headers) return null;

    let raw = null;
    if (typeof /** @type {{ get?: unknown }} */ (headers).get === 'function') {
        raw = /** @type {{ get: (name: string) => string | null }} */ (headers).get('retry-after');
    } else if (typeof headers === 'object') {
        const record = /** @type {Record<string, unknown>} */ (headers);
        raw = record['retry-after'] ?? record['Retry-After'] ?? null;
    }
    if (raw == null || raw === '') return null;

    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(maxDelayMs, Math.round(seconds * 1000));
    }
    const timestamp = Date.parse(String(raw));
    if (Number.isFinite(timestamp)) {
        return Math.min(maxDelayMs, Math.max(0, timestamp - Date.now()));
    }
    return null;
}

/**
 * Execute an asynchronous operation with bounded exponential backoff for transient errors.
 *
 * @template T
 * @param {(context: { attempt: number }) => Promise<T>} operation
 * @param {{
 *   signal?: AbortSignal,
 *   timeoutMs?: number,
 *   startedAt?: number,
 *   maxRetries?: number,
 *   baseDelayMs?: number,
 *   maxDelayMs?: number,
 *   canRetry?: (error: unknown, attempt: number) => boolean,
 *   onRetry?: (info: { attempt: number, delayMs: number, error: unknown }) => void
 * }} [options]
 * @returns {Promise<T>}
 */
export async function runWithRetry(operation, options = {}) {
    const {
        signal,
        timeoutMs = 0,
        startedAt = Date.now(),
        maxRetries = DEFAULT_MAX_RETRIES,
        baseDelayMs = DEFAULT_BASE_DELAY_MS,
        maxDelayMs = DEFAULT_MAX_DELAY_MS,
        canRetry = () => true,
        onRetry,
    } = options;

    for (let attempt = 0; ; attempt += 1) {
        throwIfSignalAborted(signal);
        try {
            return await operation({ attempt });
        } catch (error) {
            if (signal?.aborted || attempt >= maxRetries || !isRetryableTransientError(error) || !canRetry(error, attempt)) {
                throw error;
            }
            const retryAfter = parseRetryAfterMs(error, maxDelayMs);
            const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
            const delayMs = retryAfter !== null ? retryAfter : exponential;
            if (timeoutMs > 0) {
                const remaining = timeoutMs - (Date.now() - startedAt);
                if (remaining <= delayMs + DEADLINE_SAFETY_MARGIN_MS) {
                    throw error;
                }
            }
            onRetry?.({ attempt: attempt + 1, delayMs, error });
            await waitForAbortableDelay(delayMs, signal);
        }
    }
}

/**
 * Detect whether a 400/422 error rejected `max_tokens` or `max_completion_tokens`
 * and return the alternate field name that should be retried once.
 *
 * @param {unknown} error
 * @returns {'max_completion_tokens' | 'max_tokens' | null}
 */
export function detectFallbackTokenLimitParam(error) {
    if (!error) return null;
    const status = getErrorHttpStatus(error);
    if (status !== null && status !== 400 && status !== 422) {
        return null;
    }
    const errObj = typeof error === 'object' ? /** @type {Record<string, unknown>} */ (error) : {};
    let bodyText = '';
    if (typeof errObj.body === 'string') {
        bodyText = errObj.body;
    } else if (errObj.error && typeof errObj.error === 'object') {
        try { bodyText = JSON.stringify(errObj.error) || ''; }
        catch { bodyText = ''; }
    }
    const rejectedParam = String(
        errObj.param
        || /** @type {{ param?: unknown } | undefined} */ (errObj.error)?.param
        || '',
    ).trim();
    if (rejectedParam === 'max_tokens') return 'max_completion_tokens';
    if (rejectedParam === 'max_completion_tokens') return 'max_tokens';
    const text = `${readErrorMessageText(error)}\n${bodyText}`.toLowerCase();

    const mentionsCompletionTokens = text.includes('max_completion_tokens');
    const mentionsMaxTokens = /\bmax_tokens\b/.test(text);

    if (mentionsMaxTokens && !mentionsCompletionTokens && (
        text.includes('unsupported')
        || text.includes('not supported')
        || text.includes('unknown parameter')
        || text.includes('unrecognized')
        || text.includes('extra inputs')
        || text.includes('extra_forbidden')
        || text.includes('invalid_request_error')
    )) {
        return 'max_completion_tokens';
    }
    if (mentionsMaxTokens && mentionsCompletionTokens && (
        text.includes("use 'max_completion_tokens'")
        || text.includes('use "max_completion_tokens"')
        || text.includes('max_completion_tokens instead')
        || text.includes("unsupported parameter: 'max_tokens'")
        || text.includes('unsupported parameter: "max_tokens"')
    )) {
        return 'max_completion_tokens';
    }
    if (mentionsCompletionTokens && (
        text.includes('unsupported')
        || text.includes('not supported')
        || text.includes('unknown parameter')
        || text.includes('unknown field')
        || text.includes('unrecognized')
        || text.includes('extra inputs')
        || text.includes('extra_forbidden')
        || text.includes('not permitted')
        || text.includes('unexpected')
    )) {
        return 'max_tokens';
    }
    return null;
}

function normalizeEndpointCacheKey(baseUrl = '', model = '') {
    const cleanBase = String(baseUrl || '').trim().replace(/\/+$/, '').toLowerCase();
    const cleanModel = String(model || '').trim().toLowerCase();
    return `${cleanBase}::${cleanModel}`;
}

/**
 * Look up cached token-limit parameter (`max_tokens` vs `max_completion_tokens`)
 * for an OpenAI-compatible `(baseUrl, model)` pair.
 *
 * @param {string} baseUrl
 * @param {string} model
 * @returns {'max_completion_tokens' | 'max_tokens' | null}
 */
export function getCachedTokenLimitParam(baseUrl, model) {
    return endpointTokenParamCache.get(normalizeEndpointCacheKey(baseUrl, model)) || null;
}

/**
 * Cache discovered token-limit parameter compatibility for an endpoint+model pair.
 *
 * @param {string} baseUrl
 * @param {string} model
 * @param {'max_completion_tokens' | 'max_tokens'} paramName
 */
export function setCachedTokenLimitParam(baseUrl, model, paramName) {
    if (paramName !== 'max_completion_tokens' && paramName !== 'max_tokens') return;
    endpointTokenParamCache.set(normalizeEndpointCacheKey(baseUrl, model), paramName);
}

/**
 * Clear the in-memory endpoint token parameter capability cache (used in tests).
 */
export function clearEndpointTokenParamCache() {
    endpointTokenParamCache.clear();
}
