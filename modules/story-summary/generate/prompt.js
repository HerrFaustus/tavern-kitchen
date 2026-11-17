// ═══════════════════════════════════════════════════════════════════════════
// Story Summary - Prompt Injection
//
// 当前正文入口使用原文检索与独立的剧情摘要背景。
// 本模块只构建注入文本，不写入 extension_prompts。
// ═══════════════════════════════════════════════════════════════════════════

import { getContext } from "../../../../../../extensions.js";
import { getPublishedSummaryStore as getSummaryStore, getFacts } from "../data/store.js";
import { floorCoverageEnd } from '../inline/ledger.js';
import { isRelationFact } from "../data/fact-predicates.js";
import { getVectorConfig, getSummaryPanelConfig, getSettings } from "../data/config.js";
import { getMeta } from "../vector/storage/chunk-store.js";
import { getSummarySourceEnd } from './source-boundary.js';
import { recallRawMemory } from '../vector/retrieval/raw-recall.js';
import { plotBackgroundItems } from './plot-background.js';
import { buildTrustedCharacters } from "../vector/retrieval/entity-lexicon.js";
import { filterConstraintsByRelevance } from "./constraint-filter.js";
import { tryConsumeWholeItem } from './token-budget.js';
import { getHiddenThrough } from '../hide-state.js';
import { availableStoryRecords, storyContextGroups } from '../../story-state/records.js';
import { nameKey, protagonistIdentity } from '../../story-state/protagonist-identity.js';
import { formatRelativeStoryRange, latestStoryTime } from '../../story-state/time-rel.js';
import { isPrivateStoryField } from '../../world-records/authority.js';
import { authorityMemoryStoryStore, worldAuthorityForContext } from '../../world-records/authority-context.js';
import { createRecallDiagnostics } from '../recall-diagnostics.js';

const CONSTRAINT_MAX = 2000;

function estimateTokens(text) {
    if (!text) return 0;
    const s = String(text);
    const zh = (s.match(/[\u4e00-\u9fff]/g) || []).length;
    return Math.ceil(zh + (s.length - zh) / 4);
}

function pushWithBudget(lines, text, state) {
    const t = estimateTokens(text);
    if (!tryConsumeWholeItem(t, state)) return false;
    lines.push(text);
    return true;
}

function cleanSummary(summary) {
    return String(summary || "")
        .replace(/\s*\(#\d+(?:-\d+)?\)\s*$/, "")
        .trim();
}

function normalize(s) {
    return String(s || '')
        .normalize('NFKC')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .trim()
        .toLowerCase();
}

function getKnownCharacters(store) {
    const { name1, name2 } = getContext();
    const names = buildTrustedCharacters(store, { name1, name2 }) || new Set();
    if (name1) names.add(normalize(name1));
    return names;
}

function buildConstraintPeopleDict(recallResult, focusCharacters = []) {
    const dict = new Map();
    const add = (raw) => {
        const display = String(raw || '').trim();
        const key = normalize(display);
        if (!display || !key) return;
        if (!dict.has(key)) dict.set(key, display);
    };

    const selectedEvents = recallResult?.events || [];
    for (const item of selectedEvents) {
        const participants = item?.event?.participants || [];
        for (const p of participants) add(p);
    }

    if (dict.size === 0) {
        for (const f of (focusCharacters || [])) add(f);
    }

    return dict;
}

function groupConstraintsForDisplay(facts, peopleDict) {
    const people = new Map();
    const world = [];

    for (const f of (facts || [])) {
        const subjectNorm = normalize(f?.s);
        const displayName = peopleDict.get(subjectNorm);
        if (displayName) {
            if (!people.has(displayName)) people.set(displayName, []);
            people.get(displayName).push(f);
        } else {
            world.push(f);
        }
    }

    return { people, world };
}

function formatConstraintLine(f, includeSubject = false) {
    const subject = String(f?.s || '').trim();
    const predicate = String(f?.p || '').trim();
    const object = String(f?.o || '').trim();
    const trendRaw = String(f?.trend || '').trim();
    const hasSince = f?.since !== undefined && f?.since !== null;
    const since = hasSince ? ` (#${f.since + 1})` : '';
    const trend = isRelationFact(f) && trendRaw ? ` [${trendRaw}]` : '';
    if (includeSubject) {
        return `- ${subject} ${predicate}: ${object}${trend}${since}`;
    }
    return `- ${predicate}: ${object}${trend}${since}`;
}

function formatConstraintsStructured(grouped, order = 'desc') {
    const lines = [];
    const people = grouped?.people || new Map();
    const world = grouped?.world || [];
    const sorter = order === 'asc'
        ? ((a, b) => (a.since || 0) - (b.since || 0))
        : ((a, b) => (b.since || 0) - (a.since || 0));

    if (people.size > 0) {
        lines.push('people:');
        for (const [name, facts] of people.entries()) {
            lines.push(`  ${name}:`);
            const sorted = [...facts].sort(sorter);
            for (const f of sorted) {
                lines.push(`    ${formatConstraintLine(f, false)}`);
            }
        }
    }

    if (world.length > 0) {
        lines.push('world:');
        const sortedWorld = [...world].sort(sorter);
        for (const f of sortedWorld) {
            lines.push(`  ${formatConstraintLine(f, true)}`);
        }
    }

    return lines;
}

function tryConsumeConstraintLineBudget(line, budgetState) {
    const cost = estimateTokens(line);
    return tryConsumeWholeItem(cost, budgetState);
}

function selectConstraintsByBudgetDesc(facts, peopleDict, budget, playerNames) {
    const people = new Map(), world = [];
    const priority = fact => {
        const heroSubject = playerNames.has(nameKey(fact.s));
        if (heroSubject && /拥有|持有|保管|携带|约束|约定|欠|承诺|限制|物品|资产|身体状况/.test(fact.p)) return 0;
        if (playerNames.has(nameKey(fact.o)) && /owner|持有|保管|所有人|使用人|归属/.test(fact.p)) return 0;
        return heroSubject ? 1 : 2;
    };
    for (const fact of [...facts].sort((a, b) => priority(a) - priority(b) || (b.since || 0) - (a.since || 0))) {
        const person = peopleDict.get(normalize(fact.s));
        const label = person ? (people.size ? '' : 'people:\n') + (people.has(person) ? '' : `  ${person}:\n`) : (world.length ? '' : 'world:\n');
        const line = (person ? '    ' : '  ') + formatConstraintLine(fact, !person);
        if (!tryConsumeConstraintLineBudget(label + line, budget)) continue;
        if (person) {
            if (!people.has(person)) people.set(person, []);
            people.get(person).push(fact);
        } else world.push(fact);
    }
    return { people, world };
}

function buildNonVectorPrompt(store, { includeState = true } = {}) {
    const data = store.json || {};
    const sections = [];

    if (includeState) {
        const allFacts = getFacts().filter(fact => !fact.retracted && !isPrivateStoryField(fact.p));
        const nonVectorPeopleDict = buildConstraintPeopleDict(
            { events: data.events || [] },
            []
        );
        const nonVectorFocus = nonVectorPeopleDict.size > 0
            ? [...nonVectorPeopleDict.values()]
            : [...getKnownCharacters(store)];
        const nonVectorKnownCharacters = getKnownCharacters(store);
        const filteredConstraints = filterConstraintsByRelevance(
            allFacts,
            nonVectorFocus,
            nonVectorKnownCharacters,
            getContext().name1,
        );
        const groupedConstraints = groupConstraintsForDisplay(filteredConstraints, nonVectorPeopleDict);
        const constraintLines = formatConstraintsStructured(groupedConstraints, 'asc');

        if (constraintLines.length) {
            sections.push(`[定了的事] 已确立的事实\n${constraintLines.join("\n")}`);
        }
    }

    if (data.events?.length) {
        const lines = data.events.map((ev, i) => {
            const time = ev.timeLabel || "";
            const title = ev.title || "";
            const people = (ev.participants || []).join(" / ");
            const summary = cleanSummary(ev.summary);
            const header = time ? `${i + 1}.【${time}】${title || people}` : `${i + 1}. ${title || people}`;
            return `${header}\n  ${summary}`;
        });
        sections.push(`[剧情记忆]\n\n${lines.join("\n\n")}`);
    }

    if (!sections.length) return "";
    return sections.join("\n\n");
}

/**
 * 构建非向量模式注入文本（公开接口）
 * @param {object} [options] - 构建选项
 * @returns {string} 注入文本
 */
export function buildNonVectorPromptText(options = {}) {
    if (!getSettings().storySummary?.enabled) {
        return "";
    }

    const store = getSummaryStore();
    if (!store?.json) {
        return "";
    }

    return buildNonVectorPrompt(store, options);
}

/**
 * 构建向量模式注入文本。这里只计算，不发布 UI 日志、警告或 extension prompt。
 * 所有可观察副作用都由 generate interceptor 在认领本轮结果后提交。
 * @param {boolean} excludeLastAi - 是否排除最后的 AI 消息
 * @param {object} options - 计算选项
 * @returns {Promise<{text: string, diagnostics: object, notice: object|null}>}
 */
export async function buildVectorPromptText(excludeLastAi = false, options = {}) {
    const { signal = null, diagnostics = createRecallDiagnostics(getContext()?.chatId), captureEvidenceTrace = false, withQueryEmbedding, includeState = true } = options;
    let recallResult = null, meta = null, assembly = null;
    const finish = (text, reason = '') => {
        diagnostics.reason = reason;
        diagnostics.finishedAt ??= performance.now();
        const recallTrace = recallResult ? {
            mode: recallResult.mode || (assembly ? 'hybrid' : 'none'),
            reranked: Boolean(recallResult.reranked),
            rerankStatus: recallResult.rerankStatus || (recallResult.reranked ? 'applied' : 'disabled'),
            queryPreview: recallResult.queryPreview || '',
            focusCharacters: recallResult.focusCharacters || [],
            hiddenThrough: meta?.hiddenThrough ?? -1,
            backgroundItems: assembly?.backgroundItems ?? 0,
            includedBackgroundItems: assembly?.includedBackgroundItems ?? 0,
            rawBudgetUsed: assembly?.rawBudgetUsed ?? 0,
            rawBudgetMax: assembly?.rawBudgetMax ?? 3000,
            chunks: assembly?.traceChunks || [],
        } : null;
        return { text, notice: null, diagnostics, recallTrace,
            ...(captureEvidenceTrace ? { observation: { recallResult, meta, assembly } } : {}) };
    };
    if (!getSettings().storySummary?.enabled) return finish('', '剧情总结未启用');
    const store = getSummaryStore();
    if (!store?.json) return finish('', '没有已保存的总结');
    const vectorCfg = getVectorConfig();
    if (!vectorCfg?.enabled) return finish('', '原文检索未启用');
    const { chatId, chat = [] } = getContext();
    const cfg = getSummaryPanelConfig();
    meta = chatId && (cfg.ui.useVectorBoundary || cfg.ui.recallEarlyOriginal !== false) ? await getMeta(chatId) : null;
    let hiddenThrough = getHiddenThrough({
        enabled: cfg.ui.hideSummarized, summaryBoundary: floorCoverageEnd(store),
        vectorBoundary: meta?.lastChunkFloor ?? -1,
        useVectorBoundary: !store.summaryHistory?.some(batch => batch.floorEntry) && cfg.ui.useVectorBoundary,
        keepVisibleTurns: cfg.ui.keepVisibleCount, chat, stableEnd: getSummarySourceEnd(chat, chat.length - 1), length: chat.length,
    });
    if (excludeLastAi && !chat.at(-1)?.is_user) hiddenThrough = Math.min(hiddenThrough, chat.length - 2);
    try {
        recallResult = await recallRawMemory(vectorCfg, { focusOnly: cfg.ui.recallEarlyOriginal === false, hiddenThrough, excludeLastAi, signal, diagnostics, withQueryEmbedding });
        if (signal?.aborted) return finish('', '召回已取消');
        diagnostics.stage = 'prompt-assembly';
        assembly = buildRawPrompt(store, recallResult, hiddenThrough, { includeState });
        meta = { ...(meta || {}), hiddenThrough };
        const text = assembly.promptText;
        diagnostics.stage = 'prompt-ready';
        return finish(text, text ? '' : '没有需要补入的早期记忆');
    } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') return finish('', '召回已取消');
        throw error;
    }
}

export function buildRawPrompt(store, recallResult, hiddenThrough, { includeState = true } = {}) {
    const context = getContext();
    const { chat = [], name1 = '' } = context;
    const player = protagonistIdentity(worldAuthorityForContext(context)?.entities || [], name1);
    const focus = [...new Set([name1, ...player.names, ...(recallResult.focusCharacters || [])].filter(Boolean))];
    const facts = filterConstraintsByRelevance(getFacts().filter(fact => !fact.retracted && !isPrivateStoryField(fact.p)), focus, getKnownCharacters(store), name1);
    const dict = buildConstraintPeopleDict(null, focus);
    const constraints = { used: 0, max: CONSTRAINT_MAX };
    const stateLines = [];
    const availableRecords = availableStoryRecords(authorityMemoryStoryStore(store, context));
    if (includeState) {
        const storyBudget = { used: 0, max: 800 };
        const { priority, other } = storyContextGroups(availableRecords, focus, { protagonistNames: player.names });
        for (const line of [...priority, ...other]) {
            const cost = estimateTokens(line);
            if (cost + storyBudget.used > storyBudget.max) continue;
            storyBudget.used += cost;
            stateLines.push(line);
        }
        constraints.used = storyBudget.used;
        stateLines.push(...formatConstraintsStructured(selectConstraintsByBudgetDesc(facts, dict, constraints, player.names), 'asc'));
    }
    const background = [], raw = [];
    const plotBudget = { used: 0, max: 4000 }, rawBudget = { used: 0, max: 3000 };
    const items = plotBackgroundItems(store, chat, hiddenThrough);
    const nowTime = latestStoryTime(store, chat, availableRecords);
    // Allocate plotBudget newest-to-oldest so recent history is kept first, then emit chronologically.
    const packed = [];
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        const relRange = nowTime
            ? formatRelativeStoryRange({ timeStart: item.timeStart, timeEnd: item.timeEnd, timeLabel: item.storyTime, isCompressed: (item.depth ?? 0) > 0 }, nowTime)
            : '';
        const floorPrefix = `#${item.start + 1}-${item.end + 1}`;
        const header = relRange ? `[${floorPrefix} · ${relRange}]` : `[${floorPrefix}]`;
        const baseLine = `${header} ${item.text}`;
        if (!pushWithBudget([], baseLine, plotBudget)) break;
        packed.push({ index: i, line: baseLine });
    }
    packed.sort((a, b) => a.index - b.index);
    background.push(...packed.map(entry => entry.line));
    const seen = new Set();
    const included = [];
    const traceChunks = [];
    for (const chunk of recallResult.chunks || []) {
        if (seen.has(chunk.chunkId)) continue;
        seen.add(chunk.chunkId);
        if (chunk.floor > hiddenThrough) {
            if (traceChunks.length < 20) traceChunks.push({ ...chunk, included: false, filterReason: 'above_boundary' });
            continue;
        }
        if (pushWithBudget(raw, `[#${chunk.floor + 1} · ${chunk.speaker}] ${chunk.text}`, rawBudget)) {
            included.push(chunk);
            if (traceChunks.length < 20) traceChunks.push({ ...chunk, included: true, filterReason: '' });
        } else if (traceChunks.length < 20) {
            traceChunks.push({ ...chunk, included: false, filterReason: 'budget_exceeded' });
        }
    }
    const sections = [];
    if (stateLines.length) sections.push(`[当前相关状态]\n${stateLines.join('\n')}`);
    if (background.length) sections.push(`[早期剧情摘要]\n${background.join('\n')}`);
    if (raw.length) sections.push(`[本轮相关的早期原文]\n${raw.join('\n')}`);
    const briefingNote = '[以下为只读剧情背景简报，仅供写作参考；请自然衔接最新剧情，勿在正文中复述或仿写摘要条目格式]';
    return {
        promptText: sections.length ? `<剧情记忆>\n${briefingNote}\n\n${sections.join('\n\n')}\n</剧情记忆>` : '',
        rawChunks: included,
        traceChunks,
        rawBudgetUsed: rawBudget.used,
        rawBudgetMax: rawBudget.max,
        backgroundItems: items.length,
        includedBackgroundItems: background.length,
        tokens: constraints.used + plotBudget.used + rawBudget.used,
    };
}
