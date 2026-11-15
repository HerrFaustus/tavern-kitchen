function mapNormalizedChar(ch) {
    if (ch === '\u201C' || ch === '\u201D') return '"';
    if (ch === '\u2018' || ch === '\u2019') return "'";
    return ch;
}

function buildNormalizedQuoteIndex(text) {
    let normalized = '';
    const starts = [];
    const ends = [];
    let i = 0;
    while (i < text.length && /\s/.test(text[i])) i += 1;
    while (i < text.length) {
        if (/\s/.test(text[i])) {
            const runStart = i;
            while (i < text.length && /\s/.test(text[i])) i += 1;
            if (i < text.length && normalized.length > 0) {
                normalized += ' ';
                starts.push(runStart);
                ends.push(i);
            }
            continue;
        }
        normalized += mapNormalizedChar(text[i]);
        starts.push(i);
        ends.push(i + 1);
        i += 1;
    }
    return { normalized, starts, ends };
}

function normalizeQuoteString(text) {
    return buildNormalizedQuoteIndex(text).normalized;
}

/**
 * Resolves a model quote against source text, using a narrow whitespace/curly-quote
 * fallback only when exact substring matching fails and the canonical match is unique.
 */
export function resolveSourceQuote(sourceText, rawQuote, { maxLength = Infinity } = {}) {
    if (typeof sourceText !== 'string' || typeof rawQuote !== 'string') return null;
    if (!rawQuote.trim() || rawQuote.length > maxLength) return null;
    if (sourceText.includes(rawQuote)) return rawQuote;
    const normQuote = normalizeQuoteString(rawQuote);
    if (!normQuote || normQuote.length > maxLength) return null;
    const { normalized, starts, ends } = buildNormalizedQuoteIndex(sourceText);
    const canonicalMatches = new Set();
    let offset = 0;
    while (offset <= normalized.length - normQuote.length) {
        const hit = normalized.indexOf(normQuote, offset);
        if (hit === -1) break;
        const canonical = sourceText.slice(starts[hit], ends[hit + normQuote.length - 1]);
        canonicalMatches.add(canonical);
        if (canonicalMatches.size > 1) return null;
        offset = hit + 1;
    }
    if (canonicalMatches.size !== 1) return null;
    const [canonical] = canonicalMatches;
    return canonical && canonical.length <= maxLength ? canonical : null;
}

function nextNonWhitespaceChar(text, startIndex) {
    for (let i = startIndex; i < text.length; i += 1) {
        if (!/\s/.test(text[i])) return text[i];
    }
    return '';
}

function sanitizeJsonOutsideStrings(candidate) {
    let out = '';
    let inString = false;
    let stringCloser = '"';
    let curlyDepth = 0;
    let escape = false;
    for (let i = 0; i < candidate.length; i += 1) {
        const ch = candidate[i];
        if (inString) {
            if (escape) { out += ch; escape = false; continue; }
            if (ch === '\\') { out += ch; escape = true; continue; }
            if (stringCloser === '”') {
                if (ch === '“') { curlyDepth += 1; out += ch; continue; }
                if (ch === '”') {
                    if (curlyDepth > 0) { curlyDepth -= 1; out += ch; continue; }
                    inString = false;
                    out += '"';
                    continue;
                }
                if (ch === '"') { out += '\\"'; continue; }
            } else if (ch === '"') {
                inString = false;
                out += ch;
                continue;
            }
            if (ch === '\n') { out += '\\n'; continue; }
            if (ch === '\r') { out += '\\r'; continue; }
            if (ch === '\t') { out += '\\t'; continue; }
            out += ch;
            continue;
        }
        if (ch === '"') { inString = true; stringCloser = '"'; out += '"'; continue; }
        if (ch === '“') { inString = true; stringCloser = '”'; curlyDepth = 0; out += '"'; continue; }
        if (ch === ',') {
            const next = nextNonWhitespaceChar(candidate, i + 1);
            if (next === '}' || next === ']') continue;
        }
        out += ch;
    }
    return out;
}

function tryParseJsonCandidate(candidate) {
    const trimmed = candidate.trim();
    if (!trimmed) return { ok: false, error: null };
    try {
        return { ok: true, value: JSON.parse(trimmed) };
    } catch (firstError) {
        const sanitized = sanitizeJsonOutsideStrings(trimmed);
        if (sanitized !== trimmed) {
            try {
                return { ok: true, value: JSON.parse(sanitized) };
            } catch (fallbackError) {
                console.debug({ source: import.meta.url, operation: 'tryParseJsonCandidate' }, fallbackError);
            }
        }
        return { ok: false, error: firstError };
    }
}

function findBalancedJsonEnd(text, startIndex) {
    const stack = [];
    let inString = false;
    let stringCloser = '"';
    let curlyDepth = 0;
    let escape = false;
    for (let i = startIndex; i < text.length; i += 1) {
        const ch = text[i];
        if (inString) {
            if (escape) { escape = false; continue; }
            if (ch === '\\') { escape = true; continue; }
            if (stringCloser === '”') {
                if (ch === '“') curlyDepth += 1;
                else if (ch === '”') {
                    if (curlyDepth > 0) curlyDepth -= 1;
                    else inString = false;
                }
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') { inString = true; stringCloser = '"'; continue; }
        if (ch === '“') { inString = true; stringCloser = '”'; curlyDepth = 0; continue; }
        if (ch === '{') { stack.push('}'); continue; }
        if (ch === '[') { stack.push(']'); continue; }
        if (ch === '}' || ch === ']') {
            if (!stack.length || stack[stack.length - 1] !== ch) return -1;
            stack.pop();
            if (stack.length === 0) return i;
        }
    }
    return -1;
}

function extractAndParseBalancedJson(text) {
    let lastError = null;
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] !== '{' && text[i] !== '[') continue;
        const end = findBalancedJsonEnd(text, i);
        if (end === -1) continue;
        const parsed = tryParseJsonCandidate(text.slice(i, end + 1));
        if (parsed.ok) return { ok: true, value: parsed.value };
        lastError = parsed.error;
        i = end;
    }
    return { ok: false, error: lastError };
}

/**
 * Parses JSON emitted by an LLM, tolerating markdown fences, surrounding prose,
 * trailing commas, and smart-quote delimiters outside string literals.
 */
export function parseJsonResponse(rawText) {
    if (typeof rawText !== 'string') throw new SyntaxError('模型返回内容非文本');
    const trimmed = rawText.replace(/^\uFEFF/, '').trim();
    if (!trimmed) throw new SyntaxError('模型返回内容为空');
    const direct = tryParseJsonCandidate(trimmed);
    if (direct.ok) return direct.value;

    const fencePattern = /```(?:json)?[ \t]*(?:\r?\n)?([\s\S]*?)```/gi;
    for (const match of trimmed.matchAll(fencePattern)) {
        const block = match[1].trim();
        const directBlock = tryParseJsonCandidate(block);
        if (directBlock.ok) return directBlock.value;
        const nested = extractAndParseBalancedJson(block);
        if (nested.ok) return nested.value;
    }

    const balanced = extractAndParseBalancedJson(trimmed);
    if (balanced.ok) return balanced.value;
    throw balanced.error || direct.error || new SyntaxError('模型未返回有效 JSON');
}
