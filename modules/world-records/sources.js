// In-process adapters publish committed source changes; no model calls or polling.
const readers = new Map(), listeners = new Set();
const authorities = new Map();
export function registerWorldAuthority(name, read) {
    authorities.set(name, read);
    return () => { if (authorities.get(name) === read) authorities.delete(name); };
}
export function readWorldAuthority(identity) {
    if (!identity) return null;
    for (const read of authorities.values()) {
        const value = read(); if (value?.identity === identity) return value.state;
    }
    return null;
}
export function notifyWorldSourcesChanged() {
    for (const listener of listeners) try { listener(); } catch (error) { console.error('[TavernKitchen] 世界来源通知失败', error); }
}
export function registerWorldSource(name, reader) {
    readers.set(name, reader); notifyWorldSourcesChanged();
    return () => { if (readers.get(name) === reader) readers.delete(name); };
}
export function readWorldSources() { return [...readers].map(([module, read]) => ({ module, ...read() })).filter(s => s.available); }
export function subscribeWorldSources(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function storyIdentityKey(identity) { return identity ? JSON.stringify([identity.kind, identity.ownerId, identity.chatId]) : ''; }
