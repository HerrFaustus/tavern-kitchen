import { createIdentifier } from '../../shared/common/identifier.js';
import { applyCommand, emptyWorld, forkWorld, invariant, validateWorld, canonical } from './domain.js';
import { prepareSourceOperations } from './imports.js';

export function createWorldService({ storage, getIdentity, id = createIdentifier, now = () => new Date().toISOString() }) {
    let generation = 0;
    const capture = () => { const identity = getIdentity(); invariant(identity, '选择一段对话后，可以建立世界档案'); const epoch = generation; return { identity, current: () => generation === epoch && getIdentity() === identity }; };
    const commandFor = (state, operations, title) => ({ id: id(), worldId: state.worldId, branchId: state.branchId, expectedVersion: state.version, at: now(), title, operations });
    return {
        invalidate() { generation++; },
        async read() { const bound = capture(); const state = await storage.read(bound.identity); invariant(bound.current(), '对话已切换'); return state; },
        async ensure(title = '当前故事') {
            const bound = capture();
            return storage.update(bound.identity, state => { const next = state || emptyWorld(id(), id(), title); return { state: next, result: next }; }, bound.current);
        },
        command: commandFor,
        async branches() { const bound = capture(); const branches = await storage.list(bound.identity); invariant(bound.current(), '对话已切换'); return branches; },
        async selectBranch(branchId, expected) { const bound = capture(); return storage.select(bound.identity, branchId, expected, bound.current); },
        async commit(command) {
            const bound = capture();
            return storage.update(bound.identity, state => { invariant(state, '请先建立世界档案'); const applied = applyCommand(state, command); return { state: applied.state, result: applied }; }, bound.current);
        },
        async sync(sources) {
            const bound = capture();
            return storage.update(bound.identity, state => {
                if (!state) return { result: null };
                const operations = prepareSourceOperations(state, sources, id);
                if (!operations.length) return { result: state };
                const applied = applyCommand(state, commandFor(state, operations, '同步已有剧情与地图来源'));
                return { state: applied.state, result: applied.state };
            }, bound.current);
        },
        async fork(expected, version) {
            const bound = capture();
            return storage.update(bound.identity, state => {
                invariant(state?.branchId === expected.branchId && state.version === expected.version, '档案已更新，请重新加载');
                const next = forkWorld(state, version, id()); return { state: next, result: next };
            }, bound.current);
        },
        async restore(backup, expected) {
            const parsed = validateWorld(structuredClone(backup));
            const replay = forkWorld(parsed, parsed.version, id());
            invariant(['entities', 'claims', 'sources'].every(key => canonical(parsed[key]) === canonical(replay[key])), '备份状态与历史不一致');
            const bound = capture();
            return storage.update(bound.identity, state => {
                invariant(state?.branchId === expected.branchId && state.version === expected.version, '档案已更新，请重新加载');
                // Restoring creates a new branch; the previous branch stays on disk.
                return { state: replay, result: replay };
            }, bound.current);
        },
    };
}
