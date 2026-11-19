import { memoryDigest } from './memory-policy.js';

// The host also uses is_system to hide normal prose. A typed system message is
// distinct; changing the visibility of an ordinary reply is not a revision.
export const isNarrativeReply = message => !!message && !message.is_user && typeof message.mes === 'string'
    && !!message.mes.trim() && !(message.is_system && message.extra?.type);

const stamp = value => value instanceof Date ? value.toISOString() : ['string', 'number'].includes(typeof value) ? String(value) : '';
function candidate(message, index) {
    const selected = index === (message?.swipe_id ?? 0);
    const info = message?.swipe_info?.[index] || (selected ? message : {});
    const sent = stamp(info.send_date);
    // Generation timings can be filled in after the completion notification or
    // replaced by a continuation. They do not rename an existing dated reply.
    const anchor = sent ? ['sent', sent] : ['generated', stamp(info.gen_started), stamp(info.gen_finished), stamp(info.extra?.gen_id)];
    const anchored = !!sent || anchor.slice(1).some(Boolean);
    const text = String(message?.swipes?.[index] ?? (selected ? message?.mes : '') ?? '');
    const baseKey = memoryDigest(anchored ? ['native', ...anchor] : ['content', index, text]);
    return { key: baseKey, baseKey, anchored, text };
}

// Native candidate timestamps survive index renumbering. Imported messages may
// lack them; retain that uncertainty rather than inventing a durable host ID.
// WHY: Character cards with multiple alternate_greetings share one chat-creation
// send_date across all initial swipes in TauriTavern/SillyTavern. Disambiguating
// colliding anchored timestamps by swipe text keeps distinct greetings anchored
// while truly identical duplicate swipes remain ambiguous.
export function messageCandidates(message) {
    const selectedIndex = message?.swipe_id ?? 0;
    const all = Array.from({ length: Math.max(message?.swipes?.length || 0, selectedIndex + 1) }, (_, i) => candidate(message, i));
    const baseCounts = new Map();
    for (const item of all) if (item.anchored) baseCounts.set(item.baseKey, (baseCounts.get(item.baseKey) || 0) + 1);
    const resolved = all.map(item => (item.anchored && baseCounts.get(item.baseKey) > 1
        ? { ...item, key: memoryDigest(['native-text', item.baseKey, item.text]) }
        : item));
    const selected = resolved[selectedIndex] || candidate(message, selectedIndex);
    return { selected: selected.key, legacySelected: selected.baseKey, keys: [...new Set(resolved.map(item => item.key))],
        anchored: selected.anchored, ambiguous: resolved.filter(item => item.key === selected.key).length !== 1 };
}

export function captureRangeSource(chat, start, end) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= chat.length) {
        throw new Error('剧情来源范围无效');
    }
    const messages = chat.slice(start, end + 1).map((message, offset) => ({ floor: start + offset,
        name: String(message.name || ''), role: message.is_user ? 'user' : message.is_system && message.extra?.type ? 'system' : 'assistant',
        text: String(message.mes || ''), candidate: messageCandidates(message).selected }));
    return { version: 1, start, end, digest: sourceDigest(messages), messages };
}

const sourceDigest = messages => memoryDigest(messages.map(({ floor, ...message }) => message));

export function matchesRangeDigest(digest, source, chat) {
    if (!digest || !source) return false;
    if (digest === source.digest) return true;
    const end = Number.isInteger(source.end) ? source.end : source.floor;
    const range = Array.isArray(source.messages)
        ? source
        : (Array.isArray(chat) && Number.isInteger(source.start) && Number.isInteger(end) && end < chat.length
            ? captureRangeSource(chat, source.start, end)
            : null);
    if (!range) return false;
    const legacyDigest = sourceDigest(range.messages.map(message => {
        const live = chat?.[message.floor];
        const cands = live ? messageCandidates(live) : null;
        return cands && message.candidate === cands.selected ? { ...message, candidate: cands.legacySelected } : message;
    }));
    return digest === legacyDigest;
}

export function isRangeSourceCurrent(source, chat) {
    if (!source || source.version !== 1 || source.end >= chat.length) return false;
    try {
        const current = captureRangeSource(chat, source.start, source.end);
        if (source.digest === current.digest) return true;
        // Old ranges may have captured hidden prose as role=system or a colliding
        // multi-greeting timestamp before native-text disambiguation. Validate
        // their original receipt, then compare only those representation upgrades.
        validateRangeSource(source);
        return sourceDigest(source.messages.map((message, offset) => {
            const live = chat[message.floor];
            const role = message.role === 'system' && !live?.extra?.type && !live?.is_user ? 'assistant' : message.role;
            const cands = live ? messageCandidates(live) : null;
            const cur = current.messages[offset];
            const candidateKey = cands && cur && message.candidate === cands.legacySelected && message.text === cur.text
                ? cur.candidate : message.candidate;
            return { ...message, role, candidate: candidateKey };
        })) === current.digest;
    }
    catch { return false; }
}

export function validateRangeSource(source) {
    if (source?.version !== 1 || !Number.isSafeInteger(source.start) || source.start < 0
        || !Number.isSafeInteger(source.end) || source.end < source.start || !Array.isArray(source.messages)
        || source.messages.length !== source.end - source.start + 1
        || source.messages.some((message, i) => message.floor !== source.start + i || typeof message.name !== 'string'
            || !['user', 'assistant', 'system'].includes(message.role) || typeof message.text !== 'string' || !/^[a-f0-9]{64}$/.test(message.candidate))
        || source.digest !== sourceDigest(source.messages)) throw new Error('剧情来源指纹无效');
    return source;
}

export function firstInvalidMemorySource(store, chat) {
    const history = Array.isArray(store?.summaryHistory) ? store.summaryHistory : [];
    const invalid = history.map(batch => batch?.sourceReceipt?.source || batch?.roundSource)
        .filter(source => source && !isRangeSourceCurrent(source, chat)).map(source => source.start);
    for (const [floor,row] of Object.entries(store?.floorWork || {})) {
        if (!isRangeSourceCurrent(row?.source,chat)) invalid.push(row?.source?.start ?? Math.max(0, Number(floor) - 1));
    }
    return invalid.length ? Math.min(...invalid) : null;
}

export function validateMemorySourceReceipt(receipt) {
    if (receipt?.version !== 1 || ['id', 'worldId', 'branchId'].some(key => typeof receipt[key] !== 'string' || !receipt[key] || receipt[key].length > 200)
        || !Number.isSafeInteger(receipt.basisVersion) || receipt.basisVersion < 0
        || !Array.isArray(receipt.turns) || receipt.turns.some(id => typeof id !== 'string' || !id)) throw new Error('记忆来源交付记录无效');
    validateRangeSource(receipt.source);
    return receipt;
}
