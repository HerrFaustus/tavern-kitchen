import { captureRangeSource, isRangeSourceCurrent } from '../data/turn-source.js';
// Story Summary - Generator
// 调用 LLM 生成总结

import { getContext } from "../../../../../../extensions.js";
import { xbLog } from "../../../core/debug-core.js";
import {
    addSummarySnapshot,
    getFacts,
    getSummaryStore,
    mergeNewData,
    isSummaryConsumable,
    isFloorMemoryOmitted,
} from "../data/store.js";
import { commitSummaryMemory, readSummaryMemory, waitForMemoryCommit, getMemoryCommitState } from '../data/memory-commit.js';
import { memorySaveError } from '../data/memory-copy.js';
import { panelEnabled } from '../../../core/panel-policy.js';
import { plotLinePrompt, readPlotLines } from '../../story-state/plot-lines.js';
import { prepareMemoryTags } from '../data/memory-tags.js';
import { SUMMARY_FEEDBACK_COPY } from '../feedback-copy.js';
import { summaryFailureReason } from '../summary-failure.js';
import { formatCharacterAliasTableForAI } from "../data/character-aliases.js";
import {
    generateSummary,
    isSummaryGenerationCancelledError,
    parseSummaryJson,
} from "./llm.js";
import { applyTextFilterRules } from '../data/text-filter-rules.js';
import { getTextFilterRules } from '../data/config.js';
import { memoryPolicy } from '../data/memory-policy.js';
import { getSummarySourceEnd } from './source-boundary.js';
import { normalizeSummaryDelayFloors } from '../data/summary-delay.js';
import { prepareSummaryResult } from './summary-result.js';
import { notifySummaryCommitted } from '../maintenance/notification.js';
import { getChatIdentity } from '../data/chat-identity.js';
import { prepareMemorySources, assertMemorySources, validateMemorySources, deliverMemorySources } from '../../world-records/turn-runtime.js';
import { prepareInvolvement } from '../../story-state/involvement.js';
import { prepareAmbient } from '../../story-state/ambient.js';
import { prepareWorldUpdate } from '../../world-records/update-result.js';

const MODULE_ID = 'summaryGenerator';

// ═══════════════════════════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════════════════════════

export function formatExistingSummaryForAI(store) {
    if (!store?.json) return "（空白，这是首次总结）";

    const data = store.json;
    const parts = [];
    const records = data.storyRecords?.filter(record => record.kind !== 'scene');
    if (records?.length) parts.push('【当前剧情状态与待办，更新时复用 id】\n' + JSON.stringify(records));


    if (data.characters?.main?.length) {
        const names = data.characters.main.map(m => typeof m === 'string' ? m : m.name);
        parts.push(`\n【主要角色】${names.join("、")}`);
    }

    const aliasTable = formatCharacterAliasTableForAI(data);
    if (aliasTable) {
        parts.push("\n【角色别名表】");
        parts.push(aliasTable);
    }


    return parts.join("\n") || "（空白，这是首次总结）";
}

export function buildIncrementalSlice(targetMesId, lastSummarizedMesId, maxPerRun = 100, delayFloors = 0, filterRules = getTextFilterRules()) {
    const { chat, name1, name2 } = getContext();

    const start = Math.max(0, (lastSummarizedMesId ?? -1) + 1);
    const rawEnd = getSummarySourceEnd(chat, targetMesId, delayFloors);
    const end = Math.min(rawEnd, start + maxPerRun - 1);

    if (start > end) return { text: "", count: 0, range: "", endMesId: -1 };

    const userLabel = name1 || '用户';
    const charLabel = name2 || '角色';
    const slice = chat.slice(start, end + 1);

    const text = slice.map((m, i) => {
        if (isFloorMemoryOmitted(start + i)) return '';
        const speaker = m.name || (m.is_user ? userLabel : charLabel);
        const filteredMessage = applyTextFilterRules(m.mes || '', filterRules);
        return `#${start + i + 1} 【${speaker}】\n${filteredMessage}`;
    }).filter(Boolean).join('\n\n');

    return { text, count: slice.length, range: `${start + 1}-${end + 1}楼`, endMesId: end };
}

// ═══════════════════════════════════════════════════════════════════════════
// 主生成函数
// ═══════════════════════════════════════════════════════════════════════════

function isSummaryRunInactive(signal, targetChatId, targetIdentity) {
    return signal?.aborted || (targetChatId && getContext()?.chatId !== targetChatId)
        || getChatIdentity(getContext()) !== targetIdentity;
}

function cancelledResult(onStatus, committed = false) {
    onStatus?.(committed ? "总结已保存，后续处理已停止" : SUMMARY_FEEDBACK_COPY.summaryStopped);
    return { success: committed, cancelled: true, committed };
}

function staleSourceResult(onStatus) {
    onStatus?.("对话或总结内容已变化，本次结果未保存");
    return { success: false, stale: true };
}

export async function runSummaryGeneration(mesId, config, callbacks = {}, runtime = {}) {
    const { onStatus, onError, onComplete, onProgress } = callbacks;
    const { signal = null, targetChatId = getContext()?.chatId || null } = runtime;
    const targetIdentity = getChatIdentity(getContext());

    if (isSummaryRunInactive(signal, targetChatId, targetIdentity)) {
        return cancelledResult(onStatus);
    }

    onProgress?.({ stage: 'history' });
    const store = getSummaryStore();
    if (!isSummaryConsumable(store, getContext().chat?.length || 0)) {
        onError?.(summaryFailureReason('summary_invalid'));
        return { success: false, error: "summary_invalid" };
    }
    const lastSummarized = store?.lastSummarizedMesId ?? -1;
    const maxPerRun = config.trigger?.maxPerRun || 100;
    const delayFloors = normalizeSummaryDelayFloors(config.trigger?.delayFloors);
    const filterRules = structuredClone(getTextFilterRules());
    const slice = buildIncrementalSlice(mesId, lastSummarized, maxPerRun, delayFloors, filterRules);

    if (slice.count === 0) {
        const { chat } = getContext();
        onStatus?.(getSummarySourceEnd(chat, mesId) < Math.min(mesId, chat.length - 1)
            ? "末尾对话仍在更新，将在后续剧情开始后纳入总结" : "没有新的对话需要总结");
        return { success: true, noContent: true };
    }

    onProgress?.({ stage: 'request', range: { from: slice.endMesId - slice.count + 2, to: slice.endMesId + 1 } });

    onStatus?.(`正在总结 ${slice.range}（${slice.count}楼新内容）...`);

    const existingSummary = formatExistingSummaryForAI(store);
    const existingFacts = getFacts();

    const roundSource = captureRangeSource(getContext().chat, lastSummarized + 1, slice.endMesId);
    let raw, preparedSources;
    try {
        preparedSources = await prepareMemorySources(lastSummarized + 1, slice.endMesId, { unified: true });
        raw = await generateSummary({
            linePrompt: plotLinePrompt(store.summaryHistory, preparedSources?.updateContext?.world?.storyRecords ?? store.json?.storyRecords),
            existingSummary,
            existingFacts,
            newHistoryText: slice.text,
            historyRange: slice.range,
            signal,
            updateContext: preparedSources?.updateContext,
        });
        if (isSummaryRunInactive(signal, targetChatId, targetIdentity)) {
            return cancelledResult(onStatus);
        }
        // Wait before revalidating or merging: a maintenance save may still be
        // publishing its receipt, or may restore the previous snapshot on failure.
        onProgress?.({ stage: 'save_confirmation' });
        do { await waitForMemoryCommit(signal); } while (getMemoryCommitState() === 'saving');
        await validateMemorySources(preparedSources);
    } catch (err) {
        if (isSummaryGenerationCancelledError(err) || isSummaryRunInactive(signal, targetChatId, targetIdentity)) {
            onStatus?.(SUMMARY_FEEDBACK_COPY.summaryStopped);
            return { success: false, cancelled: true };
        }
        xbLog.error(MODULE_ID, '生成失败', err);
        onError?.(summaryFailureReason(err));
        return { success: false, error: err };
    }

    if (isSummaryRunInactive(signal, targetChatId, targetIdentity)) {
        return cancelledResult(onStatus);
    }
    // Revalidate the captured slice without expanding it when new messages make
    // more floors eligible. A shortened chat must still respect the delayed tail.
    // Maintenance of earlier memory is mergeable, not a change to these floors.
    onProgress?.({ stage: 'source_validation' });
    const currentSlice = buildIncrementalSlice(slice.endMesId, lastSummarized, maxPerRun, delayFloors, filterRules);
    if (
        (store?.lastSummarizedMesId ?? -1) !== lastSummarized
        || currentSlice.endMesId !== slice.endMesId
        || !isRangeSourceCurrent(roundSource, getContext().chat) || currentSlice.text !== slice.text
    ) {
        return staleSourceResult(onStatus);
    }

    onProgress?.({ stage: 'response' });
    if (!raw?.trim()) {
        xbLog.error(MODULE_ID, 'AI返回为空');
        onError?.(summaryFailureReason('empty'));
        return { success: false, error: "empty" };
    }

    onProgress?.({ stage: 'parse' });
    const decoded = parseSummaryJson(raw);
    if (!decoded) {
        xbLog.error(MODULE_ID, 'JSON解析失败');
        onError?.(summaryFailureReason('parse'));
        return { success: false, error: "parse" };
    }

    onProgress?.({ stage: 'structure' });
    let parsed, worldUpdate, narrativeSummary, memoryTags;
    try {
        if (typeof decoded.summary !== 'string' || !decoded.summary.trim() || decoded.summary.length > 12000) throw Object.assign(new Error('须提供非空本轮总结，最多 12000 字符'), { code: 'invalid_summary_field', path: 'summary' });
        narrativeSummary = decoded.summary.trim();
        memoryTags = prepareMemoryTags(decoded);
        if (preparedSources?.updateContext) {
            if (decoded.storyUpdates !== undefined && (!Array.isArray(decoded.storyUpdates) || decoded.storyUpdates.length)) throw new Error('人物、认知与计划变化须进入 worldUpdate 的 story 提案，不直接改写当前状态');
            worldUpdate = prepareWorldUpdate(decoded.worldUpdate, preparedSources.updateContext);
        }
        parsed = prepareSummaryResult(decoded);
    } catch (error) {
        const failure = Object.assign(new Error(SUMMARY_FEEDBACK_COPY.summaryResultInvalid, { cause: error }), { code: 'structure' });
        const message = summaryFailureReason(failure);
        xbLog.error(MODULE_ID, message, error);
        onError?.(message);
        return { success: false, error: failure };
    }

    onProgress?.({ stage: 'merge' });
    const previous = readSummaryMemory();
    // Append to the latest published memory. Incoming facts/arcs take precedence;
    // untouched maintenance edits and their receipts remain in the same snapshot.
    const mergeResult = mergeNewData(previous.storySummary.json || {}, parsed, slice.endMesId, { returnMeta: true, sourceStart: lastSummarized + 1 });
    const merged = mergeResult.json;
    const next = structuredClone(previous);
    next.storySummary.lastSummarizedMesId = slice.endMesId;
    next.storySummary.json = merged;
    delete next.storySummary.pendingImportBoundary;
    next.storySummary.updatedAt = Date.now();
    addSummarySnapshot(next.storySummary, lastSummarized, slice.endMesId, mergeResult.undo, memoryPolicy(filterRules));
    if (preparedSources) next.storySummary.summaryHistory.at(-1).sourceReceipt = structuredClone(preparedSources.receipt);
    const ambientContext = preparedSources?.updateContext;
    const involvement = prepareInvolvement(decoded.involvement, ambientContext, worldUpdate?.proposals);
    const control = ambientContext?.ambientControl;
    const subjects = ambientContext?.involvementContext || [];
    const near = new Set(subjects.filter(row => row.near).map(row => row.key));
    const staysNear = new Set(subjects.filter(row => row.regional || row.fixed).map(row => row.key));
    for (const change of involvement) {
        if (change.action === 'enter') near.add(change.target);
        if (change.action === 'leave' && !staysNear.has(change.target)) near.delete(change.target);
    }
    const livePreferences = preparedSources?.getAmbientPreferences?.();
    const ambient = control && prepareAmbient(decoded.ambient, { ...control, near, messages: ambientContext.increment.messages,
        wake: new Set(involvement.filter(change => change.action === 'wake').map(change => change.target)),
        evolve: control.evolve && livePreferences?.sceneryEvolution === true,
        draw: control.draw && livePreferences?.encounterFrequency !== 'off' }, slice.endMesId,
        ambientContext.world.storyRecords.filter(record => record.kind === 'situation').map(record => record.id), ambientContext.world.entities);
    Object.assign(next.storySummary.summaryHistory.at(-1), { ...(involvement.length && { involvement }), ...(ambient && { ambient }), summary: narrativeSummary,
        ...((decoded.plotLines?.length && panelEnabled('clues')) ? {plotLines:readPlotLines(decoded.plotLines,narrativeSummary)} : {}),
        memoryTags, ...(!preparedSources && { roundSource }), ...(worldUpdate && { worldUpdate }) });

    onProgress?.({ stage: 'saving' });
    try {
        await commitSummaryMemory(targetChatId, next, { previous, validate: () => {
            assertMemorySources(preparedSources);
            if (!isRangeSourceCurrent(roundSource, getContext().chat)) throw new Error('本轮来源已变化');
            const latest = buildIncrementalSlice(slice.endMesId, lastSummarized, maxPerRun, delayFloors, filterRules);
            if (isSummaryRunInactive(signal, targetChatId, targetIdentity) || latest.endMesId !== slice.endMesId || latest.text !== slice.text) {
                throw Object.assign(new Error('metadata_draft_conflict'), { code: 'metadata_draft_conflict' });
            }
        } });
    } catch (error) {
        xbLog.error(MODULE_ID, '总结持久化失败', error);
        onError?.(memorySaveError(error));
        return { success: false, error };
    }

    let proposalDelivery = null, deliveryError = null;
    if (worldUpdate) {
        try { proposalDelivery = await deliverMemorySources(preparedSources); }
        catch (error) { deliveryError = error; onError?.(`摘要与提案已保存，世界记录同步待恢复：${error.message}`); }
    }
    const proposalReviews = proposalDelivery?.reviews || [];
    const proposalAutoConfirmed = proposalReviews.filter(review => review.action === 'accepted' && review.mode === 'automatic').length;
    const proposalPending = Math.max(0, (worldUpdate?.proposals.length || 0) - proposalReviews.length);

    onProgress?.({ stage: 'followup' });
    xbLog.info(MODULE_ID, `总结完成，已更新至 ${slice.endMesId + 1} 楼`);
    if (!signal?.aborted && getChatIdentity(getContext()) === targetIdentity) {
        notifySummaryCommitted({ chatId: targetChatId, identity: targetIdentity, start: lastSummarized + 1, cutoff: slice.endMesId });
    }

    if (parsed.factUpdates?.length) {
        xbLog.info(MODULE_ID, `Facts 更新: ${parsed.factUpdates.length} 条`);
    }

    const result = {
        success: true,
        committed: true,
        merged,
        endMesId: slice.endMesId,
        hasMore: slice.endMesId < getSummarySourceEnd(getContext().chat, mesId, delayFloors),
        aliasChanged: !!mergeResult.aliasChanged,
        ...(worldUpdate ? { proposalCount: worldUpdate.proposals.length, proposalStatus: proposalDelivery?.status || 'pending_delivery',
            proposalAutoConfirmed, proposalPending, deliveryError } : {}),
    };
    onStatus?.(`总结已保存至 ${slice.endMesId + 1} 楼，正在更新检索数据…`);

    try {
        await onComplete?.({
            merged,
            store,
            targetChatId,
            signal,
            endMesId: slice.endMesId,
                aliasChanged: !!mergeResult.aliasChanged,
            factStats: { updated: parsed.factUpdates?.length || 0 },
        });
    } catch (error) {
        if (isSummaryGenerationCancelledError(error) || isSummaryRunInactive(signal, targetChatId, targetIdentity)) {
            return cancelledResult(onStatus, true);
        }
        xbLog.warn(MODULE_ID, '总结已提交，但收尾任务失败', error);
        onError?.(SUMMARY_FEEDBACK_COPY.summaryFollowupFailed(summaryFailureReason(error)));
        return { ...result, followupError: error };
    }

    if (isSummaryRunInactive(signal, targetChatId, targetIdentity)) {
        return cancelledResult(onStatus, true);
    }

    onStatus?.(worldUpdate ? proposalDelivery?.status === 'stale' ? '摘要已保存；世界提案依据的版本已变化，提案已保留。'
        : deliveryError ? '摘要与提案已保存，世界记录同步待恢复。'
        : proposalAutoConfirmed ? `摘要已保存；${proposalAutoConfirmed} 条世界变化已自动写入${proposalPending ? `，${proposalPending} 条留待人工核对。` : '。'}`
        : `摘要与 ${worldUpdate.proposals.length} 条世界提案已保存。`
        : `总结完成，已保存至 ${slice.endMesId + 1} 楼`);
    if (config.trigger?.notifyOnComplete) {
        window.toastr?.success(SUMMARY_FEEDBACK_COPY.summaryCompleted(slice.endMesId + 1));
    }
    return result;
}
