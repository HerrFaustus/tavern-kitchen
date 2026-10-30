import { calcAtomQuality } from '../vector/llm/atom-quality.js';
import { memoryPolicy, memoryDigest } from '../data/memory-policy.js';
import { sameMemory } from '../maintenance/domain.js';

function text(value, label, max, min = 1) {
    if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new Error(`场景锚点：${label}无效`);
    return value.trim();
}
export function validateInlineAnchors(value) {
    if (!Array.isArray(value) || value.length > 2) throw new Error('场景锚点须为最多两条的数组');
    return value.map(anchor => {
        if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) throw new Error('场景锚点结构无效');
        const edges = anchor.edges ?? [];
        if (!Array.isArray(edges) || edges.length > 3) throw new Error('场景锚点最多包含三条互动关系');
        return { scene: text(anchor.scene, '场景叙述', 4000, 15), where: text(anchor.where ?? '', '地点', 200, 0),
            edges: edges.map(edge => {
                if (!edge || typeof edge !== 'object') throw new Error('场景锚点互动关系无效');
                return Object.fromEntries(['s', 't', 'r'].map(key => [key, text(edge[key], '互动关系', 200)]));
            }) };
    });
}
export const isInlineAnchorReceipt = receipt => receipt.origin === 'main_reply_anchors';
export const inlineAnchorInputs = payload => payload.anchors ?? (payload.summary.length >= 15 && payload.summary.length <= 4000
    ? [{ scene: payload.summary, where: payload.location, edges: [] }] : []);

/** Generated anchors use the existing exact anchor undo, never an extra model request. */
export function applyInlineAnchors(memory, entry, policy = memoryPolicy()) {
    const previous = memory.atoms.filter(atom => atom.floor === entry.floor);
    const payload = entry.payload;
    const anchors = inlineAnchorInputs(payload);
    const next = entry.omitted || entry.deleted ? [] : anchors.map((anchor, index) => ({
        atomId: `atom-inline-${entry.floor}-${index}-${memoryDigest(anchor).slice(0, 12)}`, floor: entry.floor, source: 'ai', origin: 'main_reply',
        semantic: anchor.scene, edges: structuredClone(anchor.edges), where: anchor.where,
        quality: calcAtomQuality(anchor.scene, anchor.edges, anchor.where),
    }));
    const old = new Map(previous.map(atom => [atom.atomId, atom]));
    const fresh = new Map(next.map(atom => [atom.atomId, atom]));
    const changes = [...new Set([...old.keys(), ...fresh.keys()])].flatMap(key => {
        const before = old.get(key) ?? null, after = fresh.get(key) ?? null;
        return sameMemory(before, after) ? [] : [{ collection: 'anchors', key,
            index: memory.atoms.findIndex(atom => atom.atomId === key), before, after }];
    });
    memory.atoms = [...memory.atoms.filter(atom => atom.floor !== entry.floor), ...next];
    return { version: 2, origin: 'main_reply_anchors', id: `inline-anchors-${entry.floor}`, runId: `inline-anchors-${entry.floor}`,
        cutoff: entry.floor + 1, policy, operations: changes.length ? [{ kind: 'edit', changes }] : [],
        coverage: { supplied: [], missingAnchors: [] } };
}
