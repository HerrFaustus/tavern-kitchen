import { protagonistIdentity } from '../story-state/protagonist-identity.js';
import { FIELD_LABELS } from './domain.js';
import { worldStoryRecords } from './world-story-state.js';
import { storyContextLines } from '../story-state/records.js';

const normalize = value => String(value || '').trim().normalize('NFKC').toLocaleLowerCase();
const cache = new WeakMap();
export function authorityIndex(state) {
    if (!state) return { entities: new Map(), bindings: new Map(), memoryNames: new Map() };
    if (cache.has(state)) return cache.get(state);
    const entities = new Map(state.entities.map(entity => [entity.id, entity]));
    const bindings = new Map(), memoryNames = new Map();
    for (const entity of state.entities) for (const binding of entity.bindings) bindings.set(binding, entity);
    // Resolve names through recorded source bindings, never a fresh fuzzy merge.
    for (const record of state.sources.memory?.records || []) {
        const entity = bindings.get(JSON.stringify(['memory', record.key]));
        if (!entity) continue;
        for (const name of [record.name, ...(record.aliases || [])]) {
            const key = normalize(name), previous = memoryNames.get(key);
            memoryNames.set(key, previous === undefined || previous === entity ? entity : null);
        }
    }
    const index = { entities, bindings, memoryNames }; cache.set(state, index); return index;
}
const established = record => record?.nature === 'established_fact';
const fieldKey = value => Object.entries(FIELD_LABELS).find(([, label]) => label === value)?.[0] || value;

export function projectAuthorityFacts(facts, state) {
    if (!state) return facts;
    const { memoryNames } = authorityIndex(state);
    return facts.filter(fact => {
        const fields = memoryNames.get(normalize(fact.s))?.fields;
        const key = fieldKey(fact.p);
        return !established(fields?.[key]) && !established(fields?.['管理员私有/' + key]);
    });
}

// Private fields stay in the full update snapshot. Older saves can also carry an explicit secret label.
export function isPrivateStoryField(field) {
    return /^(?:管理员私有(?:[／/：:]|$)|秘密|私密|隐藏身份|私下关系)/u.test(String(field || '').trim());
}

/** Bounded whole records; hidden fields never revive older contradictory facts. */
export function buildAuthorityContext(state, query = '', maxChars = 4000, playerName = '') {
    if (!state) return '';
    const { entities } = authorityIndex(state), context = normalize(query);
    const candidates = state.entities.filter(entity => Object.values(entity.fields).some(established));
    const relevant = entity => [entity.name, ...entity.aliases].some(name => normalize(name) && context.includes(normalize(name)));
    const sorted = candidates.map((entity, order) => ({ entity, order, hit: relevant(entity) }))
        .sort((a, b) => Number(b.hit) - Number(a.hit) || a.order - b.order);
    const lines = [];
    const opening = '【已确认的当前世界状态】';
    let used = opening.length;
    for (const { entity } of sorted) for (const [field, record] of Object.entries(entity.fields)) {
        if (!established(record) || isPrivateStoryField(field)) continue;
        const raw = record.value;
        const value = raw && typeof raw === 'object' && !Array.isArray(raw) && typeof raw.entityId === 'string'
            ? { ...raw, name: entities.get(raw.entityId)?.name || raw.entityId } : raw;
        const line = JSON.stringify({ id: entity.id, name: entity.name, field: FIELD_LABELS[field] || field, value });
        if (used + line.length + 1 > maxChars) continue;
        lines.push(line); used += line.length + 1;
    }
    const records = worldStoryRecords(state);
    const focus = [...new Set([...state.entities.map(entity => entity.name),
        ...records.flatMap(record => [record.name, record.person, ...(record.participants || []), ...(record.holders || [])])]
        .filter(name => normalize(name) && context.includes(normalize(name))))];
    const player = protagonistIdentity(state.entities, playerName);
    for (const story of storyContextLines(records, [...focus,...player.names])) {
        const line = JSON.stringify({ story });
        if (used + line.length + 1 > maxChars) continue;
        lines.push(line); used += line.length + 1;
    }
    return lines.length ? `${opening}\n${lines.join('\n')}` : '';
}

/** Prompt projection only: geometry and persisted legacy map data stay source-owned. */
export function projectAuthorityMap(map, state) {
    if (!map || !state) return map;
    const { bindings } = authorityIndex(state);
    const copy = { ...map, atlas: { ...map.atlas, locations: map.atlas.locations.map(place => ({ ...place })), actors: map.atlas.actors.map(actor => ({ ...actor })) } };
    const placeKey = entityId => {
        const entity = authorityIndex(state).entities.get(entityId);
        const keys = (entity?.bindings || []).map(value => JSON.parse(value))
            .filter(([module, key]) => module === 'map' && key.startsWith('place:')).map(([, key]) => key.slice(6))
            .filter(key => copy.atlas.locations.some(place => place.key === key));
        return keys.length === 1 ? keys[0] : null;
    };
    for (const location of copy.atlas.locations) {
        const entity = bindings.get(JSON.stringify(['map', `place:${location.key}`]));
        if (!entity) continue;
        location.name = entity.name;
        if (established(entity.fields.description)) {
            const value = entity.fields.description.value;
            if (typeof value === 'string' && value.trim()) location.brief = value;
            else delete location.brief;
        }
        if (established(entity.fields.parent)) {
            const key = placeKey(entity.fields.parent.value?.entityId);
            if (key) location.parent = key; else delete location.parent;
        }
    }
    copy.atlas.actors = copy.atlas.actors.flatMap(actor => {
        const entity = bindings.get(JSON.stringify(['map', `actor:${actor.actorKey}`]));
        if (!entity) return [actor];
        actor.displayName = entity.name;
        if (established(entity.fields.location)) {
            const key = placeKey(entity.fields.location.value?.entityId);
            if (!key) return []; // Unknown/unmapped is not the legacy position.
            actor.locationKey = key;
        }
        return [actor];
    });
    return copy;
}
