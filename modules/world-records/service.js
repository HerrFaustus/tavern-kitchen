import { createIdentifier } from '../../shared/common/identifier.js';
import { applyCommand, emptyWorld, forkWorld, invariant, validateWorld, canonical } from './domain.js';
import { prepareSourceOperations } from './imports.js';
import { prepareTurnOperations, currentTurns, turnEffectConflicts, assertTurnOrigin, turnById } from './turn-ledger.js';
import { captureRangeSource } from '../story-summary/data/turn-source.js';
import { prepareUpdateOperations } from './update-ledger.js';

export function createWorldService({ storage, getIdentity, id = createIdentifier, now = () => new Date().toISOString(), onChanged = () => {}, isSourceCurrent = () => true }) {
    let generation = 0;
    const effectLeases = new WeakMap();
    const capture = () => { const identity = getIdentity(); invariant(identity, '选择一段对话后，可以建立世界档案'); const epoch = generation; return { identity, current: () => generation === epoch && getIdentity() === identity }; };
    const commandFor = (state, operations, title, origin) => ({ id: id(), worldId: state.worldId, branchId: state.branchId, expectedVersion: state.version, at: now(), title, operations,
        ...(origin ? { origin: structuredClone(origin) } : {}) });
    async function publish(bound, operation, changesBranch = false) {
        const result = await operation, state = result?.state || result;
        if (bound.current() && (state === null || state?.worldId)) {
            if (changesBranch) generation++;
            try { onChanged(state, bound.identity); } catch (error) { console.error('[TavernKitchen] 世界投影通知失败', error); }
        }
        return result;
    }
    return {
        scopeVersion() { return generation; },
        invalidate() { generation++; },
        async read() { const bound = capture(); const state = await publish(bound, storage.read(bound.identity)); invariant(bound.current(), '对话已切换'); return state; },
        async ensure(title = '当前故事') {
            const bound = capture();
            return publish(bound, storage.update(bound.identity, state => { const next = state || emptyWorld(id(), id(), title); return { state: next, result: next }; }, bound.current));
        },
        command: commandFor,
        async branches() { const bound = capture(); const branches = await storage.list(bound.identity); invariant(bound.current(), '对话已切换'); return branches; },
        async selectBranch(branchId, expected) { const bound = capture(); return publish(bound, storage.select(bound.identity, branchId, expected, bound.current), true); },
        async commit(command, { guard = () => true } = {}) {
            const bound = capture();
            return publish(bound, storage.update(bound.identity, state => {
                invariant(state, '请先建立世界档案');
                if (command.origin) invariant((!effectLeases.has(command) || effectLeases.get(command) === generation)
                    && isSourceCurrent(turnById(state, command.origin.sourceId)), '正文来源或世界分支已变化，请重新核对');
                const applied = applyCommand(state, command); return { state: applied.state, result: applied };
            }, () => bound.current() && guard()));
        },
        async sync(sources) {
            const bound = capture();
            return publish(bound, storage.update(bound.identity, state => {
                if (!state) return { result: null };
                const operations = prepareSourceOperations(state, sources, id);
                if (!operations.length) return { result: state };
                const applied = applyCommand(state, commandFor(state, operations, '同步已有剧情与地图来源'));
                return { state: applied.state, result: applied.state };
            }, bound.current));
        },
        async syncTurns(chat, { end = chat.length - 1, history = [], memoryAvailable = true, guard = () => true } = {}) {
            const bound = capture();
            return publish(bound, storage.update(bound.identity, state => {
                state ||= emptyWorld(id(), id(), '当前故事');
                const operations = [...(memoryAvailable ? prepareUpdateOperations(state, history, chat) : []),
                    ...prepareTurnOperations(state, chat, { end, history, memoryAvailable, id })];
                if (!operations.length) return { state, result: state };
                const applied = applyCommand(state, commandFor(state, operations, '核对正文来源与记忆交付'));
                return { state: applied.state, result: applied.state };
            }, () => bound.current() && guard()));
        },
        memorySourceReceipt(state, chat, start, end) {
            return { version: 1, id: id(), worldId: state.worldId, branchId: state.branchId, basisVersion: state.version,
                source: captureRangeSource(chat, start, end), turns: currentTurns(state)
                    .filter(turn => turn.source.end >= start && turn.source.start <= end).map(turn => turn.id) };
        },
        // A caller must retain this effect ID across retries. A new transport
        // command ID cannot cause the same source effect to execute twice.
        effectCommand(state, sourceId, effectId, operations, title) {
            const origin = { sourceId, effectId }; assertTurnOrigin(state, origin);
            const command = commandFor(state, operations, title, origin); effectLeases.set(command, generation); return command;
        },
        executionReceipts(state, sourceId) { return state.receipts.filter(receipt => receipt.origin?.sourceId === sourceId).map(receipt => structuredClone(receipt)); },
        assertSourcesConsistent(state) { invariant(!turnEffectConflicts(state).length, '正文来源已变化，关联的世界效果需要核对；请先回到变更前的世界分支'); },
        async fork(expected, version) {
            const bound = capture();
            return publish(bound, storage.update(bound.identity, state => {
                invariant(state?.branchId === expected.branchId && state.version === expected.version, '档案已更新，请重新加载');
                const next = forkWorld(state, version, id()); return { state: next, result: next };
            }, bound.current), true);
        },
        async restore(backup, expected) {
            const parsed = validateWorld(structuredClone(backup));
            const replay = forkWorld(parsed, parsed.version, id());
            invariant(['entities', 'claims', 'sources'].every(key => canonical(parsed[key]) === canonical(replay[key]))
                && canonical(parsed.modules || {}) === canonical(replay.modules || {}), '备份状态与历史不一致');
            const bound = capture();
            return publish(bound, storage.update(bound.identity, state => {
                invariant(state?.branchId === expected.branchId && state.version === expected.version, '档案已更新，请重新加载');
                // Restoring creates a new branch; the previous branch stays on disk.
                return { state: replay, result: replay };
            }, bound.current), true);
        },
    };
}
