import { createSummaryBaseline } from '../summary-history.js';
import { applySummaryUndo } from '../summary-undo.js';
import { restoreMaintenance } from '../../maintenance/domain.js';
import { parseEventRange } from '../../vector/retrieval/temporal-turn-carrier.js';

// Project the old ledger at every reversible boundary. A later edit to an old
// scene belongs to the editing boundary, not the floor the scene describes.
function byRound(cards, history, owners) {
    const rounds = new Map();
    const byId = new Map(cards.filter(Boolean).map(card => [card.id, card]));
    for (const card of cards) {
        if (!card || typeof card !== 'object') continue;
        const range = parseEventRange(card.summary);
        const created = owners.get(card._addedAt);
        let owner = created;
        if (range && !(created && range.start > (created.previousEndMesId ?? -1) && range.end <= created.endMesId)) {
            owner = history.find(batch => range.start > (batch.previousEndMesId ?? -1) && range.end <= batch.endMesId) || created;
        }
        owner ||= history[0];
        if (!owner) throw new Error('旧剧情缺少存档边界');
        const note = rounds.get(owner.endMesId) || { lines: [], characters: [], locations: [], times: [] };
        const causes = (Array.isArray(card.causedBy) ? card.causedBy : []).map(id => byId.get(id)?.title || id);
        const line = [card.timeLabel, card.title, card.summary, causes.length && '前因：' + causes.join('、')].filter(Boolean).join(' · ');
        if (line && !note.lines.includes(line)) note.lines.push(line);
        for (const [field, values] of [['characters', (Array.isArray(card.participants) ? card.participants : []).map(person => typeof person === 'string' ? person : person?.name)], ['locations', [card.location]], ['times', [card.timeLabel]]]) {
            for (const value of values) if (value && !note[field].includes(value)) note[field].push(value);
        }
        rounds.set(owner.endMesId, note);
    }
    return rounds;
}

function differences(before, after) {
    const changes = [];
    for (const end of new Set([...before.keys(), ...after.keys()])) {
        if (JSON.stringify(before.get(end)) !== JSON.stringify(after.get(end))) changes.push({ end, note: after.get(end) || null });
    }
    return changes;
}

export function migrateRoundSummaries(store) {
    if (store.summaryInvalid || !store.json) return false;
    let history = store.summaryHistory || [];
    if (!history.length && store.json.events?.length && !store.pendingImportBoundary
        && Number.isSafeInteger(store.lastSummarizedMesId) && store.lastSummarizedMesId >= 0) {
        history = [createSummaryBaseline(store.lastSummarizedMesId)];
    }
    if (!history.length || store.pendingImportBoundary) {
        const cards = store.json.events;
        if (!Array.isArray(cards) || !cards.length) return false;
        // A portable or boundary-less archive has no verified local floor.
        // Keep its text available for reading, without binding it to local prose.
        const note = byRound(cards, [{ endMesId: -1 }], new Map()).get(-1);
        if (!note) return false;
        const importedRounds = [...(store.json.importedRounds || []), { title: '本轮总结', timeLabel: '旧档汇总',
            summary: note.lines.join('\n'), participants: note.characters, memoryRole: '本轮总结' }];
        store.json = { ...store.json, importedRounds };
        delete store.json.events;
        return true;
    }
    const hasOld = store.json.events?.length || history.some(b => b.undo?.eventChanges || b.undo?.previousEvents
        || b.floorEntry?.eventIds?.length || b.maintenance.some(r => r.operations.some(op => op.changes.some(c => c.collection === 'events'))));
    if (!hasOld) return false;
    let cards = store.json.events || [];
    const owners = new Map(history.map(batch => [batch.endMesId, batch]));
    let after = byRound(cards, history, owners);
    const converted = [...history];
    for (let i = history.length - 1; i >= 0; i--) {
        const batch = structuredClone(history[i]);
        const inverse = { version: 1 };
        for (const key of ['eventChanges', 'previousEvents', 'generatedEvents']) if (batch.undo?.[key]) {
            inverse[key] = batch.undo[key];
            delete batch.undo[key];
        }
        const receipts = batch.maintenance.map(receipt => ({ operations: receipt.operations.map(op =>
            ({ changes: op.changes.filter(change => change.collection === 'events') })) }));
        const hasEdits = receipts.some(r => r.operations.some(op => op.changes.length));
        if (hasEdits) {
            try {
                cards = restoreMaintenance({ json: { events: cards }, atoms: [] }, receipts).json.events;
            } catch (cause) {
                throw Object.assign(new Error('旧剧情与校对回执不一致', { cause }), { code: 'summary_history_invalid' });
            }
            for (const receipt of batch.maintenance) {
                // Preserve the old receipt and its audit details without replaying card operations.
                const archived = receipt.operations.filter(op => op.changes.some(c => c.collection === 'events'));
                if (archived.length) receipt.legacyOperations = archived;
                receipt.operations = receipt.operations.map(op => ({ ...op, changes: op.changes.filter(c => c.collection !== 'events') }))
                    .filter(op => op.changes.length);
            }
        }
        const changed = hasEdits || Object.keys(inverse).length > 1;
        const prior = changed ? applySummaryUndo({ events: cards }, inverse) : { events: cards };
        if (!prior) throw Object.assign(new Error('旧剧情回退记录不一致'), { code: 'summary_history_invalid' });
        cards = prior.events || [];
        const before = changed ? byRound(cards, history, owners) : after;
        const changes = changed ? differences(before, after) : [];
        if (changes.length) batch.legacyRoundChanges = changes;
        if (i === 0 && before.size) batch.legacyRoundBase = differences(new Map(), before);
        if (batch.floorEntry) {
            delete batch.floorEntry.eventIds;
            delete batch.floorEntry.payload?.updates?.events;
        }
        converted[i] = batch;
        after = before;
    }
    const json = { ...store.json };
    delete json.events;
    store.json = json;
    store.summaryHistory = converted;
    return true;
}
