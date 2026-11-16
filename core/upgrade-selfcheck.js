function isPlainRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/**
 * Remove orphan or malformed `floorWork` rows left behind by older plugin versions
 * or interrupted deletions without disturbing valid in-range floor entries.
 *
 * @param {Record<string, unknown> | null | undefined} storySummary
 * @param {Array<{ is_user?: boolean }>} [chat]
 * @returns {{ changed: boolean, prunedFloors: string[] }}
 */
export function pruneOrphanFloorWork(storySummary, chat = []) {
    if (!isPlainRecord(storySummary) || !isPlainRecord(storySummary.floorWork)) {
        return { changed: false, prunedFloors: [] };
    }
    const chatLength = Array.isArray(chat) ? chat.length : 0;
    const floorWork = storySummary.floorWork;
    const prunedFloors = [];

    for (const [key, row] of Object.entries(floorWork)) {
        const floor = Number(key);
        const validFloorIndex = String(floor) === String(key).trim()
            && Number.isInteger(floor)
            && floor >= 0
            && floor < chatLength;
        const userMessageFloor = validFloorIndex && Boolean(chat[floor]?.is_user);
        const validRow = isPlainRecord(row);
        const isEmptyShell = validRow
            && !row.source
            && (!Array.isArray(row.done) || row.done.length === 0)
            && !row.review
            && !row.chapter;

        if (!validFloorIndex || userMessageFloor || !validRow || isEmptyShell) {
            delete floorWork[key];
            prunedFloors.push(key);
        }
    }

    if (Object.keys(floorWork).length === 0) {
        delete storySummary.floorWork;
    }

    return {
        changed: prunedFloors.length > 0,
        prunedFloors,
    };
}

/**
 * Inspect World Archive entities non-destructively for corrupted or non-integer `coins` fields.
 *
 * @param {{ entities?: Array<Record<string, any>> } | null | undefined} worldState
 * @returns {{
 *   ok: boolean,
 *   invalidCoins: Array<{ entityId: string, name: string, value: unknown }>,
 *   notice: string
 * }}
 */
export function validateWorldCoinsFields(worldState) {
    const entities = Array.isArray(worldState?.entities) ? worldState.entities : [];
    const invalidCoins = [];

    for (const entity of entities) {
        if (!entity || typeof entity !== 'object') continue;
        const fields = entity.fields;
        if (!fields || typeof fields !== 'object' || !Object.hasOwn(fields, 'coins')) continue;

        const rawEntry = fields.coins;
        const rawValue = rawEntry && typeof rawEntry === 'object' && Object.hasOwn(rawEntry, 'value')
            ? rawEntry.value
            : rawEntry;
        if (rawValue === undefined) continue;

        const validCoin = typeof rawValue === 'number'
            && Number.isSafeInteger(rawValue)
            && rawValue >= 0;
        if (!validCoin) {
            invalidCoins.push({
                entityId: String(entity.id || ''),
                name: String(entity.name || entity.id || '未命名角色'),
                value: rawValue,
            });
        }
    }

    if (!invalidCoins.length) {
        return { ok: true, invalidCoins, notice: '' };
    }

    const preview = invalidCoins
        .slice(0, 3)
        .map(item => `${item.name}(${String(item.value)})`)
        .join('、');
    const suffix = invalidCoins.length > 3 ? ` 等 ${invalidCoins.length} 项` : '';
    return {
        ok: false,
        invalidCoins,
        notice: `升级自检发现世界档案货币字段异常：${preview}${suffix}。系统已保留原始记录未擅自清零，请在「人物 / 世界设定」面板核对并修正为非负整数。`,
    };
}

/**
 * Check whether cached vector embeddings match the active model fingerprint and dimensions.
 *
 * @param {{ dimsMismatch?: boolean, fingerprintMismatch?: boolean } | null | undefined} vectorStatus
 * @returns {{
 *   ok: boolean,
 *   needsRebuild: boolean,
 *   dimsMismatch: boolean,
 *   fingerprintMismatch: boolean,
 *   notice: string
 * }}
 */
export function inspectVectorUpgradeCompatibility(vectorStatus) {
    const dimsMismatch = Boolean(vectorStatus?.dimsMismatch);
    const fingerprintMismatch = Boolean(vectorStatus?.fingerprintMismatch);
    const needsRebuild = dimsMismatch || fingerprintMismatch;

    if (!needsRebuild) {
        return {
            ok: true,
            needsRebuild: false,
            dimsMismatch: false,
            fingerprintMismatch: false,
            notice: '',
        };
    }

    return {
        ok: false,
        needsRebuild: true,
        dimsMismatch,
        fingerprintMismatch,
        notice: dimsMismatch
            ? '升级自检发现向量维度与当前 Embedding 模型不一致，旧向量已保护保留，请前往「剧情总结 -> 向量设置」点击「重建向量索引」。'
            : '升级自检发现向量模型指纹已变更，请前往「剧情总结 -> 向量设置」一键重建以恢复完整召回。',
    };
}

/**
 * Run the idempotent 0.2.32/0.2.34 -> Final upgrade self-check pipeline.
 *
 * @param {{
 *   storySummary?: Record<string, unknown> | null,
 *   chat?: Array<{ is_user?: boolean }>,
 *   worldState?: { entities?: Array<Record<string, any>> } | null,
 *   vectorStatus?: { dimsMismatch?: boolean, fingerprintMismatch?: boolean } | null,
 *   onPruneFloorWork?: (prunedFloors: string[], cleanedStorySummary: Record<string, unknown>) => Promise<void> | void
 * }} [input]
 * @returns {Promise<{
 *   ok: boolean,
 *   prunedFloors: string[],
 *   invalidCoins: Array<{ entityId: string, name: string, value: unknown }>,
 *   vectorIssue: ReturnType<typeof inspectVectorUpgradeCompatibility>,
 *   notices: string[]
 * }>}
 */
export async function runUpgradeSelfCheck({
    storySummary = null,
    chat = [],
    worldState = null,
    vectorStatus = null,
    onPruneFloorWork,
} = {}) {
    const orphanResult = pruneOrphanFloorWork(storySummary, chat);
    if (orphanResult.changed && typeof onPruneFloorWork === 'function' && storySummary) {
        await onPruneFloorWork(orphanResult.prunedFloors, storySummary);
    }

    const coinResult = validateWorldCoinsFields(worldState);
    const vectorIssue = inspectVectorUpgradeCompatibility(vectorStatus);

    const notices = [];
    if (orphanResult.changed) {
        notices.push(`升级自检已安全清理 ${orphanResult.prunedFloors.length} 条越界/孤儿楼层进度记录（floorWork: ${orphanResult.prunedFloors.join(', ')}）。`);
    }
    if (!coinResult.ok) {
        notices.push(coinResult.notice);
    }
    if (!vectorIssue.ok) {
        notices.push(vectorIssue.notice);
    }

    return {
        ok: coinResult.ok && vectorIssue.ok,
        prunedFloors: orphanResult.prunedFloors,
        invalidCoins: coinResult.invalidCoins,
        vectorIssue,
        notices,
    };
}
