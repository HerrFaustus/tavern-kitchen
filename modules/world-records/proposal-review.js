import { memoryDigest } from '../story-summary/data/memory-policy.js';
import { UPDATE_PREFIX, worldSnapshotDigest, worldUpdates } from './update-context.js';
import { prepareWorldUpdate } from './update-result.js';
import { currentTurns, assertTurnOrigin, turnById } from './turn-ledger.js';
import { worldStoryRecords, applyWorldStoryProposal, isCurrentStoryProposal } from './world-story-state.js';
import { proposalGroups, proposalTurn, clearProposal } from './proposal-policy.js';

const check = (ok, message) => { if (!ok) throw new Error(`世界提案：${message}`); };
const equal = (a, b) => memoryDigest(a) === memoryDigest(b);
const fields = { 金币: 'coins', 归属: 'owner', 所在地: 'location', 上级地点: 'parent', 描述: 'description' };
const fieldName = value => Object.hasOwn(fields, value) ? fields[value] : value;
const namesEqual = (a, b) => String(a).normalize('NFKC').trim().toLowerCase() === String(b).normalize('NFKC').trim().toLowerCase();
const reviewDigest = operation => memoryDigest({ action: operation.action, proposal: operation.proposal, reason: operation.reason });
const recordFor = (state, requestId) => {
    const record = state.sources[`${UPDATE_PREFIX}${requestId}`];
    check(record && record.kind === 'independent_world_update', '提案批次不存在'); return record;
};
function originalFor(record, index) {
    check(Number.isSafeInteger(index) && index >= 0 && index < record.update.proposals.length, '提案编号无效');
    return record.update.proposals[index];
}
function beforeValue(state, proposal, baseline) {
    if (proposal.type === 'field') {
        const entity = state.entities.find(item => item.id === proposal.entityId); check(entity, '原对象已不在当前分支');
        const old = entity.fields[fieldName(proposal.field)]; return old ? { present: true, value: structuredClone(old.value) } : { present: false };
    }
    if (proposal.type === 'story') {
        const old = worldStoryRecords(state, baseline).find(item => item.id === proposal.record.id);
        return old ? { present: true, value: old } : { present: false };
    }
    return null;
}

export function proposalReviewView(state, requestId, index, context = {}) {
    const record = recordFor(state, requestId), original = originalFor(record, index);
    const baseline = context.storyRecords || [], before = beforeValue(state, original, baseline);
    const digest = worldSnapshotDigest(state);
    return { requestId, index, fingerprint: record.fingerprint, original: structuredClone(original), before,
        review: structuredClone(record.reviews?.find(item => item.index === index) || null),
        withdrawn: record.status === 'retracted',
        stale: record.status === 'stale' || digest !== record.update.basis.digest || !!original.before && !equal(before, original.before),
        basis: { worldId: state.worldId, branchId: state.branchId, version: state.version, digest,
            storyDigest: memoryDigest(worldStoryRecords(state, baseline)) } };
}

function approvalContext(state, record, baseline) {
    const turns = currentTurns(state).filter(turn => turn.source.end >= record.update.source.start && turn.source.start <= record.update.source.end);
    const ids = new Set(turns.map(turn => turn.id));
    return { requestId: record.update.requestId, basis: { worldId: state.worldId, branchId: state.branchId, version: state.version },
        manifest: record.update.manifest, increment: record.update.source,
        incrementTurns: turns.map(turn => ({ id: turn.id, source: turn.source })),
        world: { entities: state.entities, storyRecords: worldStoryRecords(state, baseline) },
        executionReceipts: state.receipts.filter(receipt => ids.has(receipt.origin?.sourceId)).map(receipt => ({
            commandId: receipt.commandId, origin: receipt.origin, effects: state.events.find(event => event.id === receipt.eventId).effects })) };
}
function normalizeApproval(state, record, proposal, baseline) {
    const context = approvalContext(state, record, baseline);
    const legacy = proposal.type === 'story' && record.update.proposals.some(original =>
        original.type === 'story' && original.record.kind === 'plan' && original.record.id === proposal.record.id && !original.record.holders);
    const approved = prepareWorldUpdate({ basis: context.basis, proposals: [proposal], conflicts: [],
        acknowledgedReceipts: context.executionReceipts.map(receipt => receipt.commandId) }, context, {requireHolders:!legacy}).proposals[0];
    if (approved.type === 'entity') check(!state.entities.some(entity => (entity.kind === approved.kind || entity.kind === 'subject')
        && [entity.name, ...entity.aliases].some(name => [approved.name, ...approved.aliases].some(alias => namesEqual(name, alias)))), '同名或别名对象已经存在，请复用原对象');
    return approved;
}
function assertTarget(original, proposal) {
    check(proposal.type === original.type && equal(proposal.evidence, original.evidence), '不能改换提案类型或原文依据');
    if (proposal.type === 'field') check(proposal.entityId === original.entityId && fieldName(proposal.field) === fieldName(original.field), '不能改换原对象或字段');
    if (proposal.type === 'story') check(proposal.record?.id === original.record.id && proposal.record.kind === original.record.kind, '不能改换场景记录身份或类型');
}

export function proposalReviewOrigin(state, requestId, index) {
    const proposal = originalFor(recordFor(state, requestId), index);
    const turn = proposalTurn(state, proposal);
    check(turn, '原文依据没有唯一的正文轮次，请先核对来源');
    const target = proposal.type === 'field' ? ['field', proposal.entityId, fieldName(proposal.field)]
        : proposal.type === 'story' ? ['story', proposal.record.id] : ['entity', proposal.kind, proposal.name.normalize('NFKC').trim().toLowerCase()];
    return { sourceId: turn.id, effectId: `proposal:${memoryDigest(target)}` };
}

export function proposalReviewGroup(state, requestId, index) {
    const record = recordFor(state, requestId); originalFor(record, index);
    const pending = proposalGroups(state, record.update).find(group => group.indices.includes(index)).indices
        .filter(value => !record.reviews?.some(review => review.index === value));
    return pending.includes(index) ? pending : [index];
}

export function proposalBatchOrigins(state, requestId, indices) {
    const origins = indices.map(index => proposalReviewOrigin(state, requestId, index));
    check(origins.length && origins.every(origin => origin.sourceId === origins[0].sourceId), '一起提交的变化必须来自同一正文轮次');
    check(new Set(origins.map(origin => origin.effectId)).size === origins.length, '同轮变化包含重复目标');
    return { origin: { sourceId: origins[0].sourceId, effectId: `proposal-batch:${memoryDigest([requestId, [...indices].sort((a, b) => a - b)])}` }, origins };
}

export function automaticProposalIndices(state, requestId, context = {}) {
    const record = recordFor(state, requestId), update = record.update;
    if (context.available !== true || !context.history?.some(batch => batch.worldUpdate && !batch.floorEntry?.deleted
        && memoryDigest(batch.worldUpdate) === record.fingerprint) || record.status !== 'ready'
        || update.basis.branchId !== state.branchId || worldSnapshotDigest(state) !== update.basis.digest) return [];
    const eligible = [];
    for (const group of proposalGroups(state, update)) {
        if (!group.turn || group.turn.identity !== 'anchored' || group.indices.some(index => record.reviews?.some(review => review.index === index)
            || !clearProposal(update.proposals[index], update.source))) continue;
        if (update.conflicts.some(conflict => conflict.evidence.floor >= group.turn.source.start && conflict.evidence.floor <= group.turn.source.end)) continue;
        try {
            for (const index of group.indices) {
                check(!proposalReviewView(state, requestId, index, context).stale, '世界已变化');
                const origin = proposalReviewOrigin(state, requestId, index);
                assertTurnOrigin(state, origin);
                check(!worldUpdates(state).some(previous => previous.update.source.digest === update.source.digest
                    && previous.reviews?.some(review => review.action === 'rejected'
                        && equal(proposalReviewOrigin(state, previous.update.requestId, review.index), origin))), '同一来源的目标曾被人工拒绝，须再次人工核对');
                normalizeApproval(state, record, update.proposals[index], context.storyRecords || []);
            }
            eligible.push(group);
        } catch { continue; } // An invalid group stays entirely manual.
    }
    // One transaction is one narrative turn. Accumulated ranges with several
    // eligible turns remain manual rather than applying a partial old baseline.
    if (new Set(eligible.map(group => group.turn.id)).size > 1) return [];
    return eligible.flatMap(group => group.indices).sort((a, b) => a - b);
}

export function makeProposalReviewOperation(state, requestId, index, action, options = {}, context = {}) {
    check(['accepted', 'rejected'].includes(action), '处理方式无效');
    const record = recordFor(state, requestId), original = originalFor(record, index);
    const view = options.view || proposalReviewView(state, requestId, index, context);
    check(view.requestId === requestId && view.index === index && view.fingerprint === record.fingerprint, '核对页面与提案不一致');
    const existing = record.reviews?.find(item => item.index === index);
    let proposal = null;
    if (action === 'accepted') {
        const base = existing?.action === 'accepted' ? existing.proposal : original;
        const edit = options.edit || {};
        const allowed = base.type === 'field' ? ['value', 'nature'] : base.type === 'story' ? ['record', 'nature'] : ['name', 'kind', 'aliases', 'nature'];
        check(Object.keys(edit).every(key => allowed.includes(key)), '修改包含不允许的字段');
        proposal = { ...structuredClone(base), ...structuredClone(edit) };
        if (proposal.type === 'field') proposal.field = fieldName(proposal.field);
        if (!existing && options.rechecked && proposal.before) proposal.before = structuredClone(view.before);
        assertTarget(original, proposal);
        if (!existing) proposal = normalizeApproval(state, record, proposal, context.storyRecords || []);
    }
    const reason = options.reason ?? existing?.reason ?? ''; check(typeof reason === 'string' && reason.length <= 1000, '处理说明过长');
    return { type: 'review_update', requestId, index, action, proposal, reason: reason.trim(),
        fingerprint: record.fingerprint, rechecked: options.rechecked === true, basis: structuredClone(view.basis) };
}

export function repeatedProposalReview(state, command) {
    if (!command.operations?.length || !command.operations.every(operation => operation.type === 'review_update')) return null;
    const reviews = command.operations.map(operation => {
        const record = recordFor(state, operation.requestId); originalFor(record, operation.index);
        check(record.fingerprint === operation.fingerprint, '原提案已变化');
        const review = record.reviews?.find(item => item.index === operation.index);
        if (review) check(review.fingerprint === reviewDigest(operation), '该提案已处理，不能提交不同结果');
        return review;
    });
    if (!reviews.some(Boolean)) return null;
    check(reviews.every(Boolean) && new Set(reviews.map(review => review.commandId)).size === 1, '同轮提案已有部分处理，不能重新拆分提交');
    const receipt = state.receipts.find(item => item.commandId === reviews[0].commandId); check(receipt, '处理回执缺失');
    const saved = JSON.parse(receipt.fingerprint);
    check(equal(saved.operations.map(op => [op.requestId, op.index]), command.operations.map(op => [op.requestId, op.index]))
        && saved.reviewMode === command.reviewMode && equal(saved.origins ?? null, command.origins ?? null)
        && equal(saved.origin ?? null, command.origin ?? null), '同轮提案不能改变提交范围或确认方式');
    return receipt;
}

function prepareReviewItem(state, command, operation, context, storyState) {
    const record = recordFor(state, operation.requestId);
    const original = originalFor(record, operation.index);
    check(!record.reviews?.some(item => item.index === operation.index), '同一提案只能处理一次');
    check(record.status !== 'retracted' && record.fingerprint === operation.fingerprint, '提案来源已撤回或内容已变化');
    check(['accepted', 'rejected'].includes(operation.action) && typeof operation.reason === 'string' && operation.reason.length <= 1000, '处理结果无效');
    const view = proposalReviewView(state, operation.requestId, operation.index, context);
    check(equal(view.basis, operation.basis), '世界、分支或剧情状态已更新，请重新核对');
    const operations = [], version = state.version + 1, eventId = `event:${command.id}`;
    const source = { module: 'world_update', key: `${operation.requestId}/${operation.index}`,
        label: `${command.reviewMode === 'automatic' ? '自动确认' : '人工确认'} · 第 ${record.update.source.start + 1}–${record.update.source.end + 1} 楼 · ${original.evidence.quote}` };
    let outcome = 'rejected';
    if (operation.action === 'accepted') {
        check(context.available !== false, '剧情来源或记忆尚未确认，不能写入世界');
        if (context.history) check(context.history.some(batch => batch.worldUpdate && !batch.floorEntry?.deleted
            && memoryDigest(batch.worldUpdate) === record.fingerprint), '提案已不在当前确认记忆中');
        check(!view.stale || operation.rechecked === true, '世界已变化，请先重新核对当前值');
        assertTarget(original, operation.proposal);
        const origin = proposalReviewOrigin(state, operation.requestId, operation.index);
        check(command.reviewMode ? command.origins?.some(item => equal(item, origin)) : equal(command.origin, origin), '提案缺少准确的来源与效果身份'); assertTurnOrigin(state, origin);
        const approved = normalizeApproval(state, record, operation.proposal, context.storyRecords || []);
        check(equal(approved, operation.proposal), '确认内容未通过规范校验');
        const key = `proposal:${memoryDigest([state.worldId, operation.requestId, operation.index])}`;
        outcome = 'applied';
        if (approved.type === 'field') {
            if (approved.nature === 'established_fact') operations.push({ type: 'set', entityId: approved.entityId, field: approved.field, value: approved.value, source });
            else { outcome = 'claim'; operations.push({ type: 'claim', id: key, entityId: approved.entityId, field: approved.field, value: approved.value, nature: approved.nature, source }); }
        } else if (approved.type === 'entity') {
            operations.push({ type: 'create', id: key, name: approved.name, kind: approved.kind, aliases: approved.aliases, source });
            if (approved.nature !== 'established_fact') {
                outcome = 'claim'; operations.push({ type: 'claim', id: `${key}:existence`, entityId: key, field: '存在', value: true, nature: approved.nature, source });
            }
        } else {
            const applied = applyWorldStoryProposal(storyState, approved, source, version, eventId, key, record.update.source);
            storyState.modules = { ...storyState.modules, story: applied.value };
            operations.push({ type: 'module', module: 'story', value: applied.value }); outcome = applied.outcome;
        }
    } else check(!command.origin && operation.proposal === null, '拒绝提案不能执行世界效果');
    const review = { version: 1, index: operation.index, action: operation.action, proposal: structuredClone(operation.proposal),
        reason: operation.reason, fingerprint: reviewDigest(operation), commandId: command.id, eventId, worldVersion: version, outcome,
        edited: operation.action === 'accepted' && !equal(original, operation.proposal),
        ...(command.reviewMode ? { mode: command.reviewMode } : {}) };
    // Store only this decision in the event. Copying the full source batch into
    // every decision would multiply raw prose and all sibling proposals.
    operations.push({ type: 'record_review', requestId: operation.requestId, review });
    return operations;
}

export function prepareProposalReview(state, command, context = {}) {
    const items = command.operations, first = items[0], record = recordFor(state, first.requestId);
    check(items.every(item => item.type === 'review_update' && item.requestId === first.requestId && item.action === first.action)
        && new Set(items.map(item => item.index)).size === items.length, '同轮提案必须来自同一批次，且使用同一处理方式');
    check(command.reviewMode === undefined ? items.length === 1 && !command.origins : ['manual', 'automatic'].includes(command.reviewMode), '同轮提交方式无效');
    const indices = items.map(item => item.index);
    for (const index of indices) check(proposalReviewGroup(state, first.requestId, index).every(value => indices.includes(value)), '关联变化必须一起确认、修改或拒绝');
    if (command.reviewMode) {
        // Rejections have no executable origin, but still cannot mix turns.
        if (first.action === 'accepted') {
            const scope = proposalBatchOrigins(state, first.requestId, indices);
            check(equal(command.origin, scope.origin) && equal(command.origins, scope.origins), '同轮提案缺少准确的来源与效果身份');
        } else {
            const turns = indices.map(index => proposalTurn(state, originalFor(record, index)));
            check(!command.origin && !command.origins && turns[0] && turns.every(turn => turn?.id === turns[0].id), '拒绝提案须来自同一正文轮次，且不能执行世界效果');
        }
        if (command.reviewMode === 'automatic') {
            check(first.action === 'accepted' && equal(indices, automaticProposalIndices(state, first.requestId, context)), '自动确认条件不完整，请交由人工核对');
            check(items.every(item => !item.rechecked && equal(item.proposal, normalizeApproval(state, record,
                originalFor(record, item.index), context.storyRecords || []))), '自动确认不能修改提案内容');
        }
    }
    const scratch = { ...state, modules: { ...state.modules } };
    const operations = items.flatMap(item => prepareReviewItem(state, command, item, context, scratch));
    const created = operations.filter(operation => operation.type === 'create');
    for (const [index, entity] of created.entries()) check(!created.slice(0, index).some(other =>
        (other.kind === entity.kind || other.kind === 'subject' || entity.kind === 'subject')
        && [other.name, ...other.aliases].some(name => [entity.name, ...entity.aliases].some(alias => namesEqual(name, alias)))), '同轮新增对象的名称或别名冲突');
    // All story records were checked against the same frozen baseline. Persist
    // their merged projection once so sibling records cannot overwrite each other.
    return [...operations.filter(operation => operation.type !== 'module'),
        ...(operations.some(operation => operation.type === 'module') ? [{ type: 'module', module: 'story', value: scratch.modules.story }] : [])];
}

export function validateProposalReviewHistory(state) {
    for (const record of Object.values(state.sources)) for (const review of record?.kind === 'independent_world_update' ? record.reviews || [] : []) {
        const receipt = state.receipts.find(item => item.commandId === review.commandId);
        const event = state.events.find(item => item.id === review.eventId);
        check(receipt && event && receipt.eventId === review.eventId && receipt.version === review.worldVersion && event.version === review.worldVersion, '处理回执与历史不一致');
        const command = JSON.parse(receipt.fingerprint), matches = command.operations?.filter(op => op.type === 'review_update'
            && op.requestId === record.update.requestId && op.index === review.index), operation = matches?.[0];
        check(matches?.length === 1 && (command.reviewMode ? ['manual', 'automatic'].includes(command.reviewMode) : command.operations.length === 1)
            && review.mode === command.reviewMode && operation.requestId === record.update.requestId
            && command.expectedVersion === review.worldVersion - 1 && command.worldId === state.worldId
            && operation.index === review.index && operation.fingerprint === record.fingerprint && review.fingerprint === reviewDigest(operation), '处理回执与提案不一致');
        check(event.effects.some(effect => effect.type === 'review' && effect.id === `${UPDATE_PREFIX}${record.update.requestId}`
            && effect.before === null && equal(effect.after, review)), '处理记录缺少同笔提交依据');
        const proposal = review.proposal;
        const outcome = review.action === 'rejected' ? 'rejected' : proposal.type === 'story'
            ? isCurrentStoryProposal(proposal) ? 'applied' : 'candidate' : proposal.nature === 'established_fact' ? 'applied' : 'claim';
        check(review.outcome === outcome && review.edited === (review.action === 'accepted' && !equal(record.update.proposals[review.index], proposal)), '处理结果与确认内容不一致');
        if (review.action === 'rejected') check(!receipt.origin && event.effects.every(effect => effect.type === 'review'), '拒绝记录不能包含世界效果');
        else {
            check(!!receipt.origin, '确认记录缺少来源效果回执');
            if (command.reviewMode) {
                const index = command.operations.indexOf(operation), origin = receipt.origins?.[index];
                const turn = turnById(state, receipt.origin.sourceId), original = record.update.proposals[review.index];
                const target = original.type === 'field' ? ['field', original.entityId, fieldName(original.field)]
                    : original.type === 'story' ? ['story', original.record.id] : ['entity', original.kind, original.name.normalize('NFKC').trim().toLowerCase()];
                check(origin?.sourceId === turn?.id && original.evidence.floor >= turn.source.start && original.evidence.floor <= turn.source.end
                    && origin.effectId === `proposal:${memoryDigest(target)}`
                    && receipt.origin.effectId === `proposal-batch:${memoryDigest([record.update.requestId, command.operations.map(op => op.index).sort((a, b) => a - b)])}`, '同轮效果与原提案目标不一致');
                if (command.reviewMode === 'automatic') check(!review.edited && clearProposal(original, record.update.source)
                    && !record.update.conflicts.some(conflict => conflict.evidence.floor >= turn.source.start && conflict.evidence.floor <= turn.source.end), '自动确认历史与明确依据不一致');
            }
            const key = `proposal:${memoryDigest([state.worldId, record.update.requestId, review.index])}`;
            if (proposal.type === 'field') check(event.effects.some(effect => outcome === 'applied'
                ? effect.type === 'entity' && effect.id === proposal.entityId && equal(effect.after.fields[proposal.field]?.value, proposal.value)
                    && equal(effect.before?.fields[proposal.field] ? { present: true, value: effect.before.fields[proposal.field].value } : { present: false }, proposal.before)
                : effect.type === 'claim' && effect.id === key && effect.after.entityId === proposal.entityId && effect.after.field === proposal.field
                    && effect.after.nature === proposal.nature && equal(effect.after.value, proposal.value)), '字段效果与确认内容不一致');
            else if (proposal.type === 'entity') check(event.effects.some(effect => effect.type === 'entity' && effect.id === key
                && effect.before === null && effect.after.name === proposal.name && effect.after.kind === proposal.kind && equal(effect.after.aliases, proposal.aliases)), '对象效果与确认内容不一致');
            else check(event.effects.some(effect => effect.type === 'module' && effect.id === 'story'
                && effect.after[outcome === 'applied' ? 'records' : 'candidates'].some(entry => entry.key === key
                    && equal(entry.record, proposal.record) && entry.nature === proposal.nature && entry.eventId === event.id)), '剧情效果与确认内容不一致');
        }
    }
}
