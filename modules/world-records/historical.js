import { canonical, forkWorld, invariant } from './domain.js';
import { turnById } from './turn-ledger.js';

function evidenceFloor(state, event) {
    const origins = [event.origin, ...(event.origins || [])].filter(Boolean);
    return origins.length ? Math.max(...origins.map(origin => turnById(state, origin.sourceId)?.source.end ?? Infinity)) : null;
}

function applyRecord(list, change, idKey) {
    const id = change.after?.[idKey] ?? change.id;
    const index = list.findIndex(row => row[idKey] === id);
    const current = list[index];
    if (!change.delta && canonical(current ?? null) === canonical(change.before ?? null)) {
        if (change.after === null) {
            if (index >= 0) list.splice(index, 1);
        } else if (index < 0) list.push(structuredClone(change.after));
        else list[index] = structuredClone(change.after);
        return;
    }
    // A late backfill or Schema 4 delta may have changed a different field of the same entity.
    // Reconstruct only its evidenced differences. A collision needs review.
    invariant(change.type === 'entity' && current && change.before && change.after,
        '无法还原该楼当时的对象，请到数据页核对来源');
    const next = { ...current, fields: { ...current.fields } };
    const beforeFields = change.before.fields || {};
    const afterFields = change.after.fields || {};
    for (const key of new Set([...Object.keys(beforeFields), ...Object.keys(afterFields)])) {
        const before = beforeFields[key] ?? null, after = afterFields[key] ?? null;
        if (canonical(before) === canonical(after)) continue;
        invariant(canonical(current.fields[key] ?? null) === canonical(before), '无法还原该楼当时的字段，请核对原世界版本');
        if (after) next.fields[key] = structuredClone(after); else delete next.fields[key];
    }
    for (const key of ['name', 'kind', 'aliases', 'bindings']) {
        if (change.delta && !Object.hasOwn(change.before, key) && !Object.hasOwn(change.after, key)) continue;
        if (canonical(change.before[key]) === canonical(change.after[key])) continue;
        invariant(canonical(current[key]) === canonical(change.before[key]), '无法还原该楼当时的对象身份');
        next[key] = structuredClone(change.after[key]);
    }
    list[index] = next;
}

// Confirmed events remain in commit order, even when a newly enabled feature
// backfills older floors. Skip later narrative facts and manual unfloored edits,
// and replay only the eligible differences onto the closest complete historical prefix.
export function historicalWorld(state, floor) {
    const firstLater = state.events.find(event => {
        const at = evidenceFloor(state, event);
        return at !== null && at > floor;
    });
    if (!firstLater) return state;
    const view = forkWorld(state, firstLater.version - 1, state.branchId);
    for (const event of state.events.slice(firstLater.version)) {
        const at = evidenceFloor(state, event);
        // WHY: Manual edits and claim resolutions have at === null (no narrative floor);
        // skip them alongside future-floor events instead of crashing backfill replay.
        if (at === null || at > floor) continue;
        const changes = event.effects.filter(change => ['entity', 'claim', 'module'].includes(change.type));
        if (!changes.length) continue;
        for (const change of changes) {
            if (change.type === 'entity' || change.type === 'claim') {
                applyRecord(change.type === 'entity' ? view.entities : view.claims,change,'id');
            } else if (canonical(view.modules[change.id] ?? null) === canonical(change.before)) {
                view.modules[change.id] = structuredClone(change.after);
            } else if (change.id === 'story') {
                const story = view.modules.story ??= {version:1,revision:0,records:[],candidates:[]};
                for (const collection of ['records','candidates']) {
                    for (const row of change.after[collection]) {
                        const key = entry => collection === 'records' ? entry.record.id : entry.key;
                        const previous = change.before?.[collection]?.find(entry => key(entry) === key(row));
                        if (previous && canonical(previous) === canonical(row)) continue;
                        const index = story[collection].findIndex(entry => key(entry) === key(row));
                        invariant(canonical(story[collection][index] ?? null) === canonical(previous ?? null),'无法还原该楼当时的剧情记录');
                        if (index < 0) story[collection].push(structuredClone(row)); else story[collection][index]=structuredClone(row);
                    }
                }
            } else throw new Error('无法还原该楼当时的世界模块，请先核对版本');
        }
        view.version = event.version;
    }
    return view;
}
