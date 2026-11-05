import { canonical } from './domain.js';
import { mapRecords, prepareSourceOperations } from './imports.js';
import { projectAuthorityMap } from './authority.js';
import { parseMapDomain } from '../xiaobai-os/domains/map/invariants.js';

// Semantic fields and geometry are one world command. A removed drawing object
// does not delete the world's entity or its history.
export function prepareMapOperations(state, previous, candidate, id) {
    const next = parseMapDomain({ ...candidate, revision: state.version + 1 });
    const records = mapRecords(next);
    const source = { module: 'map', label: '世界地图', records };
    const operations = prepareSourceOperations(state, [source], id).filter(op => op.type !== 'claim');
    const withdrawn = new Set(operations.filter(op => op.type === 'resolve').map(op => op.claimId));
    for (const claim of state.claims.filter(item => item.source.module === 'map' && item.status === 'pending' && !withdrawn.has(item.id))) {
        operations.push({ type: 'resolve', claimId: claim.id, status: 'withdrawn' });
    }
    const bindings = new Map(state.entities.flatMap(entity => entity.bindings.map(binding => [binding, entity.id])));
    for (const op of operations) if (op.type === 'bind') bindings.set(op.binding, op.entityId);
    const before = new Map(mapRecords(previous).map(record => [record.key, record]));
    for (const record of records) {
        const entityId = bindings.get(JSON.stringify(['map', record.key]));
        const old = before.get(record.key);
        const evidence = { module: 'map', key: record.key, label: '地图确认保存' };
        if (old && old.name !== record.name) operations.push({ type: 'rename', entityId, name: record.name });
        const oldFields = new Map((old?.claims || []).map(claim => [claim.field, claim]));
        const fields = new Map(record.claims.map(claim => [claim.field, claim]));
        for (const field of new Set([...oldFields.keys(), ...fields.keys()])) {
            const claim = fields.get(field), prior = oldFields.get(field);
            if (old && canonical(prior ?? null) === canonical(claim ?? null)) continue;
            const value = claim?.target ? { entityId: bindings.get(JSON.stringify(['map', claim.target])) }
                : claim ? claim.value : field === 'description' ? '' : null;
            operations.push({ type: 'set', entityId, field, value, source: evidence });
        }
    }
    // Keep off-map drawing records in storage while authority hides them from
    // this view. Saving unrelated geometry must not turn their old locations
    // back into world facts or forget their drawings.
    const stored = structuredClone(next);
    const visible = new Set((previous?.atlas.actors || []).map(actor => actor.actorKey));
    const existing = state.modules?.map;
    const hidden = (existing?.atlas.actors || []).filter(actor => !visible.has(actor.actorKey)
        && !stored.atlas.actors.some(nextActor => nextActor.actorKey === actor.actorKey)
        && stored.atlas.locations.some(place => place.key === actor.locationKey));
    stored.atlas.actors.push(...structuredClone(hidden));
    const hiddenKeys = new Set(hidden.map(actor => actor.actorKey));
    for (const [key, scene] of Object.entries(stored.scenes)) {
        const additions = (existing?.scenes[key]?.elements || []).filter(element => element.category === 'actor'
            && hiddenKeys.has(element.actorKey) && !scene.elements.some(item => item.category === 'actor' && item.actorKey === element.actorKey)
            && stored.atlas.locations.some(place => place.sceneKey === key
                && hidden.some(actor => actor.actorKey === element.actorKey && actor.locationKey === place.key)));
        scene.elements.push(...structuredClone(additions));
    }
    operations.push({ type: 'module', module: 'map', value: parseMapDomain(stored) });
    return operations;
}

export function readWorldMap(state) {
    const stored = state?.modules?.map;
    if (!stored) return null;
    const map = structuredClone(projectAuthorityMap(stored, state));
    for (const [key, scene] of Object.entries(map.scenes)) {
        const oldPlace = stored.atlas.locations.find(place => place.sceneKey === key);
        if (oldPlace?.name === scene.name) scene.name = map.atlas.locations.find(place => place.key === oldPlace.key)?.name || scene.name;
        scene.elements = scene.elements.filter(element => element.category !== 'actor'
            || map.atlas.actors.some(actor => actor.actorKey === element.actorKey
                && map.atlas.locations.some(place => place.key === actor.locationKey && place.sceneKey === key)));
        for (const element of scene.elements.filter(item => item.category === 'actor')) {
            if (element.label === stored.atlas.actors.find(actor => actor.actorKey === element.actorKey)?.displayName) {
                element.label = map.atlas.actors.find(actor => actor.actorKey === element.actorKey)?.displayName || element.label;
            }
        }
    }
    return parseMapDomain({ ...map, revision: state.version });
}
