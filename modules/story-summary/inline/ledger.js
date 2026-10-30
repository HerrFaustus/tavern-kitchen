import { floorSource, prepareFloorPayload, validateFloorPayload } from './protocol.js';
import { applyExactSummaryHistoryUndo, summaryBatchChanges, buildSummaryUndo } from '../data/summary-undo.js';
import { createSummaryBatch } from '../data/summary-history.js';
import { memoryItems, memoryKey, replaceMemoryRecords, sameMemory } from '../maintenance/domain.js';
import { memoryPolicy, memoryDigest } from '../data/memory-policy.js';

const clone = value => structuredClone(value);
const conflict = message => { throw new Error(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);

/** Reapply only fields actually changed later, preserving unrelated earlier corrections. */
function rebaseValue(current, before, after) {
    if (sameMemory(before, after)) return clone(current);
    if (!object(before) || !object(after) || !object(current)) return clone(after);
    const next = clone(current);
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (sameMemory(before[key], after[key])) continue;
        if (!Object.hasOwn(after, key)) delete next[key];
        else next[key] = rebaseValue(current[key], before[key], after[key]);
    }
    return next;
}

function forwardChanges(memory, changes) {
    return changes.map(change => {
        if (change.retired) return clone(change);
        const { collection, key, before, after } = change;
        const items = memoryItems(memory, collection);
        const index = items.findIndex(item => memoryKey(collection, item) === key);
        const current = index < 0 ? null : items[index];
        if (before !== null && after !== null && current === null) conflict('后续修订仍引用已移除条目，请先调整后续修订。');
        if (before === null && current !== null && !sameMemory(current, after)) conflict('后续新增条目与本次修改冲突。');
        const value = after === null ? null : rebaseValue(current, before, after);
        replaceMemoryRecords(memory, [{ collection, key, value }]);
        return { ...clone(change), index, before: clone(current), after: clone(value) };
    });
}

function replayMaintenance(memory, receipts) {
    return receipts.map(receipt => ({ ...clone(receipt), operations: receipt.operations.map(operation => ({
        ...clone(operation), changes: forwardChanges(memory, operation.changes),
    })) }));
}

function replayLegacy(memory, batch) {
    for (const change of summaryBatchChanges(batch.undo)) {
        if (Array.isArray(change.before) || Array.isArray(change.after)) {
            const current = memoryItems(memory, change.collection);
            if (!sameMemory(current, change.before)) conflict('后续旧版区间总结包含整表替换，无法安全重放；请先回退该区间。');
            const rows = new Map(current.map(item => [memoryKey(change.collection, item), null]));
            for (const item of change.after || []) rows.set(memoryKey(change.collection, item), item);
            replaceMemoryRecords(memory, [...rows].map(([key, value]) => ({ collection: change.collection, key, value })));
        } else forwardChanges(memory, [change]);
    }
}

export function findFloorBatch(store, floor) {
    return store?.summaryHistory?.find(batch => batch.kind === 'batch' && batch.floorEntry?.floor === floor);
}

export function isFloorEntryCurrent(entry, chat) {
    return !!entry && floorSource(chat, entry.floor)?.digest === entry.source?.digest;
}

/** Highest contiguous covered floor; a new inline summary must never hide older gaps. */
export function floorCoverageEnd(store) {
    if (!store?.summaryHistory?.some(batch => batch.floorEntry)) return store?.lastSummarizedMesId ?? -1;
    let through = -1;
    for (const batch of store?.summaryHistory || []) {
        if (!batch.floorEntry) { if (batch.previousEndMesId == null || batch.previousEndMesId <= through) through = batch.endMesId; continue; }
        if (batch.floorEntry.source.start > through + 1 || batch.floorEntry.deleted) break;
        through = batch.endMesId;
    }
    return Math.min(through, store?.lastSummarizedMesId ?? -1);
}

/** Pure transaction: rewind, replace one floor, then replay later committed changes. */
export function reviseFloorMemory(previous, chat, floor, edit, merge, filterRules = []) {
    const source = floorSource(chat, floor);
    if (!source) conflict('此楼不是有效的 AI 回复。');
    const next = clone(previous);
    const store = next.storySummary;
    if (store.summaryInvalid || store.sourceInvalidFromFloor != null) conflict('原文变动尚未完成回退，请稍后重试。');
    const history = store.summaryHistory ||= [];
    const reservedIds = [...(store.json?.events || []).map(event => event.id), ...history.flatMap(batch => batch.floorEntry?.eventIds || [])];
    let index = history.findIndex(batch => batch.floorEntry?.floor === floor);
    const inserting = index < 0;
    if (inserting && floor <= (store.lastSummarizedMesId ?? -1)) {
        index = history.findIndex(batch => batch.endMesId > floor);
        if (index < 0 || !history[index].floorEntry || floor <= history[index].previousEndMesId
            || floor >= history[index].floorEntry.source.start) conflict('这是旧版区间总结，请在剧情资料中编辑；不能将区间冒充单楼。');
    }
    const tail = index < 0 ? [] : history.slice(index);
    const old = inserting ? null : tail[0]?.floorEntry;
    if (old && !isFloorEntryCurrent(old, chat)) conflict('本楼原文或候选回复已变化，请重新提取。');
    const entry = { version: 1, floor, source, payload: validateFloorPayload(edit.payload ?? old?.payload),
        eventIds: clone(edit.eventIds ?? old?.eventIds ?? []), omitted: edit.omitted ?? old?.omitted ?? false,
        deleted: edit.deleted ?? old?.deleted ?? false, empty: edit.empty ?? old?.empty ?? false,
        suppressDefaultEvent: edit.suppressDefaultEvent ?? old?.suppressDefaultEvent ?? false,
        reviewed: edit.reviewed ?? old?.reviewed ?? false };
    const boundary = index < 0 ? (store.lastSummarizedMesId ?? -1) : tail[0].previousEndMesId;
    const restored = index < 0 ? { json: clone(store.json || {}), atoms: clone(next.stateAtoms || []) }
        : applyExactSummaryHistoryUndo(store.json || {}, history, boundary, store.lastSummarizedMesId, next.stateAtoms || []);
    if (restored.historyDiscontinuous) conflict('总结历史不连续，未写入任何变化。');
    const memory = { json: restored.json, atoms: restored.atoms };
    const rebuilt = index < 0 ? [...history] : history.slice(0, index);
    const work = inserting ? [{ endMesId: floor, maintenance: [], floorEntry: entry }, ...tail] : tail;
    let end = boundary;
    for (const [offset, original] of work.entries()) {
        const before = clone(memory.json);
        const current = offset === 0 ? entry : clone(original.floorEntry);
        let undo;
        if (current) {
            if (!isFloorEntryCurrent(current, chat)) conflict(`第 ${current.floor + 1} 楼原文已变化，需先回退。`);
            const parsed = current.omitted || current.deleted ? { events: [] }
                : prepareFloorPayload(current.payload, memory.json, current.source, current.eventIds, reservedIds, current.suppressDefaultEvent);
            const result = merge(memory.json, parsed, current.floor, { returnMeta: true, sourceStart: current.source.start });
            memory.json = result.json;
            const existingFacts = new Set((before.facts || []).map(fact => fact.id));
            for (const fact of memory.json.facts || []) {
                if (!existingFacts.has(fact.id)) fact.id = `fact-inline-${memoryDigest([current.floor, current.source.digest, fact.s, fact.p]).slice(0, 24)}`;
            }
            undo = buildSummaryUndo(before, memory.json, { aliasChanged: result.aliasChanged, includeAliases: true });
            if (!current.omitted && !current.deleted) current.eventIds = parsed.events.map(event => event.id);
        } else {
            replayLegacy(memory, original); undo = buildSummaryUndo(before, memory.json);
        }
        const batch = createSummaryBatch(end, original.endMesId, undo, original.policy || memoryPolicy(filterRules));
        if (current) batch.floorEntry = current;
        batch.maintenance = replayMaintenance(memory, original.maintenance || []);
        rebuilt.push(batch); end = batch.endMesId;
    }
    const ids = new Set((memory.json.events || []).map(event => event.id));
    for (const event of memory.json.events || []) for (const id of event.causedBy || []) {
        if (!ids.has(id)) conflict(`后续事件仍引用 ${id}，请先修改其前因后再删除。`);
    }
    store.json = memory.json; store.summaryHistory = rebuilt; store.lastSummarizedMesId = end;
    store.updatedAt = Date.now(); delete store.pendingImportBoundary;
    if (store.floorDrafts) delete store.floorDrafts[floor];
    next.stateAtoms = memory.atoms;
    return next;
}
