import { memoryDigest } from '../story-summary/data/memory-policy.js';
import { captureRangeSource, isRangeSourceCurrent, isNarrativeReply, messageCandidates, validateRangeSource, validateMemorySourceReceipt } from '../story-summary/data/turn-source.js';

export const TURN_PREFIX = 'turn:';
const check = (ok, message) => { if (!ok) throw new Error(message); };
const same = (a, b) => memoryDigest(a) === memoryDigest(b);
export const turnRecords = state => Object.entries(state?.sources || {}).filter(([key]) => key.startsWith(TURN_PREFIX)).map(([, value]) => value);
export const currentTurns = state => turnRecords(state).filter(turn => turn.status === 'current').sort((a, b) => a.source.end - b.source.end);
export const turnById = (state, id) => state?.sources?.[`${TURN_PREFIX}${id}`];

export function validateTurnRecord(key, turn) {
    check(turn?.kind === 'narrative_turn' && turn.version === 1 && key === `${TURN_PREFIX}${turn.id}`, '每轮来源结构无效');
    for (const field of ['id', 'messageId', 'candidateId']) check(typeof turn[field] === 'string' && !!turn[field] && turn[field].length <= 90, '每轮来源身份无效');
    check(['current', 'superseded', 'removed'].includes(turn.status) && ['anchored', 'content', 'ambiguous'].includes(turn.identity), '每轮来源状态无效');
    check(Number.isSafeInteger(turn.revision) && turn.revision > 0, '每轮来源版本无效');
    check(/^[a-f0-9]{64}$/.test(turn.candidateKey) && Array.isArray(turn.messageKeys)
        && turn.messageKeys.includes(turn.candidateKey) && turn.messageKeys.every(item => /^[a-f0-9]{64}$/.test(item)), '候选来源身份无效');
    validateRangeSource(turn.source);
    check(turn.source.messages.at(-1).role === 'assistant', '每轮来源必须以正文回复结束');
    check(Array.isArray(turn.memory) && turn.memory.every(item => typeof item.id === 'string' && /^[a-f0-9]{64}$/.test(item.digest)
        && Number.isSafeInteger(item.start) && item.start >= 0 && Number.isSafeInteger(item.end) && item.end >= item.start), '记忆交付记录无效');
    return turn;
}

export function validateTurnLedger(state) {
    const current = currentTurns(state);
    for (const turn of turnRecords(state)) validateTurnRecord(`${TURN_PREFIX}${turn.id}`, turn);
    check(new Set(current.map(turn => turn.source.end)).size === current.length
        && new Set(current.map(turn => turn.messageId)).size === current.length, '当前每轮来源重复');
}

function frames(chat, end) {
    const result = [];
    for (let floor = 0; floor <= end; floor++) {
        const message = chat[floor];
        if (!isNarrativeReply(message)) continue;
        let start = floor;
        while (start > 0 && chat[start - 1]?.is_user) start--;
        result.push({ source: captureRangeSource(chat, start, floor), ...messageCandidates(message) });
    }
    return result;
}

// Each turn is its own world source record, so one append does not write the
// entire source catalog into every event. All former revisions remain on disk.
export function prepareTurnOperations(state, chat, { end = chat.length - 1, history = [], id, memoryAvailable = true } = {}) {
    const records = turnRecords(state), active = currentTurns(state), observed = frames(chat, end);
    const operations = [], retained = new Set(), usedMessages = new Set();
    const receipts = memoryAvailable ? history.filter(batch => {
        if (!batch.sourceReceipt || batch.floorEntry?.deleted) return false;
        validateMemorySourceReceipt(batch.sourceReceipt);
        const receipt = batch.sourceReceipt, digest = memoryDigest(batch);
        const inherited = records.some(turn => turn.memory.some(delivery => delivery.id === receipt.id && delivery.digest === digest));
        return receipt.worldId === state.worldId && (receipt.branchId === state.branchId || inherited)
            && receipt.turns.every(sourceId => turnById(state, sourceId))
            && isRangeSourceCurrent(receipt.source, chat);
    }).map(batch => ({ ...batch.sourceReceipt, digest: memoryDigest(batch) })) : [];
    const keyOwners = new Map();
    for (const frame of observed) for (const key of frame.keys) keyOwners.set(key, (keyOwners.get(key) || 0) + 1);
    for (const frame of observed) {
        const matching = records.filter(turn => turn.messageKeys.some(key => frame.keys.includes(key)));
        const ids = [...new Set(matching.map(turn => turn.messageId))];
        const ambiguous = frame.ambiguous || frame.keys.some(key => keyOwners.get(key) > 1) || ids.length > 1;
        // Position is only a fallback for unanchored imports. It never grants
        // permission to execute effects, and an edited source gets a new revision.
        const fallback = !frame.anchored && !ids.length ? active.find(turn => turn.source.end === frame.source.end && turn.identity === 'content') : null;
        const exact = active.find(turn => turn.source.end === frame.source.end && turn.source.digest === frame.source.digest);
        let messageId = ambiguous ? exact?.messageId : ids[0] || fallback?.messageId;
        if (!messageId || usedMessages.has(messageId)) messageId = id();
        usedMessages.add(messageId);
        const candidates = records.filter(turn => turn.messageId === messageId && turn.candidateKey === frame.selected);
        const candidateId = candidates[0]?.candidateId || id();
        const existing = candidates.find(turn => turn.source.digest === frame.source.digest);
        const turn = existing ? structuredClone(existing) : { kind: 'narrative_turn', version: 1, id: id(), messageId, candidateId,
            revision: Math.max(0, ...candidates.map(item => item.revision)) + 1, candidateKey: frame.selected,
            messageKeys: [], source: frame.source, memory: [] };
        turn.status = 'current';
        turn.source = frame.source;
        turn.identity = ambiguous ? 'ambiguous' : frame.anchored ? 'anchored' : 'content';
        turn.messageKeys = [...new Set([...turn.messageKeys, ...frame.keys])].sort();
        const covering = receipts.filter(receipt => receipt.source.end >= frame.source.start && receipt.source.start <= frame.source.end)
            .sort((a, b) => a.source.start - b.source.start);
        let through = frame.source.start - 1;
        for (const receipt of covering) if (receipt.source.start <= through + 1) through = Math.max(through, receipt.source.end);
        turn.memory = through >= frame.source.end ? covering.map(receipt => ({ id: receipt.id, digest: receipt.digest,
            start: receipt.source.start, end: receipt.source.end })) : [];
        retained.add(turn.id);
        if (!existing || !same(turn, existing)) operations.push({ type: 'source', module: `${TURN_PREFIX}${turn.id}`, snapshot: turn });
    }
    for (const turn of active) if (!retained.has(turn.id)) {
        const stillPresent = chat[turn.source.end] && isRangeSourceCurrent(turn.source, chat);
        // An in-flight suffix is withheld, never treated as a confirmed source.
        const status = stillPresent || observed.some(frame => frame.keys.some(key => turn.messageKeys.includes(key))) ? 'superseded' : 'removed';
        operations.push({ type: 'source', module: `${TURN_PREFIX}${turn.id}`, snapshot: { ...turn, status } });
    }
    return operations;
}

export function turnEffectConflicts(state) {
    return (state?.receipts || []).filter(receipt => receipt.origin && turnById(state, receipt.origin.sourceId)?.status !== 'current');
}

export function turnProgress(state) {
    const turns = currentTurns(state);
    const pending = [], confirmed = [];
    let through = -1;
    for (const turn of turns) {
        if (!turn.memory.length) pending.push(turn.id);
        else confirmed.push(turn.id);
    }
    const ranges = turns.flatMap(turn => turn.memory).sort((a, b) => a.start - b.start);
    for (const range of ranges) if (range.start <= through + 1) through = Math.max(through, range.end);
    for (const turn of turns) if (!turn.memory.length) through = Math.min(through, turn.source.start - 1);
    return { memoryThroughFloor: through, pending, confirmed, conflicts: turnEffectConflicts(state).map(receipt => receipt.eventId) };
}

export function assertTurnOrigin(state, origin) {
    check(origin && typeof origin.sourceId === 'string' && typeof origin.effectId === 'string' && origin.effectId.trim()
        && origin.effectId.length <= 200, '效果必须携带每轮来源与稳定效果编号');
    const turn = turnById(state, origin.sourceId);
    check(turn?.status === 'current', '正文来源已修改、删除或切换候选，请重新核对');
    check(turn.identity === 'anchored', '来源身份不明确，不能自动执行世界变化');
    check(!turnEffectConflicts(state).length, '旧正文已有执行效果待核对，请先处理来源冲突');
    return turn;
}
