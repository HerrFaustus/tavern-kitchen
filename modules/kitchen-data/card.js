import { retireArcData } from '../story-summary/data/legacy-arcs.js';
import { createIdentifier } from '../../shared/common/identifier.js';
import { validateWorld, forkWorld, canonical } from '../world-records/domain.js';
import { readSummaryPackageData } from '../story-summary/data/summary-import.js';
import { validateRangeSource } from '../story-summary/data/turn-source.js';
import { taskDefinitions } from '../world-records/turn-actions.js';

const LEGACY_CARD_TASK_KEYS = ['clues', 'peopleEvolution', 'subscribed', 'sceneryEvolution', 'encounter', 'mapEvolution'];
const isKnownCardTask = key => Object.hasOwn(taskDefinitions, key) || LEGACY_CARD_TASK_KEYS.includes(key);

function validateFloorWork(work) {
    if (work === undefined) return;
    const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
    const tasks = list => Array.isArray(list) && new Set(list).size === list.length && list.every(isKnownCardTask);
    const effect = key => /^turn:[a-f0-9]{64}$/.test(key);
    const assert = valid => { if (!valid) throw new Error('逐楼处理记录格式无效'); };
    assert(record(work));
    for (const [end, entry] of Object.entries(work)) {
        assert(record(entry));
        const source = validateRangeSource(entry.source);
        assert(String(source.end) === end && entry.digest === source.digest && tasks(entry.done));
        assert(source.messages.at(-1).role === 'assistant' && (source.messages.length === 1 || source.messages.length === 2 && source.messages[0].role === 'user'));
        if (entry.chapter !== undefined) assert(/^[a-f0-9]{64}$/.test(entry.chapter));
        if (entry.pending !== undefined) {
            assert(record(entry.pending));
            for (const [id, draft] of Object.entries(entry.pending)) {
                assert(/^[a-f0-9]{64}$/.test(id) && record(draft) && tasks(draft.keys) && typeof draft.sim === 'boolean'
                    && Number.isSafeInteger(draft.basis) && draft.basis >= 0 && Array.isArray(draft.groups)
                    && draft.groups.every(g => record(g) && typeof g.id === 'string' && Array.isArray(g.rows) && g.rows.every(r => draft.keys.includes(r?.task))));
            }
        }
        if (entry.decisions !== undefined) assert(record(entry.decisions) && Object.entries(entry.decisions).every(([id, d]) => effect(id) && ['accepted', 'rejected'].includes(d)));
        if (entry.review !== undefined) assert(record(entry.review) && Object.entries(entry.review).every(([id, row]) => effect(id) && typeof row?.reason === 'string'
            && Array.isArray(row.rows) && row.rows.every(r => isKnownCardTask(r?.task))));
    }
}

function validateFloorSimulations(simulations) {
    if (simulations === undefined) return;
    const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
    const assert = valid => { if (!valid) throw new Error('逐楼推演记录格式无效'); };
    assert(record(simulations));
    for (const [end, entry] of Object.entries(simulations)) {
        assert(record(entry));
        assert(Number.isSafeInteger(entry.floor) && entry.floor >= 0 && String(entry.floor) === end);
        assert(typeof entry.digest === 'string' && !!entry.digest && typeof entry.text === 'string');
    }
}

export function cardMemory(value) {
    const fields = ['json', 'floorWork', 'floorSimulations', 'lastSummarizedMesId', 'summaryHistory', 'floorDrafts', 'pendingImportBoundary', 'summaryInvalid', 'sourceInvalidFromFloor', 'sourceRollbackFromFloor', 'updatedAt', 'importedArchive'];
    return { storySummary: Object.fromEntries(fields.filter(key => Object.hasOwn(value.storySummary, key)).map(key => [key, retireArcData(value.storySummary[key])])),
        stateAtoms: structuredClone(value.stateAtoms), l0Index: structuredClone(value.l0Index) };
}

export function validateKitchenCard(value) {
    if (value?.type !== 'TavernKitchenCard' || value.version !== 1 || !value.data) throw new Error('不支持的后厨卡格式');
    const { memory, summary, world, notes, source } = value.data;
    if (!memory?.storySummary || !Array.isArray(memory.stateAtoms) || !memory.l0Index
        || !Array.isArray(notes) || notes.length > 10000 || typeof source?.digest !== 'string') throw new Error('后厨卡数据不完整');
    readSummaryPackageData(summary);
    validateFloorWork(memory.storySummary.floorWork);
    validateFloorSimulations(memory.storySummary.floorSimulations);
    if (memory.storySummary.summaryHistory !== undefined && !Array.isArray(memory.storySummary.summaryHistory)) throw new Error('总结历史格式无效');
    if (world) {
        const parsed = validateWorld(structuredClone(world));
        const replay = forkWorld(parsed, parsed.version, createIdentifier(), { verifyFullHistory: true });
        if (['entities','claims','sources','modules'].some(key => canonical(parsed[key] ?? null) !== canonical(replay[key] ?? null))) throw new Error('世界数据与历史不一致');
    }
    const compatibleNotes = notes.map(note => {
        if (!note || typeof note !== 'object') return note;
        const result = {...note};
        for (const key of ['global','chapter']) {
            const part=note[key];
            if (typeof part === 'string') result[key]={text:part,dependencies:[]};
            else if (part && part.dependencies === undefined) result[key]={...part,dependencies:[]};
        }
        return result;
    });
    if (new Set(notes.map(note => note?.id)).size !== notes.length) throw new Error('编剧札记编号重复');
    const validDependencies = part => Array.isArray(part?.dependencies) && part.dependencies.length <= 40 && part.dependencies.every(ref =>
        ref && typeof ref === 'object' && typeof ref.digest === 'string' && !!ref.digest
        && (typeof ref.lineTitle === 'string' && !!ref.lineTitle || typeof ref.recordId === 'string' && !!ref.recordId
            || typeof ref.entityId === 'string' && !!ref.entityId && typeof ref.field === 'string' && !!ref.field));
    for (const note of compatibleNotes) {
        if (typeof note.id !== 'string' || !Number.isSafeInteger(note.end) || typeof note.source !== 'string'
            || !Number.isSafeInteger(note.revision) || note.revision < 1
            || typeof note.global?.text !== 'string' || typeof note.chapter?.text !== 'string'
            || !validDependencies(note.global) || !validDependencies(note.chapter)
            || note.chapter.text.includes('{{') || note.global.text.length > 16000 || note.chapter.text.length > 24000) throw new Error('编剧札记格式无效');
    }
    return { ...value.data, notes:compatibleNotes, summary:retireArcData(summary), memory: cardMemory(memory) };
}

export function createKitchenCards({ memory, world, isCurrent }) {
    return {
        async export() {
            const snapshot = memory.read(), identity = snapshot.identity;
            const state = await world.read();
            const current = memory.read();
            if (!isCurrent(identity) || canonical({memory:current.memory,source:current.source}) !== canonical({memory:snapshot.memory,source:snapshot.source})) throw new Error('数据读取期间聊天或总结已变化，请重试');
            return {
                type: 'TavernKitchenCard', version: 1, createdAt: new Date().toISOString(),
                data: { memory: cardMemory(snapshot.memory), summary: retireArcData(snapshot.summary), source: snapshot.source, world: state.world, notes: state.notes },
            };
        },
        async import(value) {
            const data = validateKitchenCard(value);
            return memory.write(async transaction => {
                const namespace = createIdentifier();
                const staged = await world.stage(data.world, data.notes, namespace, transaction.assertCurrent);
                transaction.assertCurrent();
                await transaction.commit(data, namespace, staged.assertCurrent);
                return { rounds: data.summary.data.rounds?.length || 0, people: data.world?.entities.filter(row => row.kind === 'person').length || 0, notes: data.notes.length };
            });
        },
    };
}
