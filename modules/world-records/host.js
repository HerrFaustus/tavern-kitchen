import { createWorldStorage } from './storage.js';
import { createWorldService } from './service.js';
import { createWorldPanel } from './panel.js';
import { createWorldOverview } from './overview.js';
import { createStoryOverview } from '../story-state/view.js';
import { memoryRecords } from './imports.js';
import { readWorldSources, registerWorldSource, registerWorldAuthority, storyIdentityKey, subscribeWorldSources } from './sources.js';
import { createAuthorityRuntime } from './authority-runtime.js';
import { captureStoryIdentity } from '../xiaobai-os/host/story-identity.js';

export function createWorldArchive({ getContext, getAccountId = () => 'default-user', getMemorySnapshot, getMount, isVisible, navigate, onError, onAuthorityChange = () => {} }) {
    const sourceIdentity = () => storyIdentityKey(captureStoryIdentity(getContext()));
    const identity = () => { const story = sourceIdentity(); return story ? JSON.stringify([getAccountId(), story]) : ''; };
    const storage = createWorldStorage();
    let authority;
    const service = createWorldService({ storage, getIdentity: identity, onChanged: (state, owner) => authority?.publish(state, owner) });
    authority = createAuthorityRuntime({ getIdentity: identity, getStoryIdentity: sourceIdentity, sync, onChange: onAuthorityChange });
    const unregisterAuthority = registerWorldAuthority('world-records', authority.read);
    const panel = createWorldPanel({ service, sync, getIdentity: identity });
    const overview = createWorldOverview({ navigate });
    const storyOverview = createStoryOverview({ getSnapshot: getMemorySnapshot, navigate });
    const views = { overview: storyOverview, world: overview, 'world-management': panel };
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
            sync().then(state => { if (state) for (const [route, view] of Object.entries(views)) if (isVisible(route) && !view.isEditing()) view.show(state); }).catch(error => onError(error));
        });
    });
    return {
        prepare: query => authority.prepare(query),
        async open(route = 'world') {
            const view = views[route]; if (!view) return;
            view.mount(getMount(route));
            if (!identity()) { view.empty(); return; }
            await service.ensure(getContext().chatId || '当前故事');
            const state = await sync(); if (isVisible(route) && !disposed) view.show(state || await service.read());
        },
        reset() { epoch++; service.invalidate(); authority.reset(); for (const view of Object.values(views)) view.reset(); },
        dispose() { disposed = true; service.invalidate(); authority.reset(); unregisterAuthority(); unsubscribe(); unregisterMemory(); for (const view of Object.values(views)) view.reset(); storage.close().catch(error => onError(error)); },
    };
}
