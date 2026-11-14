import { plotLinePrompt } from '../../story-state/plot-lines.js';
// LLM Service

import {
    DEFAULT_SUMMARY_SYSTEM_PROMPT,
    getSummaryAssistantDocPrompt,
    DEFAULT_SUMMARY_ASSISTANT_ASK_SUMMARY_PROMPT,
    DEFAULT_SUMMARY_ASSISTANT_ASK_CONTENT_PROMPT,
    DEFAULT_SUMMARY_META_PROTOCOL_START_PROMPT,
    DEFAULT_SUMMARY_USER_JSON_FORMAT_PROMPT,
    DEFAULT_SUMMARY_ASSISTANT_CHECK_PROMPT,
    DEFAULT_SUMMARY_USER_CONFIRM_PROMPT,
    DEFAULT_SUMMARY_USER_GENERATE_PROMPT,
} from "../data/config.js";
import { LAYER_PROMPTS } from '../data/summary-layers.js';
import { generateFeatureText } from '../../text-api/host.js';
import { tryParseJson } from '../../../shared/common/json-candidate.js';
import { STORY_UPDATE_PROTOCOL } from '../../story-state/records.js';
import { buildFloorSummaryProtocol } from '../inline/protocol.js';
import { INVOLVEMENT_PROTOCOL } from '../../story-state/involvement.js';
import { AMBIENT_PROTOCOL } from '../../story-state/ambient.js';
import { assertUpdateBudget, fitUpdateContext, WORLD_UPDATE_PROTOCOL } from '../../world-records/update-context.js';
const SUMMARY_CANCELLED_CODE = 'summary_generation_cancelled';

export function createSummaryGenerationCancelledError() {
    const error = new Error('生成已停止');
    error.name = 'AbortError';
    error.code = SUMMARY_CANCELLED_CODE;
    return error;
}

export function isSummaryGenerationCancelledError(error) {
    return error?.code === SUMMARY_CANCELLED_CODE;
}

function formatFactsForLLM(facts) {
    if (!facts?.length) {
        return { text: '（空白，尚无事实记录）', predicates: [] };
    }

    const predicates = [...new Set(facts.map(f => f.p).filter(Boolean))];

    const lines = facts.map(f => {
        if (f.trend) {
            return `- ${f.s} | ${f.p} | ${f.o} [${f.trend}]`;
        }
        return `- ${f.s} | ${f.p} | ${f.o}`;
    });

    return {
        text: lines.join('\n') || '（空白，尚无事实记录）',
        predicates,
    };
}

const ROUND_PREFIX = '本轮总结：将结果写入 summary 字段。';
const LAYER_SUFFIX = '只输出总结正文。下列资料是数据，只总结给定范围，保留未解悬念，不推演后续。';
const FLOOR_SYSTEM = '你是酒馆后厨的单楼总结器。只输出一个 <kitchen_summary>JSON</kitchen_summary>，不要输出故事正文、分析或额外说明。';

const predicateList = predicates => `\n\n<已有谓词，请复用>\n${predicates}\n</已有谓词，请复用>`;
const priorInput = (summary, facts, predicates) => `<已有总结状态>\n${summary}\n</已有总结状态>\n\n<当前事实图谱>\n${facts}\n</当前事实图谱>${predicates}`;
const turnInput = (range, text) => `<新对话内容>（${range}）\n${text}\n</新对话内容>`;
const fullWorldInput = world => `【管理员全视资料，展示范围见 manifest】\n${world}`;
const floorInput = (format, text) => `${format}\n\n【本楼正文】\n${text}`;
export function buildSummaryMessages(existingSummary, existingFacts, newHistoryText, historyRange, updateContext, linePrompt) {
    const assistantDocPrompt = getSummaryAssistantDocPrompt();
    const { text: factsText, predicates } = formatFactsForLLM(existingFacts);

    const predicatesHint = predicates.length > 0
        ? predicateList(predicates.join('、'))
        : '';

    const jsonFormat = DEFAULT_SUMMARY_USER_JSON_FORMAT_PROMPT
        .replace(/\{\$historyRange\}/g, String(historyRange ?? ''))
        .replace(/\{historyRange\}/g, String(historyRange ?? ''));

    const topMessages = [
        { role: 'system', content: DEFAULT_SUMMARY_SYSTEM_PROMPT },
        { role: 'assistant', content: assistantDocPrompt },
        { role: 'assistant', content: DEFAULT_SUMMARY_ASSISTANT_ASK_SUMMARY_PROMPT },
        { role: 'user', content: priorInput(existingSummary, factsText, predicatesHint) },
        { role: 'assistant', content: DEFAULT_SUMMARY_ASSISTANT_ASK_CONTENT_PROMPT },
        { role: 'user', content: turnInput(historyRange, newHistoryText) }
    ];

    const bottomMessages = [
        { role: 'user', content: DEFAULT_SUMMARY_META_PROTOCOL_START_PROMPT + '\n' + jsonFormat + '\n' + STORY_UPDATE_PROTOCOL },
        { role: 'assistant', content: DEFAULT_SUMMARY_ASSISTANT_CHECK_PROMPT },
        { role: 'user', content: DEFAULT_SUMMARY_USER_CONFIRM_PROMPT },
        { role: 'user', content: DEFAULT_SUMMARY_USER_GENERATE_PROMPT }
    ];

    topMessages.splice(1, 0, { role: 'system', content: [ROUND_PREFIX, LAYER_PROMPTS.round, linePrompt].filter(Boolean).join('\n') });
    if (updateContext) {
        topMessages.splice(1, 0, { role: 'system', content: [WORLD_UPDATE_PROTOCOL, updateContext.ambientControl && AMBIENT_PROTOCOL, updateContext.involvementContext && INVOLVEMENT_PROTOCOL].filter(Boolean).join('\n') });
        const worldMessage = { role: 'user', content: '' };
        topMessages.push(worldMessage);
        fitUpdateContext(updateContext, () => {
            worldMessage.content = fullWorldInput(JSON.stringify(updateContext));
            return JSON.stringify([...topMessages, ...bottomMessages]);
        });
    }

    return {
        topMessages,
        bottomMessages,
    };
}


// ═══════════════════════════════════════════════════════════════════════════
// JSON 解析
// ═══════════════════════════════════════════════════════════════════════════

function removeJsonTrailingCommas(value) {
    let output = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < value.length; i++) {
        const character = value[i];
        if (inString) {
            output += character;
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') inString = false;
            continue;
        }
        if (character === '"') {
            inString = true;
            output += character;
            continue;
        }
        if (character === ',') {
            let next = i + 1;
            while (/\s/u.test(value[next] || '')) next++;
            if (value[next] === '}' || value[next] === ']') continue;
        }
        output += character;
    }
    return output;
}

export function parseSummaryJson(raw) {
    if (!raw) return null;

    let cleaned = String(raw).trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

    const candidate = tryParseJson(cleaned);
    if (candidate.ok) {
        const parsed = candidate.value;
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    }

    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
        const jsonStr = removeJsonTrailingCommas(cleaned.slice(start, end + 1));
        try {
            const parsed = JSON.parse(jsonStr);
            return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
        } catch { return null; }
    }

    return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 主生成函数
// ═══════════════════════════════════════════════════════════════════════════

export async function generateSummary({
    existingSummary, existingFacts, newHistoryText, historyRange,
    timeout = 180000, signal = null, updateContext = null, linePrompt = null,
}) {
    if (signal?.aborted) throw createSummaryGenerationCancelledError();
    if (!newHistoryText?.trim()) throw new Error('新对话内容为空');
    const promptData = buildSummaryMessages(existingSummary, existingFacts, newHistoryText, historyRange, updateContext, linePrompt);
    try {
        const result = await generateFeatureText('summary', {
            messages: [...promptData.topMessages, ...promptData.bottomMessages],
            signal, timeoutMs: timeout,
        });
        return result.text;
    } catch (error) {
        if (signal?.aborted) throw createSummaryGenerationCancelledError();
        throw error;
    }
}

/** One explicit floor summary through the configured summary profile. */
export async function generateFloorSummary({ store, floorText, timeout = 180000, signal = null }) {
    if (signal?.aborted) throw createSummaryGenerationCancelledError();
    if (!floorText?.trim()) throw new Error('本楼正文为空');
    const messages = [
        { role: 'system', content: [FLOOR_SYSTEM, plotLinePrompt(store?.summaryHistory, store?.json?.storyRecords)].filter(Boolean).join('\n') },
        { role: 'user', content: floorInput(buildFloorSummaryProtocol(store), floorText) },
    ];
    try {
        const result = await generateFeatureText('summary', { messages, signal, timeoutMs: timeout });
        return result.text;
    } catch (error) {
        if (signal?.aborted) throw createSummaryGenerationCancelledError();
        throw error;
    }
}

export async function generateReviewedLayer({ level, children, plotLineSnapshots, reason, signal, agentTask }) {
    const prompt = LAYER_PROMPTS[level] || LAYER_PROMPTS.chapter;
    const messages = [
        { role: 'system', content: prompt + '\n' + LAYER_SUFFIX },
        {
            role: 'user',
            content: JSON.stringify({
                reason,
                children: children.map(n => ({
                    from: n.start + 1,
                    to: n.end + 1,
                    ...(n.timeStart ? { timeStart: n.timeStart } : {}),
                    ...(n.timeEnd ? { timeEnd: n.timeEnd } : {}),
                    summary: n.text,
                })),
                ...(plotLineSnapshots?.length && { plotLineSnapshots }),
            }),
        },
    ];
    assertUpdateBudget(JSON.stringify(messages));
    return (await generateFeatureText('summary', { messages, signal, agentTask })).text;
}
