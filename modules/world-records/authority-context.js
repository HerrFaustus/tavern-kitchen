import { isRangeSourceCurrent } from '../story-summary/data/turn-source.js';
import { UPDATE_PREFIX } from './update-context.js';
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
export function worldFieldSource(world, context, request) {
    const result = { key: request.key, chatId: context.chatId, branchId: world?.branchId || '' };
    if (!world || request.chatId !== result.chatId || request.branchId !== result.branchId || typeof request.key !== 'string') return result;
    const receipt = world.receipts?.find(r => r.origin?.effectId === request.key);
    if (receipt) {
        const turn = Object.values(world.sources || {}).find(row => row.id === receipt.origin.sourceId);
        const proof = world.events.find(e => e.id === receipt.eventId)?.effects.flatMap(e => [
            e.after?.source, ...Object.values(e.after?.fields || {}).map(f => f.source),
        ]).find(source => source?.key === request.key && source.proof)?.proof;
        if (proof && isRangeSourceCurrent(turn?.source,context.chat) && context.chat[proof.floor]?.mes.includes(proof.quote))
            return {...result,floor:proof.floor,text:context.chat[proof.floor].mes,quote:proof.quote};
    }
    const match = /^(.*)\/(\d+)$/.exec(request.key);
    if (!match) return result;
    const update = world.sources?.[UPDATE_PREFIX + match[1]]?.update;
    const proof = update?.proposals[Number(match[2])]?.evidence;
    const message = context.chat?.[proof?.floor];
    // A floor number can point at a different swipe or edit. Verify the original receipt before displaying live text.
    if (proof && message && isRangeSourceCurrent(update.source, context.chat) && String(message.mes || '').includes(proof.quote)) {
        Object.assign(result, { floor: proof.floor, name: message.name || '', text: message.mes });
    }
    return result;
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
