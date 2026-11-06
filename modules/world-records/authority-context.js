import { ambientRecords } from '../story-state/ambient.js';
import { situationViewRecords } from '../story-state/situation-history.js';
import { readLinkedDevelopments } from '../story-state/situation-links.js';
import { captureStoryIdentity } from '../xiaobai-os/host/story-identity.js';
import { storyIdentityKey, readWorldAuthority } from './sources.js';
import { projectAuthorityFacts, projectAuthorityMap } from './authority.js';
import { worldStoryStore } from './world-story-state.js';

export function worldAuthorityForContext(context) {
    return readWorldAuthority(storyIdentityKey(captureStoryIdentity(context || {})));
}
export function authorityMemoryFacts(facts, context) { return projectAuthorityFacts(facts, worldAuthorityForContext(context)); }
export function authorityStoryStore(store, context, forDisplay = false) {
    const world = worldAuthorityForContext(context);
    const result = worldStoryStore(store, world);
    if (!forDisplay || !result?.json) return result;
    const rows = [...situationViewRecords(result.json.storyRecords || [], store, world,
        readLinkedDevelopments(captureStoryIdentity(context)?.key)), ...ambientRecords(store, world)];
    const titles = new Map(rows.filter(record => record.kind === 'situation').map(record => [record.id, record.title]));
    return { ...result, json: { ...result.json, storyRecords: rows.map(record => record.relatedId
        ? { ...record, _relatedTitle: titles.get(record.relatedId) } : record) } };
}
export function authorityMemoryStoryStore(store, context) {
    const state = worldAuthorityForContext(context), owned = new Set((state?.modules?.story?.records || []).map(entry => entry.record.id));
    if (!store?.json || !owned.size) return store;
    return { ...store, json: { ...store.json, storyRecords: (store.json.storyRecords || []).filter(record => !owned.has(record.id)) } };
}
export function authorityMap(map, identity) { return projectAuthorityMap(map, readWorldAuthority(storyIdentityKey(identity))); }
