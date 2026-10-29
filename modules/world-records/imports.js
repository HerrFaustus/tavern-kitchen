import { canonical, invariant } from './domain.js';
import { parseRelationTarget } from '../story-summary/data/fact-predicates.js';

const normalized = s => String(s || '').trim().normalize('NFKC').toLocaleLowerCase();
const nameOf = p => typeof p === 'string' ? p : p?.name || '';
export function memoryRecords(store) {
    if (!store?.json || store.summaryInvalid) return [];
    const json = store.json, records = [], names = new Map();
    for (const person of json.characters?.main || []) {
        const name = nameOf(person); if (!name.trim()) continue;
        const aliases = (json.characterAliases || []).filter(a => normalized(a.to) === normalized(name)).map(a => a.from);
        const record = { key: `person:${name}`, kind: 'person', name, aliases, claims: [] };
        records.push(record); for (const alias of [name, ...aliases]) names.set(normalized(alias), record);
    }
    for (const fact of json.facts || []) {
        if (fact.retracted || !fact.s || !fact.p || fact.o === undefined) continue;
        let record = names.get(normalized(fact.s));
        if (!record) { record = { key: `subject:${fact.s}`, kind: 'subject', name: fact.s, aliases: [], claims: [] }; records.push(record); names.set(normalized(fact.s), record); }
        const floor = Number.isSafeInteger(fact.since) ? fact.since : fact._addedAt;
        const target = names.get(normalized(parseRelationTarget(fact.p)));
        const value = fact.p === '金币' && /^\d+$/.test(String(fact.o)) && Number.isSafeInteger(Number(fact.o)) ? Number(fact.o) : fact.o;
        record.claims.push({ field: fact.p, value, ...(target ? { target: target.key, description: String(fact.o) } : {}), nature: 'unclassified', label: `剧情记录${Number.isSafeInteger(floor) ? ` · 第 ${floor + 1} 楼` : ''}${fact.id ? ` · ${fact.id}` : ''}` });
    }
    return records;
}
export function mapRecords(map) {
    if (!map?.atlas) return [];
    const places = (map.atlas.locations || []).map(p => ({ key: `place:${p.key}`, kind: 'place', name: p.name, aliases: [], claims: [
        ...(p.brief ? [{ field: 'description', value: p.brief, nature: 'unclassified', label: '地图地点描述' }] : []),
        ...(p.parent ? [{ field: 'parent', target: `place:${p.parent}`, nature: 'unclassified', label: '地图地点层级' }] : []),
    ] }));
    return [...places, ...(map.atlas.actors || []).map(a => ({ key: `actor:${a.actorKey}`, kind: 'person', name: a.displayName, aliases: [], claims: [{ field: 'location', target: `place:${a.locationKey}`, nature: 'unclassified', label: '地图人物位置' }] }))];
}

// Source projections are proposals. An accepted value is never overwritten by a
// later summary. Exact unique name/alias matches across modules share identity;
// ambiguous names and two distinct keys within one source remain separate.
export function prepareSourceOperations(state, sources, id) {
    const entities = structuredClone(state.entities), operations = [];
    // Memory owns the explicit alias vocabulary; apply it before map actor names.
    for (const source of [...sources].sort((a, b) => Number(b.module === 'memory') - Number(a.module === 'memory'))) {
        invariant(typeof source.module === 'string' && Array.isArray(source.records) && source.records.length <= 10000, '来源档案格式无效');
        const fingerprint = canonical(source.records);
        if (state.sources[source.module]?.fingerprint === fingerprint) continue;
        const resolved = new Map();
        for (const record of source.records) {
            const binding = JSON.stringify([source.module, record.key]);
            let entity = entities.find(e => e.bindings.includes(binding));
            if (!entity) {
                const names = new Set([record.name, ...(record.aliases || [])].map(normalized));
                const matches = entities.filter(e => (e.kind === record.kind || record.kind === 'subject' || e.kind === 'subject') && [e.name, ...e.aliases].some(n => names.has(normalized(n))) && !e.bindings.some(b => JSON.parse(b)[0] === source.module));
                if (matches.length === 1) entity = matches[0];
            }
            if (!entity) {
                entity = { id: id(), kind: record.kind, name: record.name, aliases: record.aliases || [], bindings: [] }; entities.push(entity);
                operations.push({ type: 'create', ...entity, source: { module: source.module, key: record.key, label: `${source.label} · ${record.name}` } });
            }
            if (!entity.bindings.includes(binding)) { entity.bindings.push(binding); operations.push({ type: 'bind', entityId: entity.id, binding }); }
            const aliases = [...new Set([...entity.aliases, ...(record.aliases || [])])];
            if (aliases.length !== entity.aliases.length) { entity.aliases = aliases; operations.push({ type: 'rename', entityId: entity.id, name: entity.name, aliases }); }
            if (entity.kind === 'subject' && record.kind !== 'subject') { entity.kind = record.kind; operations.push({ type: 'rename', entityId: entity.id, name: entity.name, kind: record.kind, aliases: record.aliases || [] }); }
            resolved.set(record.key, entity.id);
        }
        // Withdraw only pending suggestions. Accepted statements retain their
        // original source and are visible in history when the source changes.
        for (const claim of state.claims.filter(c => c.source.module === source.module && c.status === 'pending')) operations.push({ type: 'resolve', claimId: claim.id, status: 'withdrawn' });
        for (const record of source.records) for (const claim of record.claims || []) {
            if (claim.target && !resolved.has(claim.target)) continue;
            operations.push({ type: 'claim', id: id(), entityId: resolved.get(record.key), field: claim.field, value: claim.target ? { entityId: resolved.get(claim.target), ...(claim.description ? { description: claim.description } : {}) } : claim.value,
                nature: claim.nature || 'unclassified', source: { module: source.module, key: record.key, label: claim.label || source.label } });
        }
        operations.push({ type: 'source', module: source.module, snapshot: { fingerprint, label: source.label, records: source.records } });
    }
    return operations;
}
