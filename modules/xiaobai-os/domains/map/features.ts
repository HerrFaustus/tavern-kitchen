import { featureFields, type MapDomainV1, type MapLocation, type PlaceFeature } from './types.js';

export function placeFeatures(map: MapDomainV1, place: MapLocation): PlaceFeature[] {
    const elements = map.scenes[place.sceneKey ?? '']?.elements ?? [];
    const entries = place.features ?? elements.flatMap(element =>
        element.category !== 'secret' && element.label?.trim() ? [element.label.trim()] : []);
    const byName = new Map<string, PlaceFeature>();
    for (const item of entries) {
        const feature = typeof item === 'string' ? {name: item} : item;
        byName.set(feature.name, {...byName.get(feature.name), ...feature});
    }
    return [...byName.values()];
}

// Updates are scoped to one place. Replaying the same edits produces the same list.
export function reviseFeatures(existing: PlaceFeature[], updates: unknown): PlaceFeature[] | null {
    if (!Array.isArray(updates) || updates.length > 16) { return null; }
    const entries = new Map(existing.map(item => [item.name, item]));
    const removed = new Set<string>();
    for (const update of updates) {
        if (!update || typeof update !== 'object' || Array.isArray(update) || typeof update.name !== 'string'
            || !update.name.trim() || update.name !== update.name.trim()
            || Object.keys(update).some(key => !['name', ...featureFields, 'placement', 'remove'].includes(key))) { return null; }
        if ('remove' in update && typeof update.remove !== 'boolean') { return null; }
        if (update.remove) {
            if ('placement' in update || featureFields.some(field => field in update)) { return null; }
            removed.add(update.name);
            entries.delete(update.name);
            continue;
        }
        const feature: PlaceFeature = {...entries.get(update.name), name: update.name};
        for (const field of featureFields) {
            if (!(field in update)) { continue; }
            if (update[field] === null) { delete feature[field]; }
            else if (typeof update[field] === 'string') { feature[field] = update[field]; }
            else { return null; }
        }
        // The complete candidate, including sibling references, is checked by the domain validator.
        if (update.placement === null) { delete feature.placement; }
        else if ('placement' in update) { feature.placement = update.placement; }
        entries.set(feature.name, feature);
    }
    return [...entries.values()].map(feature => {
        const anchor = feature.placement?.relativeTo;
        if (!anchor || !removed.has(anchor) || entries.has(anchor)) { return feature; }
        const copy = {...feature};
        delete copy.placement;
        return copy;
    });
}
