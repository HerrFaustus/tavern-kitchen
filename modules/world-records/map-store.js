import { getWorldBridge, subscribeWorldBridge, worldMapViewRevision } from './bridge.js';
import { canonical, invariant } from './domain.js';
import { prepareMapOperations, readWorldMap } from './map-commands.js';
import { parseMapDomain } from '../xiaobai-os/domains/map/invariants.js';
import { createEmptyMapDomain } from '../xiaobai-os/domains/map/state.js';
import { createIdentifier } from '../../shared/common/identifier.js';

const openingReaders = new Set();
export async function readMapBeforeOpening(service) {
    for (const reader of openingReaders) if (await reader(service)) return true;
    return false;
}

/**
 * @returns {{store: import('../xiaobai-os/kernel/contracts.js').PartitionStore<import('../xiaobai-os/domains/map/types.js').MapDomainV1>, files: import('../xiaobai-os/kernel/contracts.js').XiaobaiOsFileControls, dispose: () => void}}
 */
export function createWorldMapStore({ legacyStore, legacyFiles, getStoryIdentity }) {
    let cached = null, cachedOwner = '', cachedEpoch = -1, fileState = 'loading', disposed = false, writing = false, pending = null;
    let queue = Promise.resolve();
    const listeners = new Set(), fileListeners = new Set();
    const bridge = () => { const owner = getWorldBridge(getStoryIdentity()); return { ...owner, epoch: owner.service.scopeVersion() }; };
    const current = owner => {
        if (disposed) return false;
        try { const active = bridge(); return active.identity === owner.identity && active.service === owner.service && active.epoch === owner.epoch; }
        catch { return false; }
    };
    const copy = value => structuredClone(value);
    function status(next) {
        fileState = next;
        for (const listener of fileListeners) {
            try { listener({ identityKey: cached?.identityKey || '', state: next }); }
            catch (error) { console.error('[TavernKitchen] 地图保存状态通知失败', error); }
        }
    }
    function publish(state, identity) {
        if (disposed || !state) return;
        const epoch = bridge().epoch;
        if (pending && (pending.owner.identity !== identity || pending.owner.epoch !== epoch)) pending = null;
        let value, invalid;
        try { value = readWorldMap(state); }
        catch (error) { value = null; invalid = error; console.error('[TavernKitchen] 世界地图投影失败', error); }
        if (value) value.revision = worldMapViewRevision(identity, state);
        cachedOwner = identity; cachedEpoch = epoch;
        cached = { identityKey: JSON.stringify([identity, state.branchId]), osId: state.worldId, envelopeRevision: state.version, value };
        if (invalid) status('failed');
        if (value && !writing && !pending) status('ready');
        for (const listener of listeners) {
            try { listener(copy(cached)); }
            catch (error) { console.error('[TavernKitchen] 地图投影通知失败', error); }
        }
    }
    async function readOpeningMap(service) {
        if (!getStoryIdentity() || bridge().service !== service) return false;
        await read();
        return true;
    }
    openingReaders.add(readOpeningMap);
    const unsubscribe = subscribeWorldBridge(event => {
        if (event.storyIdentity !== getStoryIdentity()) return;
        let owner; try { owner = bridge(); } catch { return; }
        if (owner.identity === event.identity) publish(event.state, event.identity);
    });
    async function baseline() {
        const owner = bridge();
        let state = await owner.service.read();
        invariant(current(owner), '对话已切换，地图操作已取消');
        if (!state) state = await owner.service.ensure();
        invariant(current(owner), '对话已切换，地图操作已取消');
        let raw = state.modules?.map;
        if (raw === undefined && state.parent) raw = createEmptyMapDomain();
        if (raw === undefined) {
            const legacy = await legacyStore.readRaw();
            invariant(current(owner), '对话已切换，地图导入已取消');
            invariant(legacyFiles.getFileState() === 'ready', '旧地图尚未确认保存，请先重试或恢复');
            raw = legacy.value ?? createEmptyMapDomain();
        }
        return { owner, state, raw };
    }
    function project(state, raw, identity) {
        const value = readWorldMap({ ...state, modules: { ...state.modules, map: parseMapDomain(raw) } });
        value.revision = worldMapViewRevision(identity, state); return value;
    }
    async function readRaw() {
        const { owner, state, raw } = await baseline();
        worldMapViewRevision(owner.identity, state);
        let value = raw;
        try { value = project(state, raw, owner.identity); } catch { value = copy(raw); }
        publish(state, owner.identity);
        return { identityKey: JSON.stringify([owner.identity, state.branchId]), osId: state.worldId, envelopeRevision: state.version, value: copy(value) };
    }
    async function read() {
        try {
            const { owner, state, raw } = await baseline();
            const value = project(state, raw, owner.identity);
            let confirmed = state;
            if (!state.modules?.map) {
                const operations = prepareMapOperations(state, null, value, createIdentifier);
                try { confirmed = (await owner.service.commit(owner.service.command(state, operations, '接管地图存档'))).state; }
                catch (error) {
                    const winner = await owner.service.read();
                    if (!winner?.modules?.map || winner.worldId !== state.worldId || winner.branchId !== state.branchId) throw error;
                    confirmed = winner;
                }
            }
            invariant(current(owner), '对话已切换，地图读取已取消');
            publish(confirmed, owner.identity); status(pending ? 'failed' : 'ready');
            return copy(cached);
        } catch (error) { status('failed'); throw error; }
    }
    async function transact(command, options = {}) {
        let result, operationOwner;
        writing = true; status('saving');
        try {
            if (pending && !current(pending.owner)) pending = null;
            invariant(!pending, '上次地图保存尚未恢复，请先重试或重新加载');
            const { owner, state, raw } = await baseline();
            operationOwner = owner;
            let value, invalid;
            worldMapViewRevision(owner.identity, state);
            try { value = project(state, raw, owner.identity); } catch (error) { invalid = error; }
            let candidate, replaced = false;
            const transaction = {
                rawCurrent: copy(value || raw),
                get current() { if (invalid) throw invalid; return copy(value); },
                currentOrInitial() { if (invalid) throw invalid; return copy(value || createEmptyMapDomain()); },
                replace(next) { candidate = parseMapDomain(next); replaced = true; },
                useCapability() { throw new Error('地图事务不支持跨模块能力写入'); },
            };
            result = await command(transaction);
            invariant(current(owner) && !options.signal?.aborted, '地图保存已取消或对话已切换');
            if (options.commitGuard) invariant(await options.commitGuard(), '地图保存条件已变化');
            invariant(current(owner) && !options.signal?.aborted, '地图保存已取消或对话已切换');
            if (!replaced || value && canonical({ ...value, revision: 0 }) === canonical({ ...candidate, revision: 0 })) {
                writing = false; status('ready'); return { status: 'unchanged', result };
            }
            const operations = prepareMapOperations(state, value || null, candidate, createIdentifier);
            const prepared = owner.service.command(state, operations, '保存地图与世界状态');
            pending = { owner, command: prepared, options };
            const applied = await owner.service.commit(prepared);
            pending = null;
            invariant(current(owner), '地图已保存到原对话，当前对话已切换');
            writing = false; publish(applied.state, owner.identity); status('ready');
            return { status: 'confirmed', result, snapshot: copy(cached) };
        } catch (error) {
            writing = false; status(operationOwner && !current(operationOwner) ? store.peekCurrent()?.value ? 'ready' : 'loading' : 'failed');
            return { status: 'failed', error: { code: error.code || 'world_map_save_failed', message: error.message || '地图未保存', retryable: true } };
        }
    }
    const store = {
        peekBinding() {
            try { const owner = bridge(); return cachedOwner === owner.identity && cachedEpoch === owner.epoch ? { identityKey: cached.identityKey, osId: cached.osId } : null; }
            catch { return null; }
        },
        peekCurrent() { try { const owner = bridge(); return cachedOwner === owner.identity && cachedEpoch === owner.epoch ? copy(cached) : null; } catch { return null; } },
        read, readRaw,
        transact(command, options) { const pending = queue.then(() => transact(command, options)); queue = pending.then(() => {}, () => {}); return pending; },
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    };
    const recover = async (options = {}, adopt = false) => {
        try {
            if (options.beforeRetry) invariant(await options.beforeRetry(), '地图恢复条件已变化');
            if (adopt) pending = null;
            if (pending) {
                invariant(current(pending.owner) && !pending.options.signal?.aborted, '原地图保存已取消或对话已切换');
                if (pending.options.commitGuard) invariant(await pending.options.commitGuard(), '原地图保存条件已变化');
                const saved = await pending.owner.service.commit(pending.command);
                const identity = pending.owner.identity; pending = null;
                publish(saved.state, identity); status('ready');
                return { status: 'confirmed' };
            }
            const state = await bridge().service.read();
            if (!state?.modules?.map && legacyFiles.getFileState() !== 'ready') {
                const recovery = adopt ? await legacyFiles.adoptServerState() : await legacyFiles.retryPending(options);
                if (!['none', 'confirmed', 'adopted'].includes(recovery.status)) return recovery;
            }
            await read(); return { status: 'confirmed' };
        } catch (error) { return { status: 'failed', error: { code: error.code || 'world_map_read_failed', message: error.message, retryable: true } }; }
    };
    return {
        store,
        files: {
            getFileState: () => store.peekCurrent() ? fileState : 'loading',
            retryPending: options => recover(options),
            adoptServerState: guard => recover({ beforeRetry: guard }, true),
            hasPendingCommit: () => !!pending,
            subscribeFileState(listener) { fileListeners.add(listener); return () => fileListeners.delete(listener); },
        },
        dispose() { disposed = true; openingReaders.delete(readOpeningMap); unsubscribe(); listeners.clear(); fileListeners.clear(); cached = null; pending = null; },
    };
}
