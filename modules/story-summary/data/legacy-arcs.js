// Old archives can carry inverse operations as well as the former collection.
// Apply this only to detached/active memory, never to the player's original file.
export function retireArcData(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        const kept = value.filter(item => item?.collection !== 'arcs');
        const clean = kept.map(retireArcData);
        return kept.length === value.length && clean.every((item, index) => item === value[index]) ? value : clean;
    }
    let result = value;
    for (const [key, item] of Object.entries(value)) {
        if (['arcs', 'arcUpdates', 'arcChanges', 'previousArcs', 'generatedArcs', 'legacyCharacterNames'].includes(key)) {
            if (result === value) result = {...value};
            delete result[key];
        } else {
            const clean = retireArcData(item);
            if (clean !== item) {
                if (result === value) result = {...value};
                result[key] = clean;
            }
        }
    }
    return result;
}
