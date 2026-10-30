import { getChatIdentity } from '../data/chat-identity.js';
import { extractFloorPayload, floorSource, validateFloorPayload } from './protocol.js';
import { findFloorBatch, isFloorEntryCurrent, reviseFloorMemory } from './ledger.js';

export function createFloorSummaryController({ getContext, enabled, getConfig, ensureSources, read, commit, merge,
    afterCommit = async () => {}, refresh = () => {}, busy = () => false, getFilterRules = () => [] }) {
    let queue = Promise.resolve();
    const errors = new Map();
    const key = floor => `${getChatIdentity(getContext())}/${floorSource(getContext().chat, floor)?.digest}`;
    async function perform(floor, change, expectedSource) {
        const identity = getChatIdentity(getContext());
        const source = floorSource(getContext().chat, floor);
        if (!enabled() || !source) throw new Error('请先启用当前聊天的剧情记录。');
        if (busy()) throw new Error('请等待当前回复完成后再编辑或写入。');
        if (expectedSource && expectedSource !== source.digest) throw new Error('原文已变化，请重新打开本楼编辑。');
        const check = () => {
            if (identity !== getChatIdentity(getContext()) || source.digest !== floorSource(getContext().chat, floor)?.digest) {
                throw new Error('聊天、原文或候选回复已变化，本次修改未写入。');
            }
        };
        await ensureSources(); check();
        const previous = read();
        const old = findFloorBatch(previous.storySummary, floor)?.floorEntry;
        const extracted = extractFloorPayload(getContext().chat[floor].mes);
        const draft = previous.storySummary.floorDrafts?.[floor];
        const payload = change.payload ?? (draft?.source?.digest === source.digest ? draft.payload : old?.payload) ?? extracted.payload;
        if (!payload) throw new Error(extracted.error || '主回复未附带总结，可在楼尾补写，或用酒馆重新生成本楼。');
        const options = { ...(draft?.source?.digest === source.digest ? { eventIds: draft.eventIds, suppressDefaultEvent: draft.suppressDefaultEvent } : {}),
            ...change, payload: validateFloorPayload(payload) };
        let next;
        if (change.stage) {
            next = structuredClone(previous);
            next.storySummary.floorDrafts ||= {};
            next.storySummary.floorDrafts[floor] = { source, payload: options.payload,
                ...(options.eventIds ? { eventIds: options.eventIds } : {}),
                ...(options.suppressDefaultEvent ? { suppressDefaultEvent: true } : {}) };
        } else {
            next = reviseFloorMemory(previous, getContext().chat, floor, options, merge, getFilterRules());
        }
        await commit(getContext().chatId, next, { previous, validate: check });
        check(); errors.delete(key(floor));
        if (!change.stage) {
            try { await afterCommit(floor, previous, next); }
            catch (error) { errors.set(key(floor), `总结已写入，但检索刷新未完成：${error.message}`); }
        }
        refresh();
        return { committed: !change.stage, staged: !!change.stage };
    }
    function update(floor, change = {}, expectedSource) {
        // Capture the owner before queuing; a late action must not switch stories.
        const owner = getChatIdentity(getContext());
        const captured = expectedSource || floorSource(getContext().chat, floor)?.digest;
        const task = queue.then(async () => {
            if (owner !== getChatIdentity(getContext())) throw new Error('聊天已切换，请重新操作。');
            return perform(floor, change, captured);
        });
        queue = task.then(() => undefined, error => {
            if (owner === getChatIdentity(getContext())) errors.set(key(floor), error.message);
        });
        return task.catch(error => { if (owner === getChatIdentity(getContext())) { errors.set(key(floor), error.message); refresh(); } throw error; });
    }
    async function ingest(floor, { force = false } = {}) {
        if (!enabled() || !getConfig().enabled) return { skipped: true };
        const batch = findFloorBatch(read().storySummary, floor);
        if (!force && isFloorEntryCurrent(batch?.floorEntry, getContext().chat)) return { unchanged: true };
        const extracted = extractFloorPayload(getContext().chat?.[floor]?.mes);
        if (extracted.status !== 'ready') { refresh(); return extracted; }
        if (getConfig().review && !force) { refresh(); return { pending: true }; }
        return update(floor, { payload: extracted.payload, omitted: false, deleted: false, empty: false, suppressDefaultEvent: false, reviewed: force });
    }
    return { update, ingest, error: floor => errors.get(key(floor)) || '', reset() { errors.clear(); refresh(); } };
}
