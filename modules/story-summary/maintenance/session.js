import { stripFloorProtocol } from '../inline/protocol.js';
import { applyTextFilterRules } from '../data/text-filter-rules.js';
import { readPlotLines } from '../../story-state/plot-lines.js';
import { prepareMemoryTags } from '../data/memory-tags.js';
import { reviewedRounds, roundSourceId } from '../data/summary-layers.js';
import { isRangeSourceCurrent } from '../data/turn-source.js';
import { readNarrativeUnits, requestNarrativeClosure, validateStagedUnits } from './narrative-review.js';
import { editMemoryBatch, inspectWorldMemoryRecord, isWorldOwnedEditCommand, iterateMemoryRecords,
    iterateUnifiedMemoryRecords, memoryItems, memoryKey, sameMemory, MEMORY_COLLECTIONS } from './domain.js';
import { createEvidenceReader } from './evidence.js';
import { MemoryMaintenanceError, requireMemory, memoryUpdated } from './errors.js';
import { projectMemoryRecord, memoryPolicy, recordHandle } from './records.js';
import { maintenanceTask, memoryOwnership, subtractRanges, unionRanges, overlaps } from './ranges.js';
import { buildMemoryOpening } from './opening.js';
import { MEMORY_TOOLS } from './tools.js';
import { normalizeToolArguments, validateToolArguments } from './arguments.js';
import { MEMORY_PAGE_CHARS, MEMORY_PAGE_SIZE, OPENING_TOKENS } from './limits.js';
import { projectMaintenanceResult } from './result.js';

export { projectMemoryRecord } from './records.js';
export { MEMORY_PAGE_CHARS, MEMORY_PAGE_SIZE, OPENING_TOKENS } from './limits.js';

const generation = ({ maintenance: _receipts, reviewLayers: _layers, roundRevisions: _revisions, ...batch }) => batch;
const find = (memory, { collection, key }, activeWorld = null) => {
    for (const record of iterateUnifiedMemoryRecords(memory, [collection], activeWorld)) {
        if (record.key === key) return record.value;
    }
    return null;
};
const targets = commands => commands.flatMap(command => [command, ...(command.removeIds || []).map(key => ({ collection: 'events', key }))]);
function recordLookup(memory, activeWorld = null) {
    const indexes = new Map();
    const world = activeWorld ?? memory.world ?? null;
    return ({ collection, key }) => {
        if (!indexes.has(collection)) {
            const values = new Map();
            for (const record of iterateUnifiedMemoryRecords(memory, [collection], world)) values.set(record.key, record.value);
            indexes.set(collection, values);
        }
        return indexes.get(collection).get(key) ?? null;
    };
}

/** One task borrows published records; only observed values and changed records are detached. */
export function createMemorySession({ chatId, chat, json, atoms, l0Index, cutoff, start = 0, store,
    generateReviewedLayer, filterRules = [], openingTokens = OPENING_TOKENS, world = null }) {
    let source = { json: json || {}, atoms }, history = store?.summaryHistory || [], worldState = world ?? null;
    const originalBatches = history.map(generation);
    const policy = memoryPolicy(filterRules), evidence = createEvidenceReader(() => chat, cutoff, filterRules);
    const observed = new Map(), overlay = new Map(), conflicts = new Map(), completionBaseline = new Map();
    const confirmedOperations = [], acknowledged = new Set();
    let confirmedLayers = 0, pending = null, ownershipHistory, ownership;
    const ownerFor = batches => {
        if (batches !== ownershipHistory) { ownershipHistory = batches; ownership = memoryOwnership(batches, cutoff); }
        return ownership;
    };
    const ensurePending = () => pending ||= { commands: [], operations: [], completions: [], note: '' };
    const task = ({ includeStaged = false } = {}) => {
        const published = maintenanceTask(history, cutoff);
        if (!includeStaged || !pending?.completions.length) return published;
        const remaining = subtractRanges(published.pending, pending.completions);
        return { ...published, pending: remaining, completed: unionRanges([...published.completed, ...pending.completions]),
            stagedCompletions: pending.completions };
    };
    function completionRecords(memory, batches, ranges) {
        const selected = new Map(), owner = ownerFor(batches);
        for (const record of iterateMemoryRecords(memory)) {
            if (record.collection === 'anchors' && record.value.floor > cutoff) continue;
            const range = owner(record).range;
            if (ranges.some(requested => overlaps(range, requested))) selected.set(recordHandle(record), { ...record, range });
        }
        return selected;
    }
    function assertCompletions(memory, batches) {
        if (!pending?.completions.length) return;
        const current = completionRecords(memory, batches, pending.completions), changed = [];
        for (const handle of new Set([...completionBaseline.keys(), ...current.keys()])) {
            const before = completionBaseline.get(handle), after = current.get(handle);
            if (!sameMemory(before?.value, after?.value)) {
                const { collection, key } = after || before;
                changed.push({ collection, key }); conflicts.set(handle, { collection, key, refreshed: false });
            }
        }
        if (changed.length) throw memoryUpdated(changed, { completion: true });
    }
    const remember = record => {
        const handle = recordHandle(record);
        if (!overlay.has(handle)) observed.set(handle, { collection: record.collection, key: record.key, value: structuredClone(record.value) });
    };

    function ownsHistory(current) {
        const batches = current.store?.summaryHistory || [];
        return current.cutoff >= cutoff && (originalBatches.length
            ? originalBatches.every((batch, index) => batches[index] && sameMemory(batch, generation(batches[index])))
            : current.cutoff === cutoff);
    }
    function assertBoundary(current) { requireMemory(current.chatId === chatId && ownsHistory(current), 'conflict'); }
    function refresh(current) {
        if (!current) return;
        assertBoundary(current);
        source = { json: current.json || {}, atoms: current.atoms };
        history = current.store?.summaryHistory || history;
        chat = current.chat; l0Index = current.l0Index;
        if (Object.hasOwn(current, 'world')) worldState = current.world ?? null;
    }
    function assertRunOwnership(memory, keys, batches = history) {
        const owner = ownerFor(batches), lookup = recordLookup(memory, memory.world ?? worldState);
        const later = keys.filter(key => {
            const value = lookup(key);
            return value && owner({ ...key, value }).range.to > cutoff + 1;
        });
        if (later.length) throw memoryUpdated(later);
    }
    function assertKnown(memory, keys, completion = false) {
        const lookup = recordLookup(memory, memory.world ?? worldState);
        const changed = keys.filter(key => {
            const seen = observed.get(recordHandle(key));
            return seen && !sameMemory(lookup(key), seen.value);
        });
        if (changed.length) {
            for (const key of changed) conflicts.set(recordHandle(key), { collection: key.collection, key: key.key, refreshed: false });
            throw memoryUpdated(changed, { completion });
        }
    }
    function* records(collections = MEMORY_COLLECTIONS, memory = source, withDraft = true) {
        const activeWorld = memory === source ? worldState : (memory.world ?? null);
        const found = new Set();
        for (const record of iterateUnifiedMemoryRecords(memory, collections, activeWorld)) {
            const handle = recordHandle(record);
            if (overlay.has(handle)) found.add(handle);
            const change = withDraft ? overlay.get(handle) : null;
            const value = change && !conflicts.has(handle) ? change.after : record.value;
            if (value == null || (record.collection === 'anchors' && value.floor > cutoff)) continue;
            const worldInfo = activeWorld ? inspectWorldMemoryRecord(record.collection, value, activeWorld) : null;
            if (worldInfo?.hidden) continue;
            yield { ...record, value, ...(worldInfo ? { worldValue: worldInfo.value, worldInfo } : {}) };
        }
        if (withDraft) for (const [handle, change] of overlay) {
            if (!found.has(handle) && change.after != null && collections.includes(change.collection)) {
                yield { collection: change.collection, key: change.key, value: change.after };
            }
        }
    }
    function workingMemory() {
        if (!overlay.size) return source;
        const memory = { json: { ...source.json }, atoms: source.atoms };
        for (const collection of new Set([...overlay.values()].map(change => change.collection))) {
            const changes = new Map([...overlay].filter(([, change]) => change.collection === collection));
            const values = [];
            for (const value of memoryItems(source, collection)) {
                const handle = `${collection}:${memoryKey(collection, value)}`, change = changes.get(handle);
                if (!change) values.push(value);
                else { if (change.after !== null) values.push(change.after); changes.delete(handle); }
            }
            for (const change of changes.values()) if (change.after !== null) values.push(change.after);
            if (collection === 'anchors') memory.atoms = values;
            else if (collection === 'characters') memory.json.characters = { ...memory.json.characters, main: values };
            else memory.json[collection] = values;
        }
        return memory;
    }
    function appendDraft(commands, results) {
        const draft = ensurePending();
        for (const [index, edit] of results.entries()) {
            if (!edit.changes.length) continue;
            const command = commands[index];
            draft.commands.push(command);
            draft.operations.push({ kind: command.kind, collection: command.collection, key: edit.key, changes: edit.changes });
            for (const change of edit.changes) {
                const handle = recordHandle(change), previous = overlay.get(handle);
                if (!observed.has(handle)) observed.set(handle, { collection: change.collection, key: change.key, value: change.before });
                overlay.set(handle, { ...change, before: previous ? previous.before : change.before, index: previous ? previous.index : change.index });
            }
        }
    }
    function installDraft(commands, results) {
        const draft = ensurePending();
        draft.commands = []; draft.operations = []; overlay.clear();
        appendDraft(commands, results);
    }

    /** Keep at most one page of references; project only records that can be returned. */
    function readMemory({ collection, key, query = '', ranges, cursor, limit = MEMORY_PAGE_SIZE, textOffset = 0 } = {}, current) {
        refresh(current);
        ranges?.forEach((range, index) => {
            requireMemory(range.to >= range.from, 'invalid_arguments', '', `ranges[${index}].to`);
            requireMemory(range.from >= 1 && range.to <= cutoff + 1, 'source_boundary', '', `ranges[${index}].to`);
        });
        const selected = [], owner = ownerFor(history), needle = query.toLocaleLowerCase();
        let total = 0, eligible = 0;
        for (let record of records(collection ? [collection] : MEMORY_COLLECTIONS)) {
            if (key && record.key !== key) continue;
            const responsibility = owner(record);
            if (ranges && !ranges.some(range => overlaps(responsibility.range, range))) continue;
            // Explicit rereads of a conflicted target show the current published value.
            const handle = recordHandle(record), conflict = conflicts.get(handle);
            if (conflict) {
                const value = find(source, record, worldState);
                if (value == null) continue;
                const worldInfo = worldState ? inspectWorldMemoryRecord(record.collection, value, worldState) : null;
                if (worldInfo?.hidden) continue;
                record = { ...record, value, ...(worldInfo ? { worldValue: worldInfo.value, worldInfo } : {}) };
            }
            if (needle && !JSON.stringify(projectMemoryRecord(
                record.worldValue ? { ...record, value: record.worldValue } : record,
                history,
                responsibility,
                record.worldInfo,
            ).value).toLocaleLowerCase().includes(needle)) continue;
            total++;
            if (cursor && (textOffset ? handle < cursor : handle <= cursor)) continue;
            eligible++;
            let at = selected.findIndex(item => recordHandle(item.record) > handle);
            if (at < 0) at = selected.length;
            if (at <= limit) selected.splice(at, 0, { record, responsibility });
            if (selected.length > limit + 1) selected.pop();
        }
        if (key && !total) {
            const handle = `${collection}:${key}`;
            observed.set(handle, { collection, key, value: null });
            if (conflicts.has(handle)) conflicts.get(handle).refreshed = true;
            throw new MemoryMaintenanceError('record_missing', '', 'key');
        }
        if (cursor && textOffset) requireMemory(selected.length && recordHandle(selected[0].record) === cursor, 'record_missing', '', 'cursor');
        const items = [];
        let budget = MEMORY_PAGE_CHARS, next = null;
        for (const { record, responsibility } of selected.slice(0, limit)) {
            const handle = recordHandle(record), begin = items.length ? 0 : textOffset;
            if (begin) assertKnown(source, [record]);
            const projected = projectMemoryRecord(record.worldValue ? { ...record, value: record.worldValue } : record, history, responsibility, record.worldInfo), text = JSON.stringify(projected);
            requireMemory(begin <= text.length, 'invalid_arguments', '', 'textOffset');
            if (items.length && text.length > budget) { next = { cursor: recordHandle(items.at(-1)) }; break; }
            if (conflicts.has(handle)) {
                observed.set(handle, { collection: record.collection, key: record.key, value: structuredClone(record.value) });
                conflicts.get(handle).refreshed = true;
            } else remember(record);
            if (begin || text.length > budget) {
                const end = Math.min(text.length, begin + Math.max(1, budget - 300));
                items.push({ collection: record.collection, key: record.key, excerpt: text.slice(begin, end), nextTextOffset: end < text.length ? end : null });
                next = end < text.length ? { cursor: handle, textOffset: end } : eligible > items.length ? { cursor: handle } : null;
                break;
            }
            items.push(projected); budget -= text.length;
        }
        if (!next && eligible > items.length && items.length && !items.at(-1).nextTextOffset) next = { cursor: recordHandle(items.at(-1)) };
        if (next) next = { ...(collection ? { collection } : {}), ...(key ? { key } : {}), ...(query ? { query } : {}),
            ...(ranges ? { ranges } : {}), limit, ...next };
        return { items, total, next };
    }
    function initial(tokenBudget = openingTokens) {
        return buildMemoryOpening({ task: task(), read: readMemory,
            maxTokens: Math.min(tokenBudget, openingTokens, OPENING_TOKENS) });
    }
    function complete({ from, to }) {
        requireMemory(from >= 1 && to >= from && to <= cutoff + 1, 'source_boundary', '', 'to');
        for (const [handle, conflict] of conflicts) if (conflict.refreshed && !overlay.has(handle)) conflicts.delete(handle);
        if (conflicts.size) throw memoryUpdated([...conflicts.values()], { completion: true });
        const range = { from, to }, published = task();
        if (!subtractRanges([range], published.completed).length && !pending?.completions.some(staged => overlaps(staged, range))) {
            return { status: 'unchanged', task: task({ includeStaged: true }) };
        }
        for (const [handle, record] of completionBaseline) if (overlaps(record.range, range)) completionBaseline.delete(handle);
        for (const [handle, record] of completionRecords(source, history, [range])) completionBaseline.set(handle, record);
        const completed = [...published.completed, ...(pending?.completions || [])];
        if (!subtractRanges([{ from, to }], completed).length) return { status: 'unchanged', task: task({ includeStaged: true }) };
        ensurePending().completions = unionRanges([...(pending?.completions || []), { from, to }]);
        return { status: 'staged', changed: 0, task: task({ includeStaged: true }) };
    }
    function validateEditEvidence(evidenceArgs) {
        requireMemory(evidenceArgs && typeof evidenceArgs === 'object'
            && Number.isInteger(evidenceArgs.floor) && typeof evidenceArgs.quote === 'string', 'invalid_evidence', '', 'evidence');
        requireMemory(evidenceArgs.floor >= 1 && evidenceArgs.floor <= cutoff + 1, 'source_boundary', '', 'evidence.floor');
        const message = chat?.[evidenceArgs.floor - 1];
        requireMemory(message && !(message.is_system && message.extra?.type), 'source_missing', '', 'evidence.floor');
        const quote = evidenceArgs.quote;
        const story = applyTextFilterRules(stripFloorProtocol(String(message.mes || '')), filterRules);
        requireMemory(quote.trim().length > 0 && quote.length <= 1000 && story.includes(quote), 'invalid_evidence', '', 'evidence.quote');
    }
    function submit(args) {
        try {
            validateToolArguments(args, MEMORY_TOOLS.find(tool => tool.function.name === 'EditMemory').function.parameters);
            const errors = [];
            const commands = args.edits.flatMap((operation, index) => {
                try {
                    const { kind, collection, key, removeIds } = operation;
                    if (kind === 'delete') {
                        requireMemory(operation.patch === undefined && removeIds === undefined, 'invalid_operation');
                    } else requireMemory(operation.patch, 'invalid_arguments', '', 'patch');
                    if (kind !== 'merge') requireMemory(removeIds === undefined, 'invalid_arguments', '', 'removeIds');
                    const patch = structuredClone(operation.patch || {});
                    if (collection === 'facts' && Object.hasOwn(patch, 'isState')) { patch._isState = patch.isState; delete patch.isState; }
                    return [{ kind, collection, key, ...(removeIds ? { removeIds } : {}), ...(operation.patch ? { patch } : {}) }];
                } catch (error) {
                    if (!(error instanceof MemoryMaintenanceError)) throw error;
                    error.entry = `edits[${index}]`; error.field ||= 'patch'; errors.push(error);
                    return [];
                }
            });
            if (errors.length) throw MemoryMaintenanceError.batch(errors, ['records', 'references']);
            if (commands.length > 0 || args.evidence !== undefined) validateEditEvidence(args.evidence);
            if (worldState) {
                const worldErrors = [];
                for (const [index, command] of commands.entries()) {
                    if (!isWorldOwnedEditCommand(command, source, worldState)) continue;
                    const err = new MemoryMaintenanceError('world_owned', '', 'key');
                    err.entry = `edits[${index}]`;
                    worldErrors.push(err);
                }
                if (worldErrors.length) throw MemoryMaintenanceError.batch(worldErrors, ['records', 'references']);
            }
            const keys = targets(commands), repairing = new Set(keys.map(recordHandle).filter(handle => conflicts.get(handle)?.refreshed));
            const removed = new Set(), affected = new Set(repairing);
            // A renamed/deleted record may have later edits under its new key. Drop that
            // dependent command chain, not unrelated edits from the same tool request.
            let expanded;
            do {
                expanded = false;
                for (const [index, operation] of (pending?.operations || []).entries()) {
                    if (removed.has(index) || !operation.changes.some(change => affected.has(recordHandle(change)))) continue;
                    removed.add(index); expanded = true;
                    for (const change of operation.changes) affected.add(recordHandle(change));
                }
            } while (expanded);
            const unresolved = [...conflicts].filter(([handle]) => !affected.has(handle)).map(([, record]) => record);
            if (unresolved.length) throw memoryUpdated(unresolved);
            assertKnown(source, keys.filter(record => !repairing.has(recordHandle(record))));
            assertRunOwnership(source, keys);
            const retained = (pending?.commands || []).filter((_command, index) => !removed.has(index));
            const applicable = commands.filter(command => !(command.kind === 'delete' && repairing.has(recordHandle(command)) && find(source, command, worldState) == null));
            const incremental = !repairing.size;
            if (incremental) assertKnown(source, [...overlay.values()]);
            const all = incremental ? applicable : [...retained, ...applicable];
            const result = editMemoryBatch(incremental ? workingMemory() : source, all, cutoff);
            assertRunOwnership(source, result.results.flatMap(edit => edit.changes));
            // Original values are checked before installing any part of this atomic request.
            const changedKeys = result.results.flatMap(edit => edit.changes).filter(record => !affected.has(recordHandle(record)));
            assertKnown(source, changedKeys);
            if (incremental) appendDraft(all, result.results);
            else installDraft(all, result.results);
            for (const handle of repairing) if (completionBaseline.has(handle)) {
                const original = completionBaseline.get(handle), value = find(source, original, worldState);
                if (value == null) completionBaseline.delete(handle);
                else completionBaseline.set(handle, { ...original, value });
            }
            for (const handle of affected) conflicts.delete(handle);
            if (args.note) pending.note = args.note;
            const changed = result.results.slice(incremental ? 0 : retained.length).filter(edit => edit.changes.length).length;
            return { status: changed ? 'staged' : 'unchanged', changed };
        } catch (error) {
            if (!(error instanceof MemoryMaintenanceError)) throw error;
            if (error.code === 'memory_updated') return { status: 'error', code: error.code, message: error.message, records: error.records };
            return { status: 'needs_fix', rejected: error.rejected || [{ entry: error.entry || error.field?.match(/^edits\[\d+\]/u)?.[0] || 'arguments',
                field: error.field || 'arguments', code: error.code, message: error.message,
                ...(error.expected ? { expected: error.expected } : {}) }], unchecked: error.unchecked || [] };
        }
    }
    function runTool(name, args = {}, current) {
        const tool = MEMORY_TOOLS.find(item => item.function.name === name);
        if (!tool) throw new MemoryMaintenanceError('unknown_tool', name, 'name');
        refresh(current);
        args = normalizeToolArguments(args, tool.function.parameters);
        if (name === 'EditMemory') return submit(args);
        validateToolArguments(args, tool.function.parameters);
        if (name === 'CompleteMaintenance') return complete(args);
        if (name === 'ReadMemory') return readMemory(args);
        if (name === 'SearchSource') return evidence.search(args);
        if (name === 'ReadSource') return evidence.read(args);
    }
    function assertCurrent(current) {
        assertBoundary(current);
        if (pending?.revisions?.length || pending?.layers?.length) validateStagedUnits(reviewState(current), pending.layers);
        const memory = { json: current.json || {}, atoms: current.atoms, world: Object.hasOwn(current, 'world') ? current.world : worldState }, batches = current.store?.summaryHistory || history;
        const keys = [...overlay.values()];
        if (pending?.completions.length) {
            const owner = ownerFor(batches);
            for (const seen of observed.values()) if (seen.value && pending.completions.some(range => overlaps(range, owner(seen).range))) keys.push(seen);
        }
        assertKnown(memory, keys, !!pending?.completions.length);
        if (conflicts.size) throw memoryUpdated([...conflicts.values()]);
        assertCompletions(memory, batches);
        assertRunOwnership(memory, targets(pending?.commands || []), batches);
        if (!pending?.commands.length) return memory;
        const result = editMemoryBatch(memory, pending.commands, cutoff);
        assertRunOwnership(memory, result.results.flatMap(edit => edit.changes), batches);
        assertKnown(memory, result.results.flatMap(edit => edit.changes));
        if (pending?.commands.length) installDraft(pending.commands, result.results);
        return result.memory;
    }
    function coverage() {
        const indexed = new Set(source.atoms.filter(atom => atom.floor <= cutoff).map(atom => atom.floor));
        const missingAnchors = [];
        for (let floor = start; floor <= Math.min(cutoff, chat.length - 1); floor++) {
            if (chat[floor]?.is_user || indexed.has(floor) || ['ok', 'empty'].includes(l0Index?.byFloor?.[String(floor)]?.status)) continue;
            missingAnchors.push({ floor: floor + 1, status: l0Index?.byFloor?.[String(floor)]?.status || 'missing' });
        }
        return { supplied: evidence.ranges(), missingAnchors };
    }
    const canReviewUnits = !!generateReviewedLayer && reviewedRounds(history).some(batch => roundSourceId(batch) && batch.summary);
    function reviewState(current) {
        const revisions = pending?.revisions || [];
        const history = reviewedRounds(current.store.summaryHistory);
        const latest = new Map(history.map(batch => [batch.endMesId, batch]));
        for (const change of revisions) {
            const batch = latest.get(change.end);
            requireMemory(batch && roundSourceId(batch) === change.sourceId && (batch.roundVersion || 0) === change.baseVersion && batch.summary === change.previous
                && isRangeSourceCurrent(batch.sourceReceipt?.source || batch.roundSource, current.chat), 'conflict');
            latest.set(change.end, {
                ...batch,
                summary: change.text,
                roundVersion: change.baseVersion + 1,
                ...(change.memoryTags && { memoryTags: change.memoryTags }),
                ...(change.plotLines && { plotLines: change.plotLines }),
            });
        }
        // The copy already contains effective text. Avoid applying its overlays a second time.
        return { ...current, store: { ...current.store, summaryHistory: [...latest.values()].map(({ roundRevisions, legacyRoundBase, legacyRoundChanges, ...batch }) => batch) } };
    }
    async function reviewUnit(name, args, current, reread, signal) {
        assertBoundary(current);
        const staged = pending?.layers || [];
        const view = reviewState(current);
        if (name === 'ReadNarrativeUnits') return readNarrativeUnits(view, staged, cutoff, args);
        if (name === 'ReviseRoundSummary') {
            const batch = view.store.summaryHistory.find(item => item.endMesId === args.to - 1);
            const source = batch?.sourceReceipt?.source || batch?.roundSource;
            requireMemory(source && batch.summary && !batch.floorEntry?.omitted && batch.endMesId <= cutoff
                && isRangeSourceCurrent(source, current.chat) && (batch.roundVersion || 0) === args.version && batch.summary === args.previous, 'conflict');
            const floor = args.evidence.floor - 1, quote = args.evidence.quote;
            requireMemory(floor >= source.start && floor <= source.end && quote.trim() && quote.length <= 1000
                && !(current.chat[floor]?.is_system && current.chat[floor]?.extra?.type) && stripFloorProtocol(current.chat[floor]?.mes).includes(quote)
                && args.text.trim() && args.text.length <= 12000, 'invalid_arguments');
            const nextText = args.text.trim();
            const memoryTags = args.memoryTags && prepareMemoryTags({ memoryTags: args.memoryTags });
            let validatedPlotLines;
            if (args.plotLines !== undefined) {
                validatedPlotLines = readPlotLines(args.plotLines, nextText);
                requireMemory(validatedPlotLines.length === args.plotLines.length, 'invalid_arguments', '修订后的剧情线引文须逐字出自新版总结', 'plotLines');
            }
            if (nextText === batch.summary
                && (!memoryTags || sameMemory(memoryTags, batch.memoryTags))
                && (!validatedPlotLines || sameMemory(validatedPlotLines, batch.plotLines || []))) {
                return { status: 'unchanged' };
            }
            const validBefore = readPlotLines(batch.plotLines, batch.summary);
            const validAfter = readPlotLines(validatedPlotLines ?? batch.plotLines, nextText);
            const invalidatedPlotLines = validBefore
                .filter(before => !validAfter.some(after => after.title === before.title && after.quote === before.quote))
                .map(({ title, quote: oldQuote }) => ({ title, quote: oldQuote }));
            const draft = ensurePending();
            (draft.revisions ??= []).push({
                version: 1,
                end: batch.endMesId,
                sourceId: roundSourceId(batch),
                ...(memoryTags && { memoryTags }),
                ...(validatedPlotLines && { plotLines: validatedPlotLines }),
                baseVersion: args.version,
                previous: batch.summary,
                text: nextText,
                evidence: { ...args.evidence },
            });
            return {
                status: 'staged',
                ...(invalidatedPlotLines.length && {
                    invalidatedPlotLines,
                    warning: `已修订本轮总结；以下剧情线原有引文不再逐字匹配新版摘要，已自动失效：${invalidatedPlotLines.map(item => item.title).join('、')}`,
                }),
                ...(validAfter.length && { retainedPlotLines: validAfter.map(item => item.title) }),
            };
        }
        const result = await requestNarrativeClosure(args, view, staged, cutoff, generateReviewedLayer, async () => reviewState(await reread()), signal);
        if (result.node) {
            const draft = ensurePending();
            (draft.layers ??= []).push(result.node);
        }
        return { status: result.status, level: args.level, from: args.from, to: args.to, summary: result.node?.text };
    }
    return { chatId, cutoff, start, evidence, policy, canReviewUnits, reviewUnit,
        get operations() { return confirmedOperations; }, get pending() { return pending; },
        get hasPending() { return !!pending && !!(pending.operations.length || pending.completions.length || pending.layers?.length || pending.revisions?.length || pending.outcome); },
        get stagedCount() { return (pending?.operations.length || 0) + (pending?.layers?.length || 0) + (pending?.revisions?.length || 0); }, get savedCount() { return confirmedOperations.length + confirmedLayers; },
        get stagedCompletions() { return pending?.completions || []; },
        coverage, runTool, initial, task, ownsHistory, assertCurrent,
        inputProvided() { evidence.inputProvided(); },
        discard() { pending = null; overlay.clear(); conflicts.clear(); completionBaseline.clear(); },
        acknowledge(saved) {
            const { current, receipt } = saved, id = receipt.id;
            if (acknowledged.has(id)) return;
            if (!pending) return;
            confirmedLayers += (pending.layers?.length || 0) + (pending.revisions?.length || 0);
            confirmedOperations.push(...projectMaintenanceResult(saved.receipts).operations);
            acknowledged.add(id);
            refresh(current); pending = null; overlay.clear(); conflicts.clear(); observed.clear(); completionBaseline.clear();
        },
        conclude(outcome) {
            const draft = ensurePending();
            draft.note = outcome.summary || draft.note;
            draft.outcome = { status: outcome.status, ...(outcome.code ? { code: outcome.code } : {}),
                ...(outcome.error ? { error: structuredClone(outcome.error) } : {}) };
        },
    };
}
