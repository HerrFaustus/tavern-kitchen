// WHY: Pure JSON comparison and collection accessors shared across store, inline replay,
// vector state integration, and legacy archive compatibility after removing maintenance/.

export const LEGACY_MEMORY_COLLECTIONS = Object.freeze([
    'events',
    'facts',
    'characters',
    'characterAliases',
    'anchors',
    'storyRecords',
]);

export function sameMemory(a, b) {
    if (a === b) return true;
    if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((item, index) => sameMemory(item, b[index]));
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameMemory(a[key], b[key]));
}

export function memoryItems(memory, collection) {
    if (!LEGACY_MEMORY_COLLECTIONS.includes(collection)) {
        throw Object.assign(new Error('invalid_operation'), { code: 'invalid_operation' });
    }
    if (collection === 'anchors') return memory.atoms;
    if (collection === 'characters') return memory.json.characters?.main || [];
    return memory.json[collection] || [];
}

export function setMemoryItems(memory, collection, items) {
    if (collection === 'anchors') memory.atoms = items;
    else if (collection === 'characters') {
        memory.json.characters = { ...memory.json.characters, main: items };
    } else {
        memory.json[collection] = items;
    }
}

export function memoryKey(collection, item) {
    if (collection === 'keywords') return item.text;
    if (collection === 'anchors') return item.atomId;
    if (collection === 'events' || collection === 'facts' || collection === 'storyRecords') return item.id;
    if (collection === 'characterAliases') return item.from;
    return typeof item === 'string' ? item : item.name;
}

export function replaceMemoryRecords(memory, records) {
    for (const { collection, key, value } of records) {
        const items = memoryItems(memory, collection);
        const index = items.findIndex(item => memoryKey(collection, item) === key);
        if (value == null) {
            if (index >= 0) items.splice(index, 1);
        } else if (index >= 0) {
            items[index] = structuredClone(value);
        } else {
            items.push(structuredClone(value));
        }
        setMemoryItems(memory, collection, items);
    }
}
