import { createSummaryBaseline } from './summary-history.js';
import { assignImportedFactIds } from './fact-identity.js';
import { MEMORY_DATA_COPY } from './memory-copy.js';
import { parseStoryUpdates } from '../../story-state/records.js';

export const SUMMARY_MEMORY_PACKAGE = Object.freeze({ type: 'TavernKitchenStorySummaryMemory', version: 1 });

export function readSummaryPackageData(raw) {
    const data = raw?.data;
    if (raw?.type !== SUMMARY_MEMORY_PACKAGE.type || raw?.version !== SUMMARY_MEMORY_PACKAGE.version
        || !data || typeof data !== 'object' || Array.isArray(data)
        || !Array.isArray(data.facts)
        || !data.facts.every(fact => ['人物名字', '种类', '描述'].every(key =>
            typeof fact?.[key] === 'string' && fact[key].trim()))) {
        throw Object.assign(new Error(MEMORY_DATA_COPY.unsupportedImport), { code: 'summary_import_unsupported' });
    }
    if (data.storyRecords !== undefined) {
        if (!Array.isArray(data.storyRecords) || data.storyRecords.length > 20000 || new Set(data.storyRecords.map(record => record.id)).size !== data.storyRecords.length) throw new Error('场景状态导入结构无效');
        for (const record of data.storyRecords) {
            if (record.remove) throw new Error('场景状态存档不能包含删除指令');
            parseStoryUpdates([record]);
        }
    }
    return data;
}

function stampImportedSummaryJson(json, boundary) {
    if (!json || typeof json !== "object" || !Number.isFinite(boundary) || boundary < 0) {
        return;
    }

    for (const item of (json.keywords || [])) {
        if (item && typeof item === "object") item._addedAt = boundary;
    }
    for (const record of json.storyRecords || []) { record._addedAt = boundary; delete record._sourceStart; }

    for (const item of (json.events || [])) {
        if (item && typeof item === "object") item._addedAt = boundary;
    }

    const mainCharacters = json.characters?.main || [];
    for (const item of mainCharacters) {
        if (item && typeof item === "object") item._addedAt = boundary;
    }

    for (const alias of (json.characterAliases || [])) {
        if (alias && typeof alias === "object") alias._addedAt = boundary;
    }

    for (const arc of (json.arcs || [])) {
        if (!arc || typeof arc !== "object") continue;
        arc._addedAt = boundary;
        for (const moment of (arc.moments || [])) {
            if (moment && typeof moment === "object") moment._addedAt = boundary;
        }
    }

    for (const fact of (json.facts || [])) {
        if (fact && typeof fact === "object") fact._addedAt = boundary;
    }
}

export function applyImportedSummaryBoundary(store, boundary) {
    if (!store?.json || !Number.isFinite(boundary) || boundary < 0) {
        return false;
    }

    stampImportedSummaryJson(store.json, boundary);
    store.lastSummarizedMesId = boundary;
    store.summaryHistory = [createSummaryBaseline(boundary)];
    delete store.pendingImportBoundary;
    store.updatedAt = Date.now();
    return true;
}

export function prepareImportedSummary(previous, json, boundary) {
    const next = structuredClone(previous);
    const store = next.storySummary;
    store.json = structuredClone(json);
    store.json.facts = assignImportedFactIds(store.json.facts);
    delete store.summaryInvalid;
    delete store.sourceInvalidFromFloor;
    delete store.sourceRollbackFromFloor;
    if (boundary >= 0) applyImportedSummaryBoundary(store, boundary);
    else {
        store.lastSummarizedMesId = -1;
        store.summaryHistory = [];
        store.pendingImportBoundary = true;
    }
    store.updatedAt = Date.now();
    next.stateAtoms = [];
    next.l0Index = { version: 1, byFloor: {} };
    return next;
}
