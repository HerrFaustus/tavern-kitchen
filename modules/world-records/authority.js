import { indexGeography } from '../story-state/regional-proximity.js';
import { nameKey, protagonistIdentity } from '../story-state/protagonist-identity.js';
import { ageDisplay, latestStoryTime } from '../story-state/time-rel.js';
import { importantPossession, POSSESSION_ROLES } from './person-fields.js';
import { FIELD_LABELS } from './domain.js';
import { worldStoryRecords } from './world-story-state.js';
import { storyContextGroups, storyRecordText } from '../story-state/records.js';

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

const PERSON_TIER_LABELS = Object.freeze({
    important: '重要角色',
    present: '在场',
    nearby: '同区域',
    absent: '不在场',
});

const PRIORITY_FIELDS = ['coins', 'location', 'owner', 'status', 'presence', 'condition', 'outfit', 'relation', 'title', 'identity', 'role', 'age', 'gender', 'personality', 'parent'];
const BULKY_FIELDS = new Set(['description', 'appearance', 'bio', 'history', 'background']);
const NEARBY_FIELDS = new Set(['location', 'title', 'identity', 'role', 'relation', 'gender', 'age', 'personality', 'presence', 'status', 'coins', 'owner']);
const ABSENT_FIELDS = new Set(['location', 'title', 'identity', 'relation', 'gender', 'coins', 'owner']);

function fieldPriority(field) {
    const idx = PRIORITY_FIELDS.indexOf(field);
    if (idx >= 0) return idx;
    if (BULKY_FIELDS.has(field)) return 100 + PRIORITY_FIELDS.length;
    return PRIORITY_FIELDS.length;
}

/** Bounded whole records; hidden fields never revive older contradictory facts. */
export function buildAuthorityContext(state, query = '', maxChars = 4000, playerName = '', involvement = [], options = {}) {
    if (!state) return '';
    const { entities } = authorityIndex(state);
    const context = normalize(query);
    const relevant = entity => [entity.name, ...entity.aliases].some(name => normalize(name) && context.includes(normalize(name)));
    const player = protagonistIdentity(state.entities, playerName);
    const enabled = options.tasks && new Set(options.tasks);
    const accepts = (...keys) => !enabled || keys.some(key => enabled.has(key));
    const inventory = entity => entity.kind === 'item' && player.hero && Object.entries(entity.fields).some(
        ([field, record]) => Object.hasOwn(POSSESSION_ROLES, field) && established(record) && record.value?.entityId === player.hero.id);
    const candidates = state.entities.filter(entity => {
        if (!enabled) return entity.kind === 'person' || Object.values(entity.fields).some(established);
        if (entity.kind === 'place') return accepts('places','mapEvolution','subscribed','sceneryEvolution','encounter');
        if (entity.kind === 'item') return accepts('overview') && inventory(entity)
            || accepts('people','peopleEvolution') && importantPossession(entity);
        return accepts('people','peopleEvolution') || entity === player.hero && accepts('overview');
    });
    const geo = indexGeography(state.entities, state.modules?.map?.atlas || {});
    const heroPlaceId = player.hero?.fields?.location?.value?.entityId || '';
    const here = heroPlaceId ? geo.ancestry('entity:' + heroPlaceId) : [];
    const region = here.find(p => p.scale === 'region') || here.find(p => ['city', 'district'].includes(p.scale)) || here[0];
    const explicitRegion = here.find(p => p.scale === 'region') || here.find(p => ['city', 'district'].includes(p.scale));
    const local = id => !!region && geo.ancestry(id).some(place => place.id === region.id);
    const sceneRelation = placeId => {
        if (!heroPlaceId || !placeId) return 'unknown';
        if (placeId === heroPlaceId) return 'same';
        const chain = geo.ancestry('entity:' + placeId);
        if ((explicitRegion && chain.some(p => p.id === explicitRegion.id))
            || (!explicitRegion && here[1] && chain.some(p => p.id === here[1].id))
            || chain.some(p => p.id === 'entity:' + heroPlaceId)
            || here.some(p => p.id === 'entity:' + placeId)) {
            return 'near';
        }
        return 'far';
    };
    const near = new Set(involvement.filter(row => row.near).map(row => row.key));
    const importantSet = new Set(involvement.filter(row => row.important || row.core).map(row => row.key));
    const inFocus = entity => entity === player.hero || near.has('person/' + entity.id) || relevant(entity) || local('entity:' + (entity.kind === 'place' ? entity.id : entity.fields.location?.value?.entityId));

    const recordTasks = {person:['people','peopleEvolution'], knowledge:['people','peopleEvolution'], goal:['people','peopleEvolution'], plan:['people','peopleEvolution','situation','subscribed'],
        situation:['situation','subscribed','sceneryEvolution','encounter'], clock:['situation','subscribed'], suspense:['suspense']};
    const records = (Array.isArray(options.storyRecords) ? options.storyRecords : worldStoryRecords(state))
        .filter(record => accepts(...(recordTasks[record.kind] || [])) && (!record._task || accepts(record._task)));
    const nowTime = options.nowTime || latestStoryTime(null, null, records);
    const hasSceneAnchor = Boolean(heroPlaceId) || records.some(r => r.kind === 'person');

    const people = new Map(records.filter(r => r.kind === 'person').map(r => [nameKey(r.name),r]));
    const nameOwners = new Map();
    for (const entity of candidates) if (entity.kind === 'person') for (const name of [entity.name, ...entity.aliases].map(nameKey)) {
        if (!nameOwners.has(name)) nameOwners.set(name, entity);
        else if (nameOwners.get(name) !== entity) nameOwners.set(name, null);
    }
    const activeNames = new Set(), guardNames = new Set();
    for (const [key, person] of people) if (person.presence === 'present' && !player.names.has(key)) guardNames.add(person.name);
    const classifyPerson = entity => {
        if (entity === player.hero) return { tier: 'hero', rank: 0 };
        const labels = [entity.name, ...entity.aliases].map(nameKey).filter(name => nameOwners.get(name) === entity);
        const storyPresence = labels.map(name => people.get(name)?.presence).find(Boolean);
        const locId = established(entity.fields?.location) ? entity.fields.location.value?.entityId : '';
        const rel = sceneRelation(locId);
        const important = (established(entity.fields?.important) && Boolean(entity.fields.important.value))
            || importantSet.has('person/' + entity.id);
        const present = storyPresence === 'present' || (!['away','nearby'].includes(storyPresence)
            && (rel === 'same' || (established(entity.fields?.follow) && entity.fields.follow.value)));
        if (present) for (const name of labels) activeNames.add(name);
        if (present || important) guardNames.add(entity.name);
        if (important) return { tier: 'important', rank: 1 };
        if (present) {
            return { tier: 'present', rank: 2 };
        }
        if (storyPresence === 'nearby' || rel === 'near' || near.has('person/' + entity.id) || relevant(entity)) {
            return { tier: 'nearby', rank: 3 };
        }
        return { tier: 'absent', rank: 4 };
    };

    const heldByHero = (field, record) => player.hero && Object.hasOwn(POSSESSION_ROLES, field)
        && established(record) && record.value?.entityId === player.hero.id;
    const isItemReachable = entity => {
        if (entity.kind !== 'item') return true;
        const ownerId = established(entity.fields?.owner) ? entity.fields.owner.value?.entityId : '';
        if (Object.entries(entity.fields).some(([field, record]) => heldByHero(field, record))) return true;
        const locId = established(entity.fields?.location) ? entity.fields.location.value?.entityId : '';
        if (heroPlaceId && locId) {
            if (locId === heroPlaceId) return true;
            const itemChain = geo.ancestry('entity:' + locId);
            return here.some(p => p.id === 'entity:' + locId) || itemChain.some(p => p.id === 'entity:' + heroPlaceId);
        }
        if (ownerId && player.hero && ownerId !== player.hero.id) {
            const ownerLoc = entities.get(ownerId)?.fields?.location?.value?.entityId || '';
            return sceneRelation(ownerLoc) === 'same';
        }
        return true;
    };

    const sorted = candidates.map((entity, order) => {
        const hit = relevant(entity);
        if (entity.kind === 'person') {
            const { tier, rank } = classifyPerson(entity);
            return { entity, order, hit, tier, rank, reachable: true };
        }
        if (entity.kind === 'item') {
            const reachable = isItemReachable(entity);
            return { entity, order, hit, tier: reachable ? 'item' : 'item_elsewhere', rank: reachable ? 5 : 6, reachable };
        }
        return { entity, order, hit, tier: entity.kind, rank: 2, reachable: true };
    }).sort((a, b) => a.rank - b.rank || Number(b.hit) - Number(a.hit) || a.order - b.order);

    const lines = [];
    const opening = '【已确认的当前世界状态】';
    let used = opening.length;
    const appendLine = line => {
        if (used + line.length + 1 > maxChars) return false;
        lines.push(line);
        used += line.length + 1;
        return true;
    };

    const openingIds = new Set((state.modules?.story?.records || []).filter(item => item.source.module === 'world-opening').map(item => item.record.id));
    const visible = records.filter(record => !openingIds.has(record.id) || near.has('situation/' + record.id) || context.includes(normalize(record.title)) || record.scope &&
        (context.includes(normalize(record.scope)) || local(geo.resolve(record.scope))));
    const focus = [...guardNames, ...records.flatMap(row => [row.name, row.person, ...(row.holders || [])])
        .filter(name => name && context.includes(normalize(name)))];
    const story = storyContextGroups(visible, focus, { protagonistNames: player.names, presentNames: activeNames });
    const appendStory = text => appendLine(JSON.stringify({ story: text }));
    const playerLabel = player.title || '主角';
    const hasKnowledge = new Set(visible.filter(r => r.kind === 'knowledge').map(r => nameKey(r.person)));
    const guards = [...guardNames].map(name => {
        const prefix = hasKnowledge.has(nameKey(name)) ? '' : '暂无记录。';
        return `[角色对${playerLabel}的了解] ${name}：${prefix}未列出的过往隐私与秘密默认不知情。`;
    });
    if (guards.join('').length > maxChars / 4) appendStory(`所有在场及重要角色对${playerLabel}未列出的过往隐私与秘密默认不知情。`);
    else for (const guard of guards) appendStory(guard);
    for (const line of story.priority) appendStory(line);
    const details = [];
    for (const item of sorted) {
        const { entity, tier, hit, reachable } = item;
        if (entity.kind === 'item' && !reachable) {
            const fieldsVisible = Object.entries(entity.fields)
                .filter(([field, record]) => established(record) && !isPrivateStoryField(field) && (record.source?.module !== 'world-opening' || inFocus(entity)));
            if (!fieldsVisible.length) continue;
            const locId = established(entity.fields?.location) ? entity.fields.location.value?.entityId : '';
            const ownerId = established(entity.fields?.owner) ? entity.fields.owner.value?.entityId : '';
            const locName = locId ? (entities.get(locId)?.name || locId) : (ownerId ? (entities.get(ownerId)?.name || ownerId) : '他处');
            details.push(JSON.stringify({ id: entity.id, name: entity.name, field: '他处寄存', value: `${locName}(不在当前场景)` }));
            continue;
        }

        const fieldEntries = Object.entries(entity.fields)
            .sort(([a], [b]) => fieldPriority(a) - fieldPriority(b));

        for (const [field, record] of fieldEntries) {
            if (!established(record) || isPrivateStoryField(field)) continue;
            if (['coins','金币'].includes(field) && (entity.id !== player.hero?.id || !accepts('overview'))) continue;
            if (record.source?.task && !accepts(record.source.task)) continue;
            if (enabled && entity === player.hero && !accepts('people','peopleEvolution') && !['coins','金币','location','status','condition'].includes(field)) continue;

            if (record.source?.module === 'world-opening' && !inFocus(entity) && !heldByHero(field, record)) continue;
            if (entity.kind === 'person' && tier === 'nearby') {
                const allowShortDesc = field === 'description' && hit && typeof record.value === 'string' && record.value.length <= 160;
                if (!NEARBY_FIELDS.has(field) && !allowShortDesc) continue;
            }
            if (entity.kind === 'person' && tier === 'absent' && !ABSENT_FIELDS.has(field)) {
                continue;
            }
            const raw = record.value;
            let value = raw && typeof raw === 'object' && !Array.isArray(raw) && typeof raw.entityId === 'string'
                ? { ...raw, name: entities.get(raw.entityId)?.name || raw.entityId } : raw;
            if (field === 'age' && typeof value === 'string' && nowTime) {
                const anchor = record.storyTime || established(entity.fields?.ageTime)?.value || '';
                if (anchor) value = ageDisplay(value, anchor, nowTime);
            }
            const entry = { id: entity.id, name: entity.name, field: FIELD_LABELS[field] || field, value };
            if (record.source?.module === 'simulation') {
                entry['已知情人物'] = (record.source.knownBy || []).map(id=>entities.get(id)?.name).filter(Boolean);
                entry['知情限制'] = '仅列出的人物已知，其他人物须在场观察或收到消息';
            }
            if (entity.kind === 'person' && tier !== 'hero' && hasSceneAnchor && !entry.scope) {
                entry.scope = PERSON_TIER_LABELS[tier];
            }
            const line = JSON.stringify(entry);
            if (heldByHero(field, record) || entity === player.hero && ['condition','status','身体状况','约束','行动限制'].includes(field)) appendLine(line);
            else details.push(line);
        }
    }
    // Reserve whole ownership and constraint fields before general profiles and hooks.
    for (const detail of details) appendLine(detail);
    for (const line of story.other) appendStory(line);
    for (const record of visible) if (openingIds.has(record.id) && record.flavor === 'scenery') appendStory(storyRecordText(record));

    return lines.length ? `${opening}\n${lines.join('\n')}` : '';
}

const isTrackableAiMessage = message => !!message && !message.is_user && typeof message.mes === 'string'
    && !!message.mes.trim() && !(message.is_system && message.extra?.type) && !message.extra?.omitted;

// Dual-axis state placement adapted from BaiBaiBook inject.ts:
// D1 (after latest summarized AI / right before new user turn) when state includes latest AI prose;
// D2 (before unsummarized latest AI turn or during swipe) so stale state never contradicts fresh prose.
export function resolveStateInjectionDepth(chat, memorySnapshot, type) {
    if (type === 'swipe') return 2;
    if (!Array.isArray(chat) || !chat.length) return 1;
    let latestAiIndex = -1;
    for (let i = chat.length - 1; i >= 0; i--) {
        if (isTrackableAiMessage(chat[i])) {
            latestAiIndex = i;
            break;
        }
    }
    if (latestAiIndex < 0) return 1;
    if (!memorySnapshot?.enabled || memorySnapshot.invalidFrom != null) return 1;
    const coveredThrough = memorySnapshot.store?.lastSummarizedMesId ?? -1;
    if (coveredThrough >= 0 && latestAiIndex > coveredThrough) return 2;
    return 1;
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
        const access = entity.fields['通行状态']?.value;
        if (access) {
            location.brief = [location.brief, '通行状态：' + access].filter(Boolean).join(' · ');
            copy.atlas.links = (copy.atlas.links || []).map(link => link.from === location.key || link.to === location.key
                ? {...link,label:[link.label, access].filter(Boolean).join(' · ')} : link);
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
