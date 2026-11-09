import { createIdentifier } from '../../shared/common/identifier.js';
import { validateWorld, forkWorld, canonical } from '../world-records/domain.js';
import { readSummaryPackageData } from '../story-summary/data/summary-import.js';

export function cardMemory(value) {
    const fields = ['json','lastSummarizedMesId','summaryHistory','floorDrafts','pendingImportBoundary','summaryInvalid','sourceInvalidFromFloor','sourceRollbackFromFloor','updatedAt','importedArchive'];
    return { storySummary: Object.fromEntries(fields.filter(key => Object.hasOwn(value.storySummary,key)).map(key => [key,structuredClone(value.storySummary[key])])),
        stateAtoms: structuredClone(value.stateAtoms), l0Index: structuredClone(value.l0Index) };
}

export function validateKitchenCard(value) {
    if (value?.type !== 'TavernKitchenCard' || value.version !== 1 || !value.data) throw new Error('不支持的后厨卡格式');
    const { memory, summary, world, notes, source } = value.data;
    if (!memory?.storySummary || !Array.isArray(memory.stateAtoms) || !memory.l0Index
        || !Array.isArray(notes) || notes.length > 10000 || typeof source?.digest !== 'string') throw new Error('后厨卡数据不完整');
    readSummaryPackageData(summary);
    if (memory.storySummary.summaryHistory !== undefined && !Array.isArray(memory.storySummary.summaryHistory)) throw new Error('总结历史格式无效');
    if (world) {
        const parsed = validateWorld(structuredClone(world));
        const replay = forkWorld(parsed, parsed.version, createIdentifier());
        if (['entities','claims','sources','modules'].some(key => canonical(parsed[key] ?? null) !== canonical(replay[key] ?? null))) throw new Error('世界数据与历史不一致');
    }
    if (new Set(notes.map(note => note?.id)).size !== notes.length) throw new Error('编剧札记编号重复');
    const validDependencies = part => Array.isArray(part?.dependencies) && part.dependencies.length <= 40 && part.dependencies.every(ref =>
        ref && typeof ref === 'object' && typeof ref.digest === 'string' && !!ref.digest
        && (typeof ref.lineTitle === 'string' && !!ref.lineTitle || typeof ref.recordId === 'string' && !!ref.recordId
            || typeof ref.entityId === 'string' && !!ref.entityId && typeof ref.field === 'string' && !!ref.field));
    for (const note of notes) {
        if (typeof note.id !== 'string' || !Number.isSafeInteger(note.end) || typeof note.source !== 'string'
            || !Number.isSafeInteger(note.revision) || note.revision < 1
            || typeof note.global?.text !== 'string' || typeof note.chapter?.text !== 'string'
            || !validDependencies(note.global) || !validDependencies(note.chapter)
            || note.chapter.text.includes('{{') || note.global.text.length > 16000 || note.chapter.text.length > 24000) throw new Error('编剧札记格式无效');
    }
    return { ...value.data, memory: cardMemory(memory) };
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
                data: { memory: cardMemory(snapshot.memory), summary: snapshot.summary, source: snapshot.source, world: state.world, notes: state.notes },
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
