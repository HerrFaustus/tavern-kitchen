import { memoryDigest } from '../story-summary/data/memory-policy.js';
import { isRangeSourceCurrent } from '../story-summary/data/turn-source.js';
import { panelEnabled } from '../../core/panel-policy.js';
import { reviewedRounds, roundSourceId, selectViewNodes, summaryLayers } from '../story-summary/data/summary-layers.js';

const instructions = titles => `只从本轮新材料提取有进展、有新联系或已收束的剧情线，形成可供下游编剧直接规划的剧情线总结。另在返回 JSON 的顶层写 plotLines 数组，无则留空。每项含 title、status、reading、quote，并可附 summary、characters、nextFocus。title 用稳定短名，同一条线沿用旧名。status 取 active（已有行动或明确冲突）、potential（有迹象但联系还未证实）或 closed（已有收束依据）。reading 写清本轮各方正在做什么，或哪两件事可能有关；猜测必须明说尚未证实。quote 必须逐字摘自本轮 summary，以其中已发生的事实作为依据。summary 写该剧情线截至目前的累计总结（整合起因、关键推进与当前格局，供下游编剧分析）。characters 为当前直接涉及的人物短名数组。nextFocus 简写当前待解焦点或变化条件（closed 可留空）。不要预测结局、给玩家派任务或把可能性写进事实总结。最多八条。已有剧情线（沿用标题，参考上次总结）：${titles}`;

const cleanList = (value, maxItems, maxChars) => Array.isArray(value)
    ? [...new Set(value.map(item => typeof item === 'string' ? item.trim() : '').filter(item => item && item.length <= maxChars))].slice(0, maxItems)
    : [];

function unpackSnapshotSteps(text) {
    const clean = String(text || '').trim();
    if (!clean) return [];
    const match = clean.match(/^起初：([\s\S]+?)；(?:推进：([\s\S]+?)；)?(?:当前|收束)：([\s\S]+)$/);
    if (!match) return [clean];
    return [match[1], ...(match[2] ? match[2].split('；') : []), match[3]].map(item => item.trim()).filter(Boolean);
}

/** Builds a concise cumulative summary across chronological beats without inventing unseen facts. */
function buildLineSummary(beats, explicitSummary, status, reading) {
    if (explicitSummary && (beats.length <= 1 || explicitSummary !== reading)) return explicitSummary;
    if (beats.length === 1 && beats[0]?.compressed) return String(beats[0].reading || reading || '').trim();
    const steps = [];
    const pushStep = text => {
        if (!text || steps.at(-1)?.text === text) return;
        steps.push({ status, text });
    };
    for (const beat of beats) {
        if (beat.compressed) {
            for (const step of unpackSnapshotSteps(beat.reading)) pushStep(step);
        } else {
            pushStep(String(beat.reading || '').trim());
        }
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
    return instructions(JSON.stringify(titles));
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

export function readSourcePlotLines(rows, source, known) {
    if (!Array.isArray(rows) || rows.length > 8) throw new Error('剧情线清单无效');
    const lines = rows.map(row => {
        const message = source.messages.find(m => m.floor === row.floor);
        const parsed = readPlotLines([row], message?.text)[0];
        if (!parsed) throw new Error('剧情线转折须引用本轮原文');
        const matches = known.filter(line => row.id ? line.id === row.id : line.title === row.title);
        if (matches.length > 1) throw new Error('剧情线身份不明确，请核对');
        const prior = matches[0];
        const question = String(row.question || prior?.question || row.title).trim().slice(0, 300);
        const id = prior?.id || 'line:' + memoryDigest([source.digest, question]).slice(0, 24);
        return { ...parsed, id, question, relatedIds: cleanList(row.relatedIds, 12, 80), evidence: { floor: row.floor, candidate: message.candidate, quote: row.quote } };
    });
    const ids = new Set([...known, ...lines].map(line => line.id));
    if (lines.some(line => line.relatedIds.some(id => !ids.has(id) || id === line.id))) throw new Error('关联剧情线编号无效');
    return lines;
}

function partyNames(record) {
    return [...(record.holders || []), ...(Array.isArray(record.parties) ? record.parties : String(record.parties || '').split(/[、，,]/u).filter(Boolean))];
}

function collectCoveredLeafIds(selectedNodes, byId) {
    const covered = new Set();
    const visit = node => {
        if (!node) return;
        if (node.kind === 'leaf' || node.atomic) {
            if (node.id) covered.add(node.id);
            return;
        }
        for (const cid of node.childIds || []) visit(byId.get(cid));
    };
    for (const node of selectedNodes) {
        if (node?.kind === 'comp') visit(node);
    }
    return covered;
}

function applyTimelineUpdate(entry, item, { floor, firstFloor, storyTime, situationByTitle, compressed = false, beatCount = 1 }) {
    if (item.id) Object.assign(entry, { id: item.id, title: item.title, question: item.question, relatedIds: item.relatedIds || entry.relatedIds || [] });
    const readingText = compressed ? (item.summary || item.reading) : item.reading;
    entry.beats.push({
        floor: item.evidence?.floor ?? floor ?? null, ...(item.evidence && {evidence:item.evidence}), ...(item.evidenceKind && {evidenceKind:item.evidenceKind}),
        storyTime,
        status: item.status,
        reading: readingText,
        quote: item.quote || '',
        ...(item.summary && { summary: item.summary }),
        ...(compressed && { compressed: true, beatCount }),
        ...(compressed && Number.isInteger(firstFloor) && { firstFloor }),
    });
    for (const name of item.characters || []) entry.characters.add(name);
    for (const id of item.situationIds || []) entry.situationIds.add(id);
    const matchedSit = situationByTitle.get(item.title);
    if (matchedSit) entry.situationIds.add(matchedSit);
    // A later resolution in the structured records supersedes an older round.
    if (entry.recordFloor > floor) return;
    entry.status = item.status;
    entry.reading = item.reading;
    if (!compressed) entry.quote = item.quote;
    entry.floor = floor;
    if (!compressed && item.summary) entry.explicitSummary = item.summary;
    if (item.status === 'closed') entry.nextFocus = '';
    else if (item.nextFocus) entry.nextFocus = item.nextFocus;
}

/** Collects and consolidates plot lines across records, compressed snapshots, and uncovered rounds into downstream-ready summaries. */
export function collectPlotLines(history = [], records = [], options = {}) {
    const lines = new Map();
    const knownNames = new Set();
    const situationByTitle = new Map();
    for (const record of records) {
        if (record.kind === 'person' && record.name) knownNames.add(record.name);
        if (record.kind === 'knowledge' && record.person) knownNames.add(record.person);
        for (const name of partyNames(record)) if (name) knownNames.add(name);
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
        for (const name of partyNames(record)) if (name) entry.characters.add(name);
        if (record.kind === 'situation' && record.id) entry.situationIds.add(record.id);
        entry.beats.push({ floor: record._addedAt ?? null, storyTime: '', status, reading, quote: record.description, source: 'record' });
    }

    const resolvedLayers = options.layers || summaryLayers(history, [], { chat: options.chat ?? null, isLeafCurrent: options.isLeafCurrent ?? null });
    const selectedNodes = selectViewNodes(resolvedLayers);
    const coveredLeafIds = collectCoveredLeafIds(selectedNodes, resolvedLayers.byId);
    const timeline = [];
    for (const node of selectedNodes) {
        if (node?.kind === 'comp') timeline.push({ sortFloor: node.end ?? -1, sortStart: node.start ?? -1, kind: 'comp', node });
    }

    const rounds = options.rounds || reviewedRounds(history);
    for (const round of rounds.flatMap(row => [...(row.plotLineIncrements || []),row])) {
        for (const name of round.memoryTags?.characters || []) if (name) knownNames.add(name);
        const sid = roundSourceId(round);
        if (sid && coveredLeafIds.has(sid)) continue;
        if (sid && options.chat && !isRangeSourceCurrent(round.sourceReceipt?.source || round.roundSource, options.chat)) continue;
        timeline.push({ sortFloor: round.endMesId ?? -1, sortStart: round.endMesId ?? -1, kind: 'round', round });
    }
    timeline.sort((a, b) => a.sortFloor - b.sortFloor || a.sortStart - b.sortStart);

    for (const item of timeline) {
        if (item.kind === 'comp') {
            const { node } = item;
            const snaps = [...(node.plotLineSnapshots || [])].sort((a, b) => (a.floor ?? -1) - (b.floor ?? -1));
            for (const snap of snaps) {
                if (!snap?.title || !['active', 'potential', 'closed'].includes(snap.status)) continue;
                const reading = String(snap.reading || snap.summary || '').trim();
                if (!reading) continue;
                const snapFloor = Number.isInteger(snap.floor) ? snap.floor : node.end;
                const snapFirst = Number.isInteger(snap.firstFloor) ? snap.firstFloor : (Number.isInteger(snapFloor) ? snapFloor : node.start);
                const beatCount = Number.isInteger(snap.beatCount) && snap.beatCount > 0 ? snap.beatCount : 1;
                applyTimelineUpdate(ensure(snap.id || snap.title), { ...snap, reading }, {
                    floor: snapFloor,
                    firstFloor: snapFirst,
                    storyTime: node.storyTime || '',
                    situationByTitle,
                    compressed: true,
                    beatCount,
                });
            }
            continue;
        }
        const { round } = item;
        const storyTime = String(round.timeEnd || round.timeStart || round.storyTime || '').trim();
        const source = round.sourceReceipt?.source || round.roundSource;
        const rows = (round.plotLines || []).flatMap(row => {
            if (!row.evidence) return readPlotLines([row], round.summary).map(item => ({ ...item, evidenceKind: '摘要依据' }));
            const proof = source?.messages.find(m => m.floor === row.evidence.floor && m.candidate === row.evidence.candidate && m.text.includes(row.quote));
            return proof ? [row] : [];
        });
        for (const row of rows) {
            applyTimelineUpdate(ensure(row.id || row.title), row, {
                floor: round.endMesId,
                storyTime,
                situationByTitle,
            });
        }
    }

    return [...lines.values()].map(entry => {
        const beats = [...entry.beats].sort((a, b) => (a.floor ?? -1) - (b.floor ?? -1));
        const floors = beats.flatMap(beat => [beat.firstFloor, beat.floor]).filter(Number.isInteger);
        const firstFloor = floors.length ? Math.min(...floors) : undefined;
        const roundCount = beats.reduce((sum, beat) => sum + (Number.isInteger(beat.beatCount) && beat.beatCount > 0 ? beat.beatCount : 1), 0);
        const summary = buildLineSummary(beats, entry.explicitSummary, entry.status, entry.reading);
        const textBlob = `${entry.title}\n${summary}\n${entry.reading}`;
        for (const name of knownNames) if (name && textBlob.includes(name)) entry.characters.add(name);
        return {
            ...(entry.id && { id:entry.id, question:entry.question, relatedIds:entry.relatedIds }),
            title: entry.title,
            status: entry.status,
            reading: entry.reading,
            quote: entry.quote,
            summary,
            beats,
            roundCount,
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
