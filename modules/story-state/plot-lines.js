import { definePanelPrompt, panelEnabled } from '../../core/panel-policy.js';
import { reviewedRounds } from '../story-summary/data/summary-layers.js';

const instructions = definePanelPrompt('clues', 'plotLines', '剧情线提取', `只从本轮新材料提取有进展、有新联系或已收束的剧情线，形成可供下游编剧直接规划的剧情线总结。另在返回 JSON 的顶层写 plotLines 数组，无则留空。每项含 title、status、reading、quote，并可附 summary、characters、nextFocus。title 用稳定短名，同一条线沿用旧名。status 取 active（已有行动或明确冲突）、potential（有迹象但联系还未证实）或 closed（已有收束依据）。reading 写清本轮各方正在做什么，或哪两件事可能有关；猜测必须明说尚未证实。quote 必须逐字摘自本轮 summary，以其中已发生的事实作为依据。summary 写该剧情线截至目前的累计总结（整合起因、关键推进与当前格局，供下游编剧分析）。characters 为当前直接涉及的人物短名数组。nextFocus 简写当前待解焦点或变化条件（closed 可留空）。不要预测结局、给玩家派任务或把可能性写进事实总结。最多八条。已有剧情线（沿用标题，参考上次总结）：{{titles}}`);

const cleanList = (value, maxItems, maxChars) => Array.isArray(value)
    ? [...new Set(value.map(item => typeof item === 'string' ? item.trim() : '').filter(item => item && item.length <= maxChars))].slice(0, maxItems)
    : [];

/** Builds a concise cumulative summary across chronological beats without inventing unseen facts. */
function buildLineSummary(beats, explicitSummary, status, reading) {
    if (explicitSummary && (beats.length <= 1 || explicitSummary !== reading)) return explicitSummary;
    const steps = [];
    for (const beat of beats) {
        const text = String(beat.reading || '').trim();
        if (!text || steps.at(-1)?.text === text) continue;
        steps.push({ status: beat.status, text });
    }
    if (steps.length <= 1) return steps[0]?.text || reading;
    const head = steps[0].text;
    const tail = steps.at(-1).text;
    const tailLabel = status === 'closed' ? '收束' : '当前';
    const middle = steps.slice(1, -1).map(step => step.text);
    const join = kept => [`起初：${head}`, ...(kept.length ? [`推进：${kept.join('；')}`] : []), `${tailLabel}：${tail}`].join('；');
    while (middle.length && join(middle).length > 800) middle.shift();
    const compact = join(middle);
    return compact.length <= 800 ? compact : `起初：${head.slice(0, 260)}；${tailLabel}：${tail.slice(0, 500)}`;
}

/** Formats prompt context for subsequent extraction rounds using cumulative plot-line summaries. */
export function plotLinePrompt(history, records) {
    if (!panelEnabled('clues')) return '';
    const titles = collectPlotLines(history, records).slice(0, 40).map(({ title, status, summary, reading, characters }) => ({
        title,
        status,
        summary: (summary || reading).slice(0, 220),
        ...(characters?.length && { characters }),
    }));
    return instructions({ titles: JSON.stringify(titles) });
}

/** Validates extracted per-round plot-line entries against the verbatim round summary. */
export function readPlotLines(rows, summary) {
    if (!Array.isArray(rows) || typeof summary !== 'string') return [];
    return rows.slice(0, 8).filter(row => row && ['active', 'potential', 'closed'].includes(row.status)
        && [row.title, row.reading, row.quote].every(value => typeof value === 'string' && value.trim())
        && row.title.length <= 100 && row.reading.length <= 800 && row.quote.length <= 500 && summary.includes(row.quote))
        .map(row => {
            const summaryText = typeof row.summary === 'string' && row.summary.trim() && row.summary.trim().length <= 1000 ? row.summary.trim() : '';
            const nextFocus = typeof row.nextFocus === 'string' && row.nextFocus.trim() && row.nextFocus.trim().length <= 240 ? row.nextFocus.trim() : '';
            const characters = cleanList(row.characters, 12, 60);
            const situationIds = cleanList(row.situationIds, 8, 120);
            return {
                title: row.title.trim(),
                status: row.status,
                reading: row.reading.trim(),
                quote: row.quote,
                ...(summaryText && { summary: summaryText }),
                ...(characters.length && { characters }),
                ...(nextFocus && { nextFocus }),
                ...(situationIds.length && { situationIds }),
            };
        });
}

/** Collects and consolidates plot lines across records and reviewed rounds into downstream-ready summaries. */
export function collectPlotLines(history = [], records = []) {
    const lines = new Map();
    const knownNames = new Set();
    const situationByTitle = new Map();
    for (const record of records) {
        if (record.kind === 'person' && record.name) knownNames.add(record.name);
        if (record.kind === 'knowledge' && record.person) knownNames.add(record.person);
        for (const name of [...(record.holders || []), ...(record.parties || [])]) if (name) knownNames.add(name);
        if (record.kind === 'situation' && record.id && record.title) situationByTitle.set(record.title, record.id);
    }

    const ensure = title => {
        if (!lines.has(title)) {
            lines.set(title, {
                title,
                status: 'potential',
                reading: '',
                quote: '',
                floor: undefined,
                firstFloor: undefined,
                recordId: undefined,
                recordFloor: undefined,
                explicitSummary: '',
                nextFocus: '',
                characters: new Set(),
                situationIds: new Set(),
                beats: [],
            });
        }
        return lines.get(title);
    };

    // Existing chats already record concrete projects, unresolved questions and ongoing conflicts.
    for (const record of records) {
        if (!['plan', 'suspense', 'situation'].includes(record.kind) || record.flavor === 'scenery' || !record.title || !record.description) continue;
        const status = record.status !== 'open' ? 'closed' : record.kind === 'suspense' ? 'potential' : 'active';
        const reading = record.reason || record.description;
        const entry = ensure(record.title);
        entry.status = status;
        entry.reading = reading;
        entry.quote = record.description;
        entry.floor = record._addedAt;
        entry.recordFloor = record._addedAt;
        entry.recordId = record.id;
        entry.nextFocus = status === 'closed' ? '' : String(record.releaseCondition || record.conditions || record.statusNote || '').trim();
        for (const name of [...(record.holders || []), ...(record.parties || [])]) if (name) entry.characters.add(name);
        if (record.kind === 'situation' && record.id) entry.situationIds.add(record.id);
        entry.beats.push({ floor: record._addedAt ?? null, storyTime: '', status, reading, quote: record.description, source: 'record' });
    }

    for (const round of reviewedRounds(history)) {
        const storyTime = String(round.timeEnd || round.timeStart || round.storyTime || '').trim();
        for (const name of round.memoryTags?.characters || []) if (name) knownNames.add(name);
        for (const row of readPlotLines(round.plotLines, round.summary)) {
            const entry = ensure(row.title);
            entry.beats.push({
                floor: round.endMesId ?? null,
                storyTime,
                status: row.status,
                reading: row.reading,
                quote: row.quote,
                ...(row.summary && { summary: row.summary }),
            });
            for (const name of row.characters || []) entry.characters.add(name);
            for (const id of row.situationIds || []) entry.situationIds.add(id);
            const matchedSit = situationByTitle.get(row.title);
            if (matchedSit) entry.situationIds.add(matchedSit);
            // A later resolution in the structured records supersedes an older round.
            if (entry.recordFloor > round.endMesId) continue;
            entry.status = row.status;
            entry.reading = row.reading;
            entry.quote = row.quote;
            entry.floor = round.endMesId;
            if (row.summary) entry.explicitSummary = row.summary;
            if (row.status === 'closed') entry.nextFocus = '';
            else if (row.nextFocus) entry.nextFocus = row.nextFocus;
        }
    }

    return [...lines.values()].map(entry => {
        const beats = [...entry.beats].sort((a, b) => (a.floor ?? -1) - (b.floor ?? -1));
        const floors = beats.map(beat => beat.floor).filter(Number.isInteger);
        const firstFloor = floors.length ? Math.min(...floors) : undefined;
        const summary = buildLineSummary(beats, entry.explicitSummary, entry.status, entry.reading);
        const textBlob = `${entry.title}\n${summary}\n${entry.reading}`;
        for (const name of knownNames) if (name && textBlob.includes(name)) entry.characters.add(name);
        return {
            title: entry.title,
            status: entry.status,
            reading: entry.reading,
            quote: entry.quote,
            summary,
            beats,
            roundCount: beats.length,
            ...(firstFloor !== undefined && { firstFloor }),
            ...(entry.floor !== undefined && { floor: entry.floor }),
            ...(entry.recordId && { recordId: entry.recordId }),
            ...(entry.characters.size && { characters: [...entry.characters].slice(0, 12) }),
            ...(entry.situationIds.size && { situationIds: [...entry.situationIds].slice(0, 8) }),
            ...(entry.nextFocus && { nextFocus: entry.nextFocus }),
        };
    }).sort((a, b) => (b.floor ?? -1) - (a.floor ?? -1));
}

export const summarizePlotLines = collectPlotLines;

/** Stable digest key covering plot-line state, cumulative summary, and focus changes for planner invalidation. */
export function plotLineStateDigest(plotLines = []) {
    return plotLines.map(line => [
        line.title,
        line.status,
        line.summary || line.reading || '',
        line.floor ?? -1,
        line.nextFocus || '',
        ...(line.characters || []),
    ]).sort((a, b) => a[0].localeCompare(b[0]));
}
