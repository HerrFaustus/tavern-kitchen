import { memoryDigest } from '../story-summary/data/memory-policy.js';
import { validateRangeSource } from '../story-summary/data/turn-source.js';
import { parseStoryUpdates } from '../story-state/records.js';

const natures = ['established_fact', 'rumor', 'belief', 'intention', 'hypothesis', 'creative_proposal', 'unclassified'];
const kinds = ['person', 'organization', 'place', 'item', 'subject'];
const reserved = new Set(['__proto__', 'prototype', 'constructor']);
const check = (ok, message) => { if (!ok) throw new Error(`世界变化提案：${message}`); };
const text = (value, label, max = 2000) => { check(typeof value === 'string' && value.trim() && value.length <= max && !reserved.has(value), `${label}无效`); return value.trim(); };
const equal = (a, b) => memoryDigest(a) === memoryDigest(b);
function decisionMetadata(item) {
    const value = {};
    if (item.groupId !== undefined) value.groupId = text(item.groupId, '关联组', 100);
    if (item.certainty !== undefined) {
        check(['explicit', 'inferred', 'uncertain'].includes(item.certainty), '明确程度无效');
        value.certainty = item.certainty;
    }
    return value;
}
function json(value, depth = 0) {
    check(depth < 30, '字段层级过深');
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value === 'string') { check(value.length <= 30000, '字段内容过长'); return; }
    check(value && typeof value === 'object' && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype), '字段须为 JSON');
    for (const [key, item] of Object.entries(value)) { check(!reserved.has(key), '字段名称无效'); json(item, depth + 1); }
}
function evidence(value, source) {
    const quote = text(value?.quote, '来源引文', 800);
    const message = source.messages.find(item => item.floor === value.floor);
    check(message && message.text.includes(quote), '依据必须是本次增量中的实际原文');
    return { floor: value.floor, quote };
}
function validateValue(field, value, entities) {
    json(value);
    if (value && typeof value === 'object' && Object.hasOwn(value, 'entityId')) check(entities.some(entity => entity.id === value.entityId), '关联对象不存在');
    if (field === 'coins') check(Number.isSafeInteger(value) && value >= 0, '金币须为非负安全整数');
    if (['location', 'owner', 'parent'].includes(field)) {
        check(value === null || value && typeof value === 'object' && Object.keys(value).length === 1 && typeof value.entityId === 'string', '位置与归属须引用对象');
        if (value && field !== 'owner') check(entities.find(entity => entity.id === value.entityId)?.kind === 'place', '位置须引用地点');
    }
}

export function prepareWorldUpdate(raw, context) {
    check(raw && typeof raw === 'object' && !Array.isArray(raw), '缺少统一更新结果');
    const expected = { worldId: context.basis.worldId, branchId: context.basis.branchId, version: context.basis.version };
    check(equal(raw.basis, expected), '世界或分支版本与输入不一致');
    check(Array.isArray(raw.proposals) && raw.proposals.length <= 200 && Array.isArray(raw.conflicts) && raw.conflicts.length <= 100, '提案或冲突数量无效');
    const supplied = context.executionReceipts.map(receipt => receipt.commandId);
    check(Array.isArray(raw.acknowledgedReceipts) && new Set(raw.acknowledgedReceipts).size === raw.acknowledgedReceipts.length
        && equal([...raw.acknowledgedReceipts].sort(), [...supplied].sort()), '必须核对全部已执行回执，不能引用未知回执');
    const seen = new Set(), entities = context.world.entities;
    const proposals = raw.proposals.map(item => {
        check(item && ['field', 'entity', 'story'].includes(item.type) && natures.includes(item.nature), '提案类型或事实性质无效');
        const proof = evidence(item.evidence, context.increment);
        let proposal;
        if (item.type === 'field') {
            const entity = entities.find(entity => entity.id === item.entityId); check(entity, '对象须使用已有稳定 ID');
            const field = text(item.field, '字段名', 100), old = entity.fields[field];
            check(equal(item.before, old ? { present: true, value: old.value } : { present: false }), '旧值与世界快照不一致');
            validateValue(field, item.value, entities);
            check(!old || !equal(old.value, item.value), '未变化的字段不应重复提议');
            const alreadyExecuted = context.executionReceipts.some(receipt => {
                const source = receipt.origin && context.incrementTurns?.find(turn => turn.id === receipt.origin.sourceId)?.source;
                if (!source || proof.floor < source.start || proof.floor > source.end) return false;
                return receipt.effects.some(effect => effect.type === 'entity' && effect.id === entity.id
                    && !equal(effect.before?.fields?.[field] ?? null, effect.after?.fields?.[field] ?? null));
            });
            check(!alreadyExecuted, '本轮该字段已有执行回执，只能补记经过或记录冲突');
            proposal = { type: 'field', entityId: entity.id, field, before: structuredClone(item.before), value: structuredClone(item.value), nature: item.nature, evidence: proof };
        } else if (item.type === 'story') {
            const record = parseStoryUpdates([item.record])[0], old = context.world.storyRecords.find(item => item.id === record.id);
            check(equal(item.before, old ? { present: true, value: old } : { present: false }), '场景或认知记录旧值不一致');
            check(!old || old.kind === record.kind, '同一场景记录不能改变类型');
            proposal = { type: 'story', record, before: structuredClone(item.before), nature: item.nature, evidence: proof };
        } else {
            const name = text(item.name, '对象名', 200); check(kinds.includes(item.kind), '对象类型无效');
            check(!entities.some(entity => entity.kind === item.kind && [entity.name, ...entity.aliases].includes(name)), '对象已经存在，请复用稳定 ID');
            check(Array.isArray(item.aliases) && item.aliases.length <= 50, '别名无效');
            proposal = { type: 'entity', name, kind: item.kind, aliases: [...new Set(item.aliases.map(alias => text(alias, '别名', 200)))], nature: item.nature, evidence: proof };
        }
        Object.assign(proposal, decisionMetadata(item));
        const key = item.type === 'field' ? `field:${item.entityId}/${item.field}` : item.type === 'story' ? `story:${proposal.record.id}` : `entity:${item.kind}/${item.name}`;
        check(!seen.has(key), '同批提案重复'); seen.add(key); return proposal;
    });
    return { version: 1, requestId: context.requestId, basis: structuredClone(context.basis), manifest: structuredClone(context.manifest),
        source: structuredClone(context.increment), proposals, acknowledgedReceipts: [...raw.acknowledgedReceipts],
        conflicts: raw.conflicts.map(item => ({ description: text(item?.description, '冲突说明'), evidence: evidence(item.evidence, context.increment) })) };
}

export function validateStoredUpdate(update) {
    check(update?.version === 1 && typeof update.requestId === 'string' && update.requestId.length > 0
        && typeof update.basis?.worldId === 'string' && typeof update.basis.branchId === 'string'
        && Number.isSafeInteger(update.basis.version) && update.basis.version >= 0 && /^[a-f0-9]{64}$/.test(update.basis.digest)
        && update.manifest?.mode === 'full' && update.manifest.worldComplete === true
        && Array.isArray(update.proposals) && update.proposals.length <= 200 && Array.isArray(update.acknowledgedReceipts)
        && Array.isArray(update.conflicts) && update.conflicts.length <= 100, '保存记录结构无效');
    validateRangeSource(update.source); json(update);
    const seen = new Set();
    for (const item of update.proposals) {
        check(item && ['field', 'entity', 'story'].includes(item.type) && natures.includes(item.nature), '保存的提案类型无效');
        evidence(item.evidence, update.source);
        decisionMetadata(item);
        let key;
        if (item.type === 'field') {
            text(item.entityId, '保存的对象身份', 200); text(item.field, '保存的字段', 100);
            check(item.before && typeof item.before.present === 'boolean' && (item.before.present ? Object.hasOwn(item.before, 'value') : !Object.hasOwn(item.before, 'value'))
                && Object.hasOwn(item, 'value'), '保存的旧值或新值无效');
            key = `field:${item.entityId}/${item.field}`;
        } else if (item.type === 'story') {
            parseStoryUpdates([item.record]);
            check(item.before && typeof item.before.present === 'boolean', '保存的场景旧值无效'); key = `story:${item.record.id}`;
        } else {
            text(item.name, '保存的对象名', 200); check(kinds.includes(item.kind) && Array.isArray(item.aliases) && item.aliases.length <= 50, '保存的对象类型或别名无效');
            item.aliases.forEach(alias => text(alias, '保存的别名', 200)); key = `entity:${item.kind}/${item.name}`;
        }
        check(!seen.has(key), '保存的提案重复'); seen.add(key);
    }
    for (const conflict of update.conflicts) { text(conflict?.description, '保存的冲突说明'); evidence(conflict.evidence, update.source); }
    check(new Set(update.acknowledgedReceipts).size === update.acknowledgedReceipts.length, '保存的执行回执重复');
    update.acknowledgedReceipts.forEach(id => text(id, '保存的执行回执编号', 200));
    return update;
}
