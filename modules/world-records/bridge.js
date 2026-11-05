// Runtime discovery only. Durable state and version checks belong to the world service.
const providers = new Set(), listeners = new Set(), versions = new Map();
let revision = 0;
function viewStamp(identity, state) {
    let scope = 0;
    for (const read of providers) {
        const provider = read();
        if (provider?.identity === identity) { scope = provider.service.scopeVersion(); break; }
    }
    return { scope, key: JSON.stringify([identity, scope, state?.worldId, state?.branchId, state?.version]) };
}
export function registerWorldBridge(read) {
    providers.add(read);
    return () => { providers.delete(read); if (!providers.size) versions.clear(); };
}
export function getWorldBridge(storyIdentity) {
    if (storyIdentity) for (const read of providers) {
        const value = read();
        if (value?.storyIdentity === storyIdentity && value.identity) return value;
    }
    throw new Error('世界内核尚未就绪，请稍后重试');
}
export function publishWorldBridgeState(storyIdentity, identity, state) {
    const { key, scope } = viewStamp(identity, state);
    const previous = versions.get(identity);
    if (previous?.key === key) return;
    if (state && previous?.scope === scope && previous.branchId === state.branchId && previous.version > state.version) return;
    versions.set(identity, { key, scope, branchId: state?.branchId, version: state?.version, revision: ++revision });
    for (const listener of listeners) {
        try { listener({ storyIdentity, identity, state }); }
        catch (error) { console.error('[TavernKitchen] 世界模块通知失败', error); }
    }
}
// A runtime lease, not the persisted map's revision. Selecting a different branch
// with the same world version must still invalidate old editor requests.
export function worldViewRevision(identity, state) {
    const current = versions.get(identity);
    if (!current || current.key !== viewStamp(identity, state).key) {
        throw new Error('世界状态已变化，请重新读取地图');
    }
    return current.revision;
}
export const worldMapViewRevision = worldViewRevision;
export function subscribeWorldBridge(listener) { listeners.add(listener); return () => listeners.delete(listener); }
