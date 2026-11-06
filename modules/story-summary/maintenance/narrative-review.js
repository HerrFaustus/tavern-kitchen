import { stripFloorProtocol } from '../inline/protocol.js';
import { layerSignature, summaryLayers } from '../data/summary-layers.js';
import { firstInvalidMemorySource } from '../data/turn-source.js';
import { requireMemory } from './errors.js';

function material(current, staged, cutoff, level) {
    const { store, chat } = current;
    requireMemory(!store.summaryInvalid && store.sourceInvalidFromFloor == null && firstInvalidMemorySource(store, chat) == null, 'conflict');
    const { leaves, parents } = summaryLayers(store.summaryHistory, staged);
    const closed = parents.filter(node => node.level === level);
    const children = level === 'stage' ? leaves : parents.filter(node => node.level === 'stage');
    let index = 0;
    const units = children.filter(node => {
        while (closed[index]?.end < node.start) index++;
        return node.end <= cutoff && (!closed[index] || node.start < closed[index].start || node.end > closed[index].end);
    });
    return { units, closed, revision: layerSignature(units) };
}

export function readNarrativeUnits(current, staged, cutoff, { level, offset = 0, limit = 4 }) {
    if (level === 'round') requireMemory(!current.store.summaryInvalid && current.store.sourceInvalidFromFloor == null
        && firstInvalidMemorySource(current.store, current.chat) == null, 'conflict');
    const { units, revision } = level === 'round'
        ? { units: summaryLayers(current.store.summaryHistory).leaves.filter(unit => unit.end <= cutoff) }
        : material(current, staged, cutoff, level);
    const page = units.slice(offset, offset + Math.max(1, Math.min(8, limit)));
    return { level, revision, total: units.length, next: offset + page.length < units.length ? offset + page.length : null,
        units: page.map(({ start, end, text, version, memoryTags }) => ({ from: start + 1, to: end + 1, summary: text, ...(level === 'round' && { version, memoryTags }) })) };
}

function selection(current, staged, cutoff, args) {
    const { units, revision, closed } = material(current, staged, cutoff, args.level);
    const prior = closed.find(n => n.start + 1 === args.from && n.end + 1 === args.to);
    if (prior) return { prior };
    requireMemory(revision === args.revision, 'invalid_arguments', '候选资料已改变，请重新读取', 'revision');
    const start = units.findIndex(n => n.start + 1 === args.from);
    const end = units.findIndex(n => n.end + 1 === args.to);
    const children = units.slice(start, end + 1);
    requireMemory(start >= 0 && (start === 0 || units[start - 1].end + 1 !== units[start].start)
        && children.length >= (args.level === 'chapter' ? 2 : 1)
        && children.every((n, i) => !i || children[i - 1].end + 1 === n.start),
        'invalid_arguments', '从首个未归并单元开始，只选已闭合的连续范围；一章至少包含两个阶段', 'to');
    const { floor, quote } = args.evidence;
    const message = current.chat[floor - 1];
    requireMemory(floor >= args.from && floor <= args.to && quote.trim() && quote.length <= 1000
        && !(message?.is_system && message.extra?.type) && stripFloorProtocol(message?.mes).includes(quote), 'invalid_arguments', '依据须逐字来自所选范围的正文', 'evidence');
    requireMemory(args.reason.trim() && args.reason.length <= 1000, 'invalid_arguments', '请说明闭合理由', 'reason');
    return { children };
}

export async function requestNarrativeClosure(args, current, staged, cutoff, generate, reread, signal) {
    const selected = selection(current, staged, cutoff, args);
    if (selected.prior) return { status: 'unchanged' };
    const { children } = selected;
    const text = await generate({ level: args.level, children, reason: args.reason, signal });
    requireMemory(!signal?.aborted, 'cancelled');
    requireMemory(typeof text === 'string' && text.trim() && text.length <= 12000, 'invalid_arguments', '总结返回空白或超出篇幅');
    const checked = selection(await reread(), staged, cutoff, args);
    requireMemory(!signal?.aborted, 'cancelled');
    if (checked.prior) return { status: 'unchanged' };
    const node = { version: 1, level: args.level, start: args.from - 1, end: args.to - 1, text: text.trim(),
        sourceId: layerSignature(children), reason: args.reason.trim(), evidence: { ...args.evidence } };
    return { status: 'staged', node };
}

export function validateStagedUnits(current, staged) {
    if (!staged?.length) return;
    const { parents } = summaryLayers(current.store.summaryHistory, staged);
    requireMemory(firstInvalidMemorySource(current.store, current.chat) == null
        && staged.every(node => parents.includes(node) && stripFloorProtocol(current.chat[node.evidence.floor - 1]?.mes).includes(node.evidence.quote)), 'conflict');
}
