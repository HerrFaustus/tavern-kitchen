import { nameKey } from './protagonist-identity.js';

const fact = (entity, field) => {
    const record = entity?.fields?.[field];
    return record?.nature === 'established_fact' ? record : undefined;
};

function addName(index, name, id) {
    const key = nameKey(name);
    if (key && index.get(key) !== id) index.set(key, index.has(key) ? null : id);
}

// Map keys and world entity IDs occupy separate namespaces. A registered binding joins them.
export function indexGeography(entities, atlas) {
    const places = new Map(), names = new Map(), bindings = new Map(), mapIds = new Map();
    for (const entity of entities) {
        for (const binding of entity.bindings || []) bindings.set(binding, entity);
        if (entity.kind !== 'place') continue;
        const id = 'entity:' + entity.id;
        places.set(id, {id, name:entity.name});
        for (const name of [entity.name, ...(entity.aliases || [])]) addName(names, name, id);
    }
    const bound = key => bindings.get(JSON.stringify(['map', key]));
    for (const place of atlas.locations || []) {
        const entity = bound('place:' + place.key);
        const id = entity ? 'entity:' + entity.id : 'map:' + place.key;
        mapIds.set(place.key, id);
        places.set(id, {id, name:entity?.name || place.name, scale:place.scale});
        addName(names, place.name, id);
    }
    for (const place of atlas.locations || []) places.get(mapIds.get(place.key)).parent = mapIds.get(place.parent);
    for (const entity of entities) {
        const parent = fact(entity, 'parent');
        if (entity.kind === 'place' && parent) places.get('entity:' + entity.id).parent = parent.value ? 'entity:' + parent.value.entityId : undefined;
    }
    const resolve = name => {
        const key = nameKey(name);
        if (!key) return undefined;
        if (names.has(key)) return names.get(key);
        const id = 'name:' + key;
        if (!places.has(id)) places.set(id, {id, name:name.trim()});
        return id;
    };
    const ancestry = id => {
        const path = [], seen = new Set();
        while (places.has(id) && !seen.has(id)) {
            seen.add(id);
            const place = places.get(id);
            path.push(place);
            id = place.parent;
        }
        return path;
    };
    const parents = new Set([...places.values()].map(place => place.parent).filter(Boolean));
    return {parents, mapIds, bound, resolve, ancestry};
}

export function applyRegionalProximity(rows, world, identity, situations) {
    const entities = world.entities || [], atlas = world.modules?.map?.atlas || {};
    const geo = indexGeography(entities, atlas);
    const personNames = new Map();
    for (const entity of entities.filter(item => item.kind === 'person' || item.kind === 'subject')) {
        for (const name of [entity.name,...(entity.aliases || [])]) addName(personNames, name, entity.id);
    }
    const peopleAt = new Map();
    const playerKey = identity.hero ? 'person/' + identity.hero.id : '';
    const keyFor = name => {
        const key = nameKey(name);
        if (!key || personNames.get(key) === null) return null;
        if (personNames.has(key)) return 'person/' + personNames.get(key);
        return identity.names.has(key) ? playerKey : 'person-name/' + name;
    };
    let playerPlace;
    function locate(key, name, place) {
        if (!key || key === playerKey) return;
        if (!rows.has(key)) rows.set(key, {key, kind:'person', title:name, near:false, reason:''});
        peopleAt.set(key, place);
    }
    for (const actor of atlas.actors || []) {
        const place = geo.mapIds.get(actor.locationKey);
        const entity = geo.bound('actor:' + actor.actorKey);
        if (actor.actorKey === 'player') {
            if (!identity.hero || !entity || entity === identity.hero) playerPlace = place;
        } else {
            locate(entity ? 'person/' + entity.id : keyFor(actor.displayName), entity?.name || actor.displayName, place);
        }
    }
    for (const entity of entities) {
        const location = fact(entity, 'location');
        if (!location) continue;
        const place = location.value ? 'entity:' + location.value.entityId : undefined;
        if (entity === identity.hero) playerPlace = place;
        else if (entity.kind === 'person') peopleAt.set('person/' + entity.id, place);
    }
    const path = geo.ancestry(playerPlace);
    const localParent = path[1] && !path[1].scale && !geo.parents.has(playerPlace) ? path[1] : undefined;
    const boundary = path.find(place => place.scale === 'region') || path.find(place => ['district','city'].includes(place.scale))
        || localParent || path[0];
    if (!boundary || boundary.scale === 'world') return;
    const regional = id => geo.ancestry(id).some(place => place.id === boundary.id);
    function mark(key) {
        const row = rows.get(key);
        if (!row) return;
        row.regional = true;
        row.near = true;
        row.reason = [row.reason, '与主角同在' + boundary.name].filter(Boolean).join('；');
    }
    for (const [key, place] of peopleAt) if (regional(place)) mark(key);
    for (const record of situations) {
        if (record.status !== 'open') continue;
        const scopes = (record.scope || '').split(/[、，,；;\n]/u);
        const hasStableId = record.placeId?.startsWith('entity:') || record.placeId?.startsWith('map:');
        if (hasStableId ? regional(record.placeId) : [record.scope,...scopes].some(scope => regional(geo.resolve(scope)))) mark('situation/' + record.id);
    }
}
