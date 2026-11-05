import { captureStoryIdentity } from '../xiaobai-os/host/story-identity.js';
import { storyIdentityKey, readWorldAuthority } from './sources.js';
import { projectAuthorityFacts, projectAuthorityMap } from './authority.js';
import { worldStoryStore } from './world-story-state.js';

export function worldAuthorityForContext(context) {
    return readWorldAuthority(storyIdentityKey(captureStoryIdentity(context || {})));
}
export function authorityMemoryFacts(facts, context) { return projectAuthorityFacts(facts, worldAuthorityForContext(context)); }
export function authorityStoryStore(store, context) { return worldStoryStore(store, worldAuthorityForContext(context)); }
export function authorityMemoryStoryStore(store, context) {
    const state = worldAuthorityForContext(context), owned = new Set((state?.modules?.story?.records || []).map(entry => entry.record.id));
    if (!store?.json || !owned.size) return store;
    return { ...store, json: { ...store.json, storyRecords: (store.json.storyRecords || []).filter(record => !owned.has(record.id)) } };
}
export function authorityMap(map, identity) { return projectAuthorityMap(map, readWorldAuthority(storyIdentityKey(identity))); }
