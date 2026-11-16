import { EVENT_MEMORY_ROLES, normalizeEventStringArray } from '../data/events.js';
import { calcAtomQuality } from '../vector/llm/atom-quality.js';
import { RELATION_TRENDS, factKey } from '../data/fact-predicates.js';
import { normalizeCharacterAliases, collectAliasGraphIssues } from '../data/character-aliases.js';
import { MemoryMaintenanceError, requireMemory } from './errors.js';
import { eventSourceRange } from './records.js';
import { parseStoryUpdates, STORY_FIELDS } from '../../story-state/records.js';
import { authorityIndex, isPrivateStoryField } from '../../world-records/authority.js';
import { FIELD_LABELS } from '../../world-records/domain.js';
import { worldStoryRecords } from '../../world-records/world-story-state.js';

// WHY: events 已从活跃维护视图下线，MEMORY_COLLECTIONS 仅保留 5 个当前集合；
// 历史收据校对与旧单测底层批处理兼容通过 LEGACY_MEMORY_COLLECTIONS 识别旧 events。
export const MEMORY_COLLECTIONS = Object.freeze(['facts', 'characters', 'characterAliases', 'anchors', 'storyRecords']);
export const LEGACY_MEMORY_COLLECTIONS = Object.freeze(['events', ...MEMORY_COLLECTIONS]);
// Maintenance withdraws a fact by deleting it; retraction is a generation protocol.
export const EDITABLE_FIELDS = Object.freeze({
    events: ['title', 'timeLabel', 'summary', 'participants', 'causedBy', 'memoryRole'],
    facts: ['s', 'p', 'o', 'trend', '_isState'],
    characters: ['name'],
    // Historical edits and receipts still require their original field projection.
    keywords: ['text', 'weight'],
    characterAliases: ['from', 'to', 'evidence'],
    anchors: ['semantic', 'edges', 'where'],
    storyRecords: Object.keys(STORY_FIELDS),
});
const fields = EDITABLE_FIELDS;
// Memory is JSON: object key order is not content; array order and field presence are.
export function sameMemory(a, b) {
    if (a === b) return true;
    if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((item, index) => sameMemory(item, b[index]));
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameMemory(a[key], b[key]));
}
const text = value => typeof value === 'string' && !!value.trim();
const texts = value => Array.isArray(value) && value.every(text);

export function memoryItems(memory, collection) {
    requireMemory(LEGACY_MEMORY_COLLECTIONS.includes(collection), 'invalid_operation');
    if (collection === 'anchors') return memory.atoms;
    if (collection === 'characters') return memory.json.characters?.main || [];
    return memory.json[collection] || [];
}

export function setMemoryItems(memory, collection, items) {
    if (collection === 'anchors') memory.atoms = items;
    else if (collection === 'characters') {
        memory.json.characters = { ...memory.json.characters, main: items };
    } else memory.json[collection] = items;
}

export function memoryKey(collection, item) {
    if (collection === 'keywords') return item.text;
    if (collection === 'anchors') return item.atomId;
    if (collection === 'events' || collection === 'facts' || collection === 'storyRecords') return item.id;
    if (collection === 'characterAliases') return item.from;
    return typeof item === 'string' ? item : item.name;
}

// The maintenance working set. Like every other store reader (data/store.js
// getFacts, mergeFacts), maintenance treats a retracted fact as absent.
export function* iterateMemoryRecords(memory, collections = MEMORY_COLLECTIONS) {
    for (const collection of collections) for (const value of memoryItems(memory, collection)) {
        if (collection === 'storyRecords' && value.kind === 'scene') continue;
        if (collection === 'facts' && value?.retracted === true) continue;
        yield { collection, key: memoryKey(collection, value), value };
    }
}

const WORLD_STRUCTURED_FIELD_ALIASES = new Map([
    ['coins', 'coins'], ['金币', 'coins'], ['余额', 'coins'], ['钱包', 'coins'],
    ['owner', 'owner'], ['归属', 'owner'],
    ['location', 'location'], ['所在地', 'location'], ['位置', 'location'],
    ['parent', 'parent'], ['上级地点', 'parent'],
]);
const normalizeWorldName = value => String(value || '').trim().normalize('NFKC').toLocaleLowerCase();
const canonicalWorldFieldKey = predicate => {
    const raw = String(predicate || '').trim();
    const lower = raw.toLocaleLowerCase();
    if (WORLD_STRUCTURED_FIELD_ALIASES.has(raw)) return WORLD_STRUCTURED_FIELD_ALIASES.get(raw);
    if (WORLD_STRUCTURED_FIELD_ALIASES.has(lower)) return WORLD_STRUCTURED_FIELD_ALIASES.get(lower);
    const labelMatch = Object.entries(FIELD_LABELS).find(([, label]) => label === raw || label.toLocaleLowerCase() === lower);
    return labelMatch ? labelMatch[0] : raw;
};
const isStructuredWorldFactField = predicate => {
    const raw = String(predicate || '').trim();
    return WORLD_STRUCTURED_FIELD_ALIASES.has(raw) || WORLD_STRUCTURED_FIELD_ALIASES.has(raw.toLocaleLowerCase());
};
function resolveWorldEntityForFact(fact, world) {
    if (!world || !fact?.s) return null;
    const { memoryNames } = authorityIndex(world);
    const subjectKey = normalizeWorldName(fact.s);
    if (memoryNames.has(subjectKey)) return memoryNames.get(subjectKey);
    const matches = (world.entities || []).filter(entity =>
        [entity.name, ...(entity.aliases || [])].some(name => normalizeWorldName(name) === subjectKey));
    return matches.length === 1 ? matches[0] : null;
}
function formatWorldFieldValue(fieldRecord, world) {
    const raw = fieldRecord?.value;
    if (raw == null) return '';
    if (typeof raw === 'object' && typeof raw.entityId === 'string') {
        const { entities } = authorityIndex(world);
        return entities.get(raw.entityId)?.name || raw.entityId;
    }
    if (typeof raw === 'object') return JSON.stringify(raw);
    return String(raw);
}
export const isWorldOwnedStoryRecordKey = (key, world) => Boolean(world?.modules?.story?.records?.some(entry => entry.record?.id === key));

// WHY: 校对视图必须融合 worldArchive 裁决真值（避免模型读取过期/被覆盖事实或结构化字段），
// 同时隐藏 管理员私有/ 字段，并在写入侧以 readOnly / world_owned 强制守卫职责边界。
export function inspectWorldMemoryRecord(collection, value, world) {
    if (!world || !value) return { hidden: false, readOnly: false, owner: null, value };
    if (collection === 'storyRecords') {
        const worldOwned = isWorldOwnedStoryRecordKey(value.id, world);
        return { hidden: false, readOnly: worldOwned, owner: worldOwned ? 'worldArchive' : null, value };
    }
    if (collection === 'facts') {
        const predicate = String(value.p || '').trim();
        const canon = canonicalWorldFieldKey(predicate);
        const entity = resolveWorldEntityForFact(value, world);
        const fields = entity?.fields || {};
        const privateField = Object.entries(fields).find(([name, rec]) =>
            rec?.nature === 'established_fact' && isPrivateStoryField(name)
            && (name === canon || name === predicate || name === `管理员私有/${canon}` || name === `管理员私有/${predicate}`));
        if (isPrivateStoryField(predicate) || privateField) {
            return { hidden: true, readOnly: true, owner: 'worldArchive', value };
        }
        const settled = fields[canon]?.nature === 'established_fact' ? fields[canon]
            : fields[predicate]?.nature === 'established_fact' ? fields[predicate] : null;
        if (settled || isStructuredWorldFactField(predicate)) {
            return { hidden: false, readOnly: true, owner: 'worldArchive',
                value: settled ? { ...value, o: formatWorldFieldValue(settled, world) } : value };
        }
    }
    return { hidden: false, readOnly: false, owner: null, value };
}

export function isWorldOwnedEditCommand(command, source, world) {
    if (!world) return false;
    if (command.collection === 'storyRecords') return isWorldOwnedStoryRecordKey(command.key, world);
    if (command.collection !== 'facts') return false;
    const existing = memoryItems(source, 'facts').find(item => !item.retracted && memoryKey('facts', item) === command.key) ?? null;
    if (existing && inspectWorldMemoryRecord('facts', existing, world).readOnly) return true;
    if (command.patch) {
        const candidate = { ...(existing || {}), ...command.patch };
        if (inspectWorldMemoryRecord('facts', candidate, world).readOnly) return true;
    }
    return false;
}

export function* iterateUnifiedMemoryRecords(memory, collections = MEMORY_COLLECTIONS, world = null) {
    for (const collection of collections) {
        const rawItems = memoryItems(memory, collection);
        const items = collection === 'storyRecords' && world ? worldStoryRecords(world, rawItems) : rawItems;
        for (const value of items) {
            if (collection === 'storyRecords' && value.kind === 'scene') continue;
            if (collection === 'facts' && value?.retracted === true) continue;
            yield { collection, key: memoryKey(collection, value), value };
        }
    }
}

export function memoryRecords(memory) {
    return Array.from(iterateMemoryRecords(memory), record => ({ ...record, value: structuredClone(record.value) }));
}

/** Update only observed or confirmed records; unrelated baselines stay untouched. */
export function replaceMemoryRecords(memory, records) {
    for (const { collection, key, value } of records) {
        const items = memoryItems(memory, collection);
        const index = items.findIndex(item => memoryKey(collection, item) === key);
        if (value == null) { if (index >= 0) items.splice(index, 1); }
        else if (index >= 0) items[index] = structuredClone(value);
        else items.push(structuredClone(value));
        setMemoryItems(memory, collection, items);
    }
}

export function validateRecord(collection, value, cutoff) {
    requireMemory(value && typeof value === 'object' && !Array.isArray(value), 'invalid_record');
    if (collection === 'storyRecords') {
        let parsed;
        try { [parsed] = parseStoryUpdates([value]); } catch { throw new MemoryMaintenanceError('invalid_record'); }
        requireMemory(Object.keys(value).every(key => key.startsWith('_') || Object.hasOwn(parsed, key)), 'invalid_record');
        requireMemory(value.remove !== true && Number.isInteger(value._addedAt) && value._addedAt <= cutoff, 'invalid_record');
    }
    if (collection === 'events') {
        const ranges = [...String(value.summary || '').matchAll(/\(#(\d+)(?:-(\d+))?\)/gu)];
        requireMemory(text(value.id) && text(value.title) && text(value.summary)
            && texts(value.participants) && texts(value.causedBy) && EVENT_MEMORY_ROLES.includes(value.memoryRole), 'invalid_record');
        requireMemory(ranges.length > 0, 'source_marker_missing', '', 'patch.summary');
        requireMemory(ranges.every(match => Number(match[1]) >= 1
            && Number(match[2] || match[1]) >= Number(match[1]) && Number(match[2] || match[1]) <= cutoff + 1), 'source_boundary', '', 'patch.summary');
    } else if (collection === 'facts') {
        requireMemory(['id', 's', 'p', 'o'].every(field => text(value[field])), 'invalid_record');
        requireMemory(value.since == null || (Number.isInteger(value.since) && value.since >= 0 && value.since <= cutoff), 'source_boundary');
        requireMemory(value.retracted == null || typeof value.retracted === 'boolean', 'invalid_record');
        requireMemory(value.trend == null || RELATION_TRENDS.includes(value.trend), 'invalid_record');
        requireMemory(value._isState == null || typeof value._isState === 'boolean', 'invalid_record');
    } else if (collection === 'anchors') {
        requireMemory(text(value.semantic) && typeof value.where === 'string' && Array.isArray(value.edges)
            && value.edges.length <= 3 && value.edges.every(edge => ['s', 't', 'r'].every(field => text(edge[field]))
                && Object.keys(edge).every(field => ['s', 't', 'r'].includes(field))), 'invalid_record');
        requireMemory(Number.isInteger(value.floor) && value.floor >= 0 && value.floor <= cutoff, 'source_boundary');
    } else if (collection === 'characters') {
        requireMemory(text(value.name), 'invalid_record');
    } else if (collection === 'characterAliases') {
        requireMemory(text(value.from) && text(value.to) && value.from !== value.to
            && typeof value.evidence === 'string' && value.evidence.length <= 120, 'invalid_record');
    }
}

function collectReferenceErrors(events) {
    const errors = [], byId = new Map(events.map((event, index) => [event.id, { event, index }]));
    const reject = (id, expected) => {
        const { event, index } = byId.get(id);
        const error = new MemoryMaintenanceError('invalid_reference', '', `events[${index}].causedBy`);
        error.expected = { key: event.id, ...expected }; errors.push(error);
    };
    const visiting = new Set(), done = new Set();
    for (const start of byId.keys()) {
        if (done.has(start)) continue;
        const stack = [{ id: start, next: 0, entered: false }];
        while (stack.length) {
            const frame = stack.at(-1), causes = byId.get(frame.id).event.causedBy || [];
            if (!frame.entered) {
                frame.entered = true; visiting.add(frame.id);
                if (new Set(causes).size !== causes.length) reject(frame.id, { uniqueItems: true });
            }
            if (frame.next >= causes.length) {
                visiting.delete(frame.id); done.add(frame.id); stack.pop(); continue;
            }
            const cause = causes[frame.next++];
            if (!byId.has(cause)) reject(frame.id, { missing: cause, values: [...byId.keys()] });
            else if (visiting.has(cause)) {
                const path = [...visiting];
                reject(frame.id, { cycle: path.slice(path.indexOf(cause)).concat(cause) });
            } else if (!done.has(cause)) stack.push({ id: cause, next: 0, entered: false });
        }
    }
    return errors;
}

function changesBetween(before, after, collection) {
    const previous = new Map(memoryItems(before, collection).map((value, index) => [memoryKey(collection, value), { value, index }]));
    const next = new Map(memoryItems(after, collection).map(value => [memoryKey(collection, value), value]));
    const changes = [];
    for (const key of new Set([...previous.keys(), ...next.keys()])) {
        const old = previous.get(key), a = old?.value ?? null, b = next.get(key) ?? null;
        if (!sameMemory(a, b)) changes.push({ collection, key, index: old?.index ?? -1,
            before: structuredClone(a), after: structuredClone(b) });
    }
    return changes;
}

/** A command is atomic in memory; receipts own the exact reversible changes. */
function applyMemoryEdit(memory, command, cutoff) {
    const draft = { json: { ...memory.json }, atoms: memory.atoms };
    const { kind, collection, patch } = command;
    let { key, removeIds = [] } = command;
    let completedMarker = null;
    const items = memoryItems(draft, collection).slice();
    if (kind === 'merge') {
        requireMemory(collection === 'events' && Array.isArray(removeIds) && removeIds.length > 0
            && !removeIds.includes(key) && new Set(removeIds).size === removeIds.length, 'invalid_operation');
        const joined = [key, ...removeIds];
        const indexed = new Map(items.map((item, index) => [item.id, { item, index }]));
        requireMemory(joined.every(id => indexed.has(id)), 'record_missing');
        joined.sort((a, b) => (indexed.get(a).item._addedAt ?? 0) - (indexed.get(b).item._addedAt ?? 0)
            || indexed.get(a).index - indexed.get(b).index);
        [key, ...removeIds] = joined;
    }
    const removedKeys = new Set(kind === 'merge' ? removeIds : []);
    const index = items.findIndex(item => memoryKey(collection, item) === key);
    requireMemory(index >= 0 && !(collection === 'facts' && items[index].retracted), 'record_missing');
    requireMemory(['edit', 'delete', 'merge'].includes(kind), 'invalid_operation');
    if (kind === 'delete') {
        items.splice(index, 1);
        setMemoryItems(draft, collection, items);
    } else {
        requireMemory(patch && typeof patch === 'object' && !Array.isArray(patch)
            && Object.keys(patch).every(field => fields[collection].includes(field)), 'invalid_operation');
        const before = items[index];
        let value = { ...(typeof before === 'string' ? { name: before } : before), ...structuredClone(patch) };
        if (collection === 'events') {
            for (const field of ['participants', 'causedBy']) {
                requireMemory(texts(value[field]), 'invalid_record', '', `patch.${field}`);
                value[field] = normalizeEventStringArray(value[field]).value;
            }
        }
        if (collection === 'characterAliases') value = normalizeCharacterAliases([value])[0];
        if (collection === 'anchors' && Object.keys(patch).length) value.quality = calcAtomQuality(value.semantic, value.edges, value.where);
        if (kind === 'merge') {
            requireMemory(text(patch.summary), 'invalid_record');
            requireMemory(collection === 'events' && removeIds.length > 0 && !removeIds.includes(key)
                && new Set(removeIds).size === removeIds.length, 'invalid_operation');
            // Without a causal correction preserve every external cause. An
            // explicit complete list lets the same atomic merge resolve a wrong
            // or excessive union, rather than requiring a separate paid review.
            const causes = Object.hasOwn(patch, 'causedBy') ? value.causedBy
                : [...(value.causedBy || []), ...items.filter(item => removedKeys.has(item.id)).flatMap(item => item.causedBy || [])];
            requireMemory(texts(causes), 'invalid_record');
            value.causedBy = [...new Set(causes)]
                .filter(id => id !== key && !removedKeys.has(id));
            if (!Object.hasOwn(patch, 'participants')) value.participants = [...new Set(items.filter(item => item.id === key || removedKeys.has(item.id)).flatMap(item => item.participants))];
        }
        // A rewritten summary without a source marker keeps the source span of
        // the event(s) it replaces; the marker is bookkeeping, not judgment.
        if (collection === 'events' && text(value.summary) && !eventSourceRange(value)) {
            const ranges = items.filter(item => item.id === key || (kind === 'merge' && removedKeys.has(item.id)))
                .map(eventSourceRange).filter(Boolean);
            if (ranges.length) {
                const from = Math.min(...ranges.map(range => range.from)), to = Math.max(...ranges.map(range => range.to));
                completedMarker = from === to ? `(#${from})` : `(#${from}-${to})`;
                value.summary = `${value.summary.trimEnd()} ${completedMarker}`;
            }
        }
        validateRecord(collection, value, cutoff);
        items[index] = value;
        setMemoryItems(draft, collection, items);
        if (kind === 'merge') {
            draft.json.events = items.filter(item => !removedKeys.has(item.id)).map(event => {
                const causedBy = [...new Set((event.causedBy || []).map(id => removedKeys.has(id) ? key : id))].filter(id => id !== event.id);
                return sameMemory(causedBy, event.causedBy || []) ? event : { ...event, causedBy };
            });
        }
    }
    // Name-based keys address later operations. Keeping them unambiguous is necessary
    // even inside a batch; cross-record links are checked only after the whole list.
    const keys = memoryItems(draft, collection).map(item => memoryKey(collection, item));
    requireMemory(keys.every(text) && new Set(keys).size === keys.length, 'invalid_record', '', 'key');
    return { memory: draft, key, changes: changesBetween(memory, draft, collection), completedMarker };
}

// Facts have a persistent ID for undo, and a business key used by generation.
// Check the final list so correcting ownership and removing a duplicate can be
// one atomic request, in either order.
function collectFactKeyErrors(memory, commands) {
    const byKey = new Map();
    const errors = [];
    for (const fact of memory.json.facts || []) {
        if (fact.retracted) continue;
        const key = factKey(fact), previous = byKey.get(key);
        if (previous) {
            const index = commands.map(command => command.collection === 'facts'
                && [previous.id, fact.id].includes(command.key)).lastIndexOf(true);
            const patch = commands[index]?.patch || {};
            const field = Object.hasOwn(patch, 's') ? 'patch.s' : Object.hasOwn(patch, 'p') ? 'patch.p' : 'patch';
            const error = new MemoryMaintenanceError('fact_conflict', JSON.stringify({ keys: [previous.id, fact.id], s: fact.s, p: fact.p }), field);
            if (index >= 0) error.entry = `edits[${index}]`;
            errors.push(error);
        }
        byKey.set(key, fact);
    }
    return errors;
}

export function editMemoryBatch(memory, commands, cutoff) {
    let draft = memory;
    const results = [];
    const errors = [];
    for (const [index, command] of commands.entries()) {
        try {
            const result = applyMemoryEdit(draft, command, cutoff);
            results.push(result);
            draft = result.memory;
        } catch (error) {
            if (error instanceof MemoryMaintenanceError) {
                error.entry = `edits[${index}]`;
                error.field ||= error.code === 'source_boundary' || error.code === 'source_marker_missing' ? 'patch.summary'
                    : error.code === 'invalid_reference' ? 'patch.causedBy' : error.code === 'record_missing' ? 'key' : 'patch';
            }
            if (!(error instanceof MemoryMaintenanceError)) throw error;
            errors.push(error);
        }
    }
    if (errors.length) throw MemoryMaintenanceError.batch(errors, ['references']);
    errors.push(...collectReferenceErrors(draft.json.events || []));
    for (const issue of collectAliasGraphIssues(draft.json.characterAliases || [])) {
        const error = new MemoryMaintenanceError('invalid_alias', '', `characterAliases[${issue.index}]`);
        error.expected = issue;
        errors.push(error);
    }
    if (commands.some(command => command.collection === 'facts')) errors.push(...collectFactKeyErrors(draft, commands));
    if (errors.length) throw MemoryMaintenanceError.batch(errors);
    return { memory: draft, results };
}

export function editMemory(memory, command, cutoff) {
    return editMemoryBatch(memory, [command], cutoff).results[0];
}

export function activeMaintenanceChanges(operations) {
    return operations.flatMap(operation => operation.changes).filter(change => !change.retired);
}

export function maintenanceImpact(operations) {
    const changes = activeMaintenanceChanges(operations);
    return {
        eventIds: [...new Set(changes.filter(change => change.collection === 'events').map(change => change.key))],
        atomIds: [...new Set(changes.filter(change => change.collection === 'anchors').map(change => change.key))],
        floors: [...new Set(changes.filter(change => change.collection === 'anchors').flatMap(change => [change.before?.floor, change.after?.floor]).filter(Number.isInteger))],
        summary: changes.some(change => change.collection !== 'anchors'),
    };
}

export function restoreMaintenance(memory, receipts, { discardChanged = false } = {}) {
    const draft = structuredClone(memory);
    for (const receipt of [...receipts].reverse()) {
        for (const operation of [...receipt.operations].reverse()) {
            const groups = new Map();
            for (const change of activeMaintenanceChanges([operation])) {
                const items = memoryItems(draft, change.collection);
                const found = items.find(item => memoryKey(change.collection, item) === change.key) ?? null;
                if (!discardChanged) requireMemory(sameMemory(found, change.after), 'conflict');
                if (!groups.has(change.collection)) groups.set(change.collection, []);
                groups.get(change.collection).push(change);
            }
            for (const [collection, changes] of groups) {
                const keys = new Set(changes.map(change => change.key));
                const restored = memoryItems(draft, collection).filter(item => !keys.has(memoryKey(collection, item)));
                for (const change of changes.filter(change => change.before !== null).sort((a, b) => a.index - b.index)) {
                    restored.splice(change.index, 0, structuredClone(change.before));
                }
                setMemoryItems(draft, collection, restored);
            }
        }
    }
    return draft;
}
