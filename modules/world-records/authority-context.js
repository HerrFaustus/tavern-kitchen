import { captureStoryIdentity } from '../xiaobai-os/host/story-identity.js';
import { storyIdentityKey, readWorldAuthority } from './sources.js';
import { projectAuthorityFacts, projectAuthorityMap } from './authority.js';

export function worldAuthorityForContext(context) {
    return readWorldAuthority(storyIdentityKey(captureStoryIdentity(context || {})));
}
export function authorityMemoryFacts(facts, context) { return projectAuthorityFacts(facts, worldAuthorityForContext(context)); }
export function authorityMap(map, identity) { return projectAuthorityMap(map, readWorldAuthority(storyIdentityKey(identity))); }
