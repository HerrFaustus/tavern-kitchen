import { createWorldStorage } from './storage.js';
import { createWorldService } from './service.js';
import { createWorldPanel } from './panel.js';
import { memoryRecords } from './imports.js';
import { readWorldSources, registerWorldSource, storyIdentityKey, subscribeWorldSources } from './sources.js';
import { captureStoryIdentity } from '../xiaobai-os/host/story-identity.js';

export function createWorldArchive({ getContext, getAccountId = () => 'default-user', getMemorySnapshot, getMount, isVisible, onError }) {
    const sourceIdentity = () => storyIdentityKey(captureStoryIdentity(getContext()));
    const identity = () => { const story = sourceIdentity(); return story ? JSON.stringify([getAccountId(), story]) : ''; };
    const storage = createWorldStorage();
    const service = createWorldService({ storage, getIdentity: identity });
    const panel = createWorldPanel({ service, sync, getIdentity: identity });
    let disposed = false, scheduled = false, epoch = 0;
    async function sync() {
        const key = identity(), token = epoch; if (!key || disposed) return null;
        const state = await service.sync(readWorldSources().filter(s => s.identity === sourceIdentity()));
        return token === epoch && key === identity() && !disposed ? state : null;
    }
    const unregisterMemory = registerWorldSource('memory', () => {
        const snapshot = getMemorySnapshot();
        return { available: !!snapshot?.enabled, identity: sourceIdentity(), label: '剧情记忆', records: snapshot?.invalidFrom === undefined ? memoryRecords(snapshot?.store) : [] };
    });
    const unsubscribe = subscribeWorldSources(() => {
        if (scheduled || disposed) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            sync().then(state => { if (state && isVisible() && !panel.isEditing()) panel.show(state); }).catch(error => onError(error));
        });
    });
    return {
        async open() {
            panel.mount(getMount());
            if (!identity()) { panel.empty(); return; }
            await service.ensure(getContext().chatId || '当前故事');
            const state = await sync(); if (isVisible() && !disposed) panel.show(state || await service.read());
        },
        reset() { epoch++; service.invalidate(); panel.reset(); },
        dispose() { disposed = true; service.invalidate(); unsubscribe(); unregisterMemory(); panel.reset(); storage.close().catch(error => onError(error)); },
    };
}
