const STORAGE_KEY = 'tk-recall-history-v1';
const MAX_CHATS = 10;
const MAX_ROUNDS = 20;
const MAX_CHUNK_TEXT = 500;
const MAX_QUERY_PREVIEW = 180;
const MAX_CHUNKS_PER_ROUND = 20;

const historyByChat = new Map();
let sequence = 0;

function historyKey(chatId = '', branchId = '') {
    return `${String(chatId || '').trim()}::${String(branchId || '').trim()}`;
}

function readStoredMap() {
    try {
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
        if (!raw) return new Map();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Map();
        const out = new Map();
        for (const [key, entries] of parsed) {
            if (typeof key === 'string' && Array.isArray(entries)) {
                out.set(key, entries.slice(0, MAX_ROUNDS));
            }
        }
        return out;
    } catch {
        return new Map();
    }
}

function ensureLoaded() {
    if (historyByChat.size > 0) return;
    for (const [key, entries] of readStoredMap()) {
        historyByChat.set(key, entries);
    }
}

function persistHistory() {
    try {
        const trimmed = [...historyByChat.entries()].slice(-MAX_CHATS);
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (error) {
        // Storage quota or private mode failure must never disrupt generation.
        console.debug({ source: import.meta.url, operation: 'persistHistory' }, error);
    }
}

function sanitizeScore(value) {
    return Number.isFinite(value) ? Number(value.toFixed(4)) : null;
}

function normalizeChunks(chunks = []) {
    if (!Array.isArray(chunks)) return [];
    return chunks.slice(0, MAX_CHUNKS_PER_ROUND).map(chunk => ({
        chunkId: String(chunk?.chunkId || ''),
        floor: Number.isInteger(chunk?.floor) ? chunk.floor : -1,
        speaker: String(chunk?.speaker || ''),
        score: sanitizeScore(chunk?._score ?? chunk?.score),
        rerankScore: sanitizeScore(chunk?._rerankScore ?? chunk?.rerankScore),
        text: String(chunk?.text || '').slice(0, MAX_CHUNK_TEXT),
        included: chunk?.included !== false,
        filterReason: String(chunk?.filterReason || ''),
    }));
}

export function buildRecallHistoryEntry({
    chatId = '',
    branchId = '',
    type = 'normal',
    targetFloor = -1,
    diagnostics = null,
    prepared = null,
    status = 'empty',
    reason = '',
    error = null,
    recallLogText = '',
} = {}) {
    const trace = prepared?.recallTrace || prepared?.reuseMemory?.recallTrace || null;
    const elapsedMs = diagnostics?.startedAt != null
        ? Math.max(0, Math.round((diagnostics.finishedAt ?? performance.now()) - diagnostics.startedAt))
        : 0;
    const mode = status === 'reused'
        ? (trace?.mode || 'reused')
        : (trace?.mode || (prepared?.mode === 'canonical' ? 'canonical' : 'none'));
    const fallbacks = Array.isArray(diagnostics?.fallbacks)
        ? diagnostics.fallbacks.map(item => ({
            stage: String(item?.stage || ''),
            detail: String(item?.detail || ''),
        }))
        : [];
    const chunks = normalizeChunks(trace?.chunks);
    const includedCount = chunks.filter(chunk => chunk.included).length;
    const trimmedCount = chunks.filter(chunk => !chunk.included).length;

    sequence += 1;
    return {
        id: `${Date.now()}-${sequence}`,
        timestamp: Date.now(),
        chatId: String(chatId || ''),
        branchId: String(branchId || ''),
        type: String(type || 'normal'),
        targetFloor: Number.isInteger(targetFloor) ? targetFloor : -1,
        status,
        mode,
        reranked: Boolean(trace?.reranked),
        reason: String(reason || error?.message || diagnostics?.reason || ''),
        elapsedMs,
        hiddenThrough: Number.isInteger(trace?.hiddenThrough) ? trace.hiddenThrough : -1,
        queryPreview: String(trace?.queryPreview || '').slice(0, MAX_QUERY_PREVIEW),
        focusCharacters: Array.isArray(trace?.focusCharacters) ? trace.focusCharacters.slice(0, 12).map(String) : [],
        backgroundItems: Number(trace?.backgroundItems || 0),
        includedBackgroundItems: Number(trace?.includedBackgroundItems || 0),
        rawBudgetUsed: Number(trace?.rawBudgetUsed || 0),
        rawBudgetMax: Number(trace?.rawBudgetMax || 3000),
        includedCount,
        trimmedCount,
        chunks,
        fallbacks,
        diagnosticsText: String(recallLogText || ''),
    };
}

export function recordRecallHistoryEntry(entry) {
    if (!entry?.chatId) return [];
    ensureLoaded();
    const key = historyKey(entry.chatId, entry.branchId);
    const previous = historyByChat.get(key) || [];
    const next = [entry, ...previous].slice(0, MAX_ROUNDS);
    historyByChat.delete(key);
    historyByChat.set(key, next);
    while (historyByChat.size > MAX_CHATS) {
        const oldestKey = historyByChat.keys().next().value;
        historyByChat.delete(oldestKey);
    }
    persistHistory();
    return [...next];
}

export function getRecallHistory(chatId = '', branchId = '') {
    if (!chatId) return [];
    ensureLoaded();
    return [...(historyByChat.get(historyKey(chatId, branchId)) || [])];
}

export function clearRecallHistory(chatId = null, branchId = '') {
    ensureLoaded();
    if (chatId == null) {
        historyByChat.clear();
    } else if (branchId) {
        historyByChat.delete(historyKey(chatId, branchId));
    } else {
        const prefix = `${String(chatId).trim()}::`;
        for (const key of [...historyByChat.keys()]) {
            if (key.startsWith(prefix)) historyByChat.delete(key);
        }
    }
    persistHistory();
}
