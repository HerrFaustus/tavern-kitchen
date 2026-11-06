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
    return { key: memoryDigest(anchored ? ['native', ...anchor] : ['content', index, message?.swipes?.[index] ?? message?.mes ?? '']), anchored };
}

// Native candidate timestamps survive index renumbering. Imported messages may
// lack them; retain that uncertainty rather than inventing a durable host ID.
export function messageCandidates(message) {
    const selected = candidate(message, message?.swipe_id ?? 0);
    const all = Array.from({ length: Math.max(message?.swipes?.length || 0, (message?.swipe_id ?? 0) + 1) }, (_, i) => candidate(message, i));
    return { selected: selected.key, keys: [...new Set(all.map(item => item.key))],
        anchored: selected.anchored, ambiguous: all.filter(item => item.key === selected.key).length !== 1 };
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

export function isRangeSourceCurrent(source, chat) {
    if (!source || source.version !== 1 || source.end >= chat.length) return false;
    try {
        const current = captureRangeSource(chat, source.start, source.end);
        if (source.digest === current.digest) return true;
        // Old ranges may have captured hidden prose as role=system. Validate
        // their original receipt, then compare only that presentation change.
        validateRangeSource(source);
        return sourceDigest(source.messages.map(message => message.role === 'system' && !chat[message.floor]?.extra?.type && !chat[message.floor]?.is_user
            ? { ...message, role: 'assistant' } : message)) === current.digest;
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
    const invalid = (store?.summaryHistory || []).map(batch => batch.sourceReceipt?.source || batch.roundSource)
        .filter(source => source && !isRangeSourceCurrent(source, chat)).map(source => source.start);
    return invalid.length ? Math.min(...invalid) : null;
}

export function validateMemorySourceReceipt(receipt) {
    if (receipt?.version !== 1 || ['id', 'worldId', 'branchId'].some(key => typeof receipt[key] !== 'string' || !receipt[key] || receipt[key].length > 200)
        || !Number.isSafeInteger(receipt.basisVersion) || receipt.basisVersion < 0
        || !Array.isArray(receipt.turns) || receipt.turns.some(id => typeof id !== 'string' || !id)) throw new Error('记忆来源交付记录无效');
    validateRangeSource(receipt.source);
    return receipt;
}
