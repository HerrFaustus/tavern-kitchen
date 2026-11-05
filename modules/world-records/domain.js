import { parseMapDomain } from '../xiaobai-os/domains/map/invariants.js';
import { assertTurnOrigin, TURN_PREFIX, turnById, validateTurnLedger, validateTurnRecord } from './turn-ledger.js';
import { UPDATE_PREFIX } from './update-context.js';
import { validateUpdateRecord } from './update-ledger.js';

// Host-independent world archive. Only established fields participate in commands.
export const SCHEMA = 3;
export const KINDS = { person: '人物', organization: '组织', place: '地点', item: '物品', subject: '未分类' };
export const NATURES = { established_fact: '已确认事实', rumor: '传闻', belief: '角色认知', intention: '计划', hypothesis: '推测', creative_proposal: '创作候选', unclassified: '待确认' };
export const FIELD_LABELS = { coins: '金币', owner: '归属', location: '所在地', parent: '上级地点', description: '描述' };
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
export function invariant(ok, message) { if (!ok) throw new Error(message); }
export function text(value, label = '内容', limit = 4000) {
    invariant(typeof value === 'string' && value.trim() && value.length <= limit, `${label}不能为空或超过 ${limit} 字符`);
    invariant(!forbidden.has(value), `${label}无效`);
    return value.trim();
}
export function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
    return JSON.stringify(value);
}
function jsonValue(value, depth = 0, stringLimit = 20 * 1024 * 1024) {
    invariant(depth < 40, '内容层级过深');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'string') { invariant(value.length <= stringLimit, '字段内容过长'); return; }
    if (typeof value === 'number') { invariant(Number.isFinite(value), '数值无效'); return; }
    invariant(value && typeof value === 'object' && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype), '仅支持 JSON 数据');
    for (const [key, item] of Object.entries(value)) { invariant(!forbidden.has(key), '字段名称无效'); jsonValue(item, depth + 1, stringLimit); }
}
export function emptyWorld(worldId, branchId, title) {
    return { schema: SCHEMA, worldId, branchId, title, version: 0, entities: [], claims: [], sources: {}, modules: {}, events: [], receipts: [] };
}
export function entityById(state, id) {
    const entity = state.entities.find(e => e.id === id);
    invariant(entity, '档案对象不存在'); return entity;
}
export function fieldValue(entity, field) { return entity.fields[field]?.value; }
function safeField(field) { const value = text(field, '属性名称', 100); return Object.entries(FIELD_LABELS).find(([, label]) => label === value)?.[0] || value; }
function validateReference(state, field, value) {
    jsonValue(value, 0, 30000);
    if (value && typeof value === 'object' && Object.hasOwn(value, 'entityId')) entityById(state, value.entityId);
    if (['owner', 'location', 'parent'].includes(field)) {
        invariant(value === null || value && typeof value === 'object' && Object.keys(value).length === 1 && typeof value.entityId === 'string', '归属与位置必须引用档案对象');
        if (value && field !== 'owner') invariant(entityById(state, value.entityId).kind === 'place', '位置必须是地点');
    }
    if (field === 'coins') invariant(Number.isSafeInteger(value) && value >= 0, '金币必须是非负安全整数');
}
function checkGraph(state) {
    for (const field of ['owner', 'parent', 'location']) for (const entity of state.entities) {
        const seen = new Set([entity.id]); let next = fieldValue(entity, field)?.entityId;
        while (next) { invariant(!seen.has(next), '归属或位置不能形成循环'); seen.add(next); next = fieldValue(entityById(state, next), field)?.entityId; }
    }
}
function sourceOf(value) {
    invariant(value && typeof value === 'object', '缺少状态来源');
    return { module: text(value.module, '来源类型', 100), key: text(value.key, '来源标识', 1000), label: text(value.label, '来源说明', 4000) };
}
export function validateWorld(state) {
    invariant([1, 2, SCHEMA].includes(state?.schema), '不支持的世界档案版本');
    jsonValue(state);
    text(state.worldId); text(state.branchId); text(state.title);
    invariant(Number.isSafeInteger(state.version) && state.version >= 0, '世界版本无效');
    for (const key of ['entities', 'claims', 'events', 'receipts']) invariant(Array.isArray(state[key]), '世界档案结构不完整');
    invariant(state.entities.length <= 20000 && state.claims.length <= 100000, '档案超过当前容量上限');
    invariant(state.events.length === state.version && state.receipts.length === state.version, '变更历史与版本不一致');
    invariant(state.sources && typeof state.sources === 'object' && !Array.isArray(state.sources), '世界来源结构无效');
    validateTurnLedger(state);
    for (const [key, record] of Object.entries(state.sources)) if (key.startsWith(UPDATE_PREFIX)) validateUpdateRecord(key, record);
    if (state.modules !== undefined) {
        invariant(state.modules && typeof state.modules === 'object' && !Array.isArray(state.modules), '模块状态无效');
        invariant(Object.keys(state.modules).every(key => ['map', 'variables'].includes(key)), '不支持的世界模块');
        if (state.modules.map !== undefined) { invariant(state.schema >= 2, '旧格式不能包含新版地图状态'); parseMapDomain(state.modules.map); }
        // Schema 3 backups may contain the retired module's JSON. Keep it as an
        // opaque archive for history/exports; no command can write or execute it.
        if (state.modules.variables !== undefined) invariant(state.schema === 3 && state.modules.variables && typeof state.modules.variables === 'object' && !Array.isArray(state.modules.variables), '历史模块归档无效');
    }
    invariant(new Set(state.entities.map(e => e.id)).size === state.entities.length, '对象身份重复');
    const bindings = new Set();
    for (const e of state.entities) {
        text(e.id); text(e.name, '名称', 200); invariant(Object.hasOwn(KINDS, e.kind), '对象类型无效');
        invariant(Array.isArray(e.aliases) && Array.isArray(e.bindings) && e.fields && !Array.isArray(e.fields), '对象结构无效');
        for (const alias of e.aliases) text(alias, '别名', 200);
        sourceOf(e.source);
        for (const b of e.bindings) { text(b, '来源绑定', 1500); const parts = JSON.parse(b); invariant(Array.isArray(parts) && parts.length === 2 && parts.every(p => typeof p === 'string' && p.length > 0), '来源绑定无效'); invariant(!bindings.has(b), '来源绑定重复'); bindings.add(b); }
        for (const [key, record] of Object.entries(e.fields)) { safeField(key); sourceOf(record.source); invariant(record.nature === 'established_fact', '候选不能写入事实字段'); validateReference(state, key, record.value); }
    }
    invariant(new Set(state.claims.map(c => c.id)).size === state.claims.length, '候选身份重复');
    for (const c of state.claims) { text(c.id); entityById(state, c.entityId); safeField(c.field); jsonValue(c.value, 0, 30000); invariant(Object.hasOwn(NATURES, c.nature) && ['pending', 'accepted', 'dismissed', 'withdrawn'].includes(c.status), '记录性质或状态无效'); sourceOf(c.source); }
    invariant(new Set(state.events.map(e => e.id)).size === state.version && new Set(state.receipts.map(r => r.commandId)).size === state.version, '历史标识重复');
    const effectKeys = new Set();
    for (let i = 0; i < state.events.length; i++) {
        const event = state.events[i], receipt = state.receipts[i];
        invariant(event.version === i + 1 && receipt.eventId === event.id, '历史顺序不完整');
        if (receipt.origin) {
            const { sourceId, effectId } = receipt.origin;
            invariant(turnById(state, sourceId) && typeof effectId === 'string' && effectId.trim() && effectId.length <= 200
                && canonical(event.origin) === canonical(receipt.origin) && typeof receipt.effectFingerprint === 'string', '效果来源回执无效');
            let executed;
            try { executed = JSON.parse(receipt.fingerprint); } catch { throw new Error('效果命令回执无效'); }
            invariant(executed.id === receipt.commandId && executed.worldId === state.worldId && executed.expectedVersion === i
                && canonical(executed) === receipt.fingerprint && canonical(executed.origin) === canonical(receipt.origin)
                && canonical(executed.operations) === receipt.effectFingerprint, '效果命令与回执不一致');
            const key = canonical([sourceId, effectId]); invariant(!effectKeys.has(key), '同一来源效果重复执行'); effectKeys.add(key);
        } else invariant(!event.origin, '效果来源回执不完整');
    }
    checkGraph(state); return state;
}

export function applyCommand(previous, command) {
    invariant(command && typeof command === 'object', '命令无效'); jsonValue(command);
    text(command.id, '命令标识', 200); text(command.title, '变更说明', 1000); text(command.at, '记录时间', 100);
    invariant(command.worldId === previous.worldId && command.branchId === previous.branchId, '世界或分支已切换，请重新打开档案');
    const fingerprint = canonical(command);
    const receipt = previous.receipts.find(r => r.commandId === command.id);
    if (receipt) { invariant(receipt.fingerprint === fingerprint, '同一命令标识不能提交不同内容'); return { state: previous, receipt, repeated: true }; }
    if (command.origin) {
        assertTurnOrigin(previous, command.origin);
        const executed = previous.receipts.find(r => r.origin?.sourceId === command.origin.sourceId && r.origin.effectId === command.origin.effectId);
        if (executed) {
            invariant(executed.effectFingerprint === canonical(command.operations), '同一来源效果编号不能提交不同内容');
            return { state: previous, receipt: executed, repeated: true };
        }
        invariant(!command.operations?.some(op => op.type === 'source'), '执行效果不能改写来源记录');
    }
    invariant(command.expectedVersion === previous.version, '档案已更新，请重新加载后再保存');
    invariant(Array.isArray(command.operations) && command.operations.length > 0 && command.operations.length <= 10000, '变更数量无效');
    const state = structuredClone(previous); const effects = []; const version = state.version + 1;
    const eventId = `event:${command.id}`;
    const record = (type, id, before, after) => effects.push({ type, id, before: before ?? null, after: structuredClone(after) });
    function mutate(id, update) { const entity = entityById(state, id); const before = structuredClone(entity); update(entity); entity.revision = version; record('entity', id, before, entity); }
    function setField(id, field, value, source) {
        field = safeField(field); validateReference(state, field, value);
        mutate(id, e => { e.fields[field] = { value: structuredClone(value), nature: 'established_fact', source: sourceOf(source), eventId, version }; });
    }
    for (const op of command.operations) {
        if (op.type === 'module') {
            invariant(op.module === 'map', '不支持的世界模块');
            const value = parseMapDomain(op.value);
            invariant(value.revision === version, '模块与世界提交版本不一致');
            state.schema = SCHEMA;
            state.modules ||= {};
            record('module', op.module, state.modules[op.module], value);
            state.modules[op.module] = value;
        } else if (op.type === 'create') {
            text(op.id, '对象标识', 200); invariant(!state.entities.some(e => e.id === op.id), '对象身份已存在');
            invariant(Object.hasOwn(KINDS, op.kind), '对象类型无效');
            const entity = { id: op.id, name: text(op.name, '名称', 200), kind: op.kind, aliases: (op.aliases || []).map(a => text(a, '别名', 200)), bindings: [], fields: {}, revision: version, source: sourceOf(op.source) };
            state.entities.push(entity); record('entity', entity.id, null, entity);
        } else if (op.type === 'rename') {
            mutate(op.entityId, e => { e.aliases = [...new Set([...e.aliases, e.name, ...(op.aliases || []).map(a => text(a, '别名', 200))])]; e.name = text(op.name, '名称', 200); if (op.kind) { invariant(e.kind === 'subject' || e.kind === op.kind, '已分类对象不能直接改变类型'); invariant(Object.hasOwn(KINDS, op.kind), '对象类型无效'); e.kind = op.kind; } });
        } else if (op.type === 'bind') {
            const binding = text(op.binding, '来源绑定', 1500);
            invariant(!state.entities.some(e => e.id !== op.entityId && e.bindings.includes(binding)), '来源已绑定其他对象');
            mutate(op.entityId, e => { if (!e.bindings.includes(binding)) e.bindings.push(binding); });
        } else if (op.type === 'set') {
            setField(op.entityId, op.field, op.value, op.source);
        } else if (op.type === 'claim') {
            invariant(op.nature !== 'established_fact' && Object.hasOwn(NATURES, op.nature), '候选性质无效'); entityById(state, op.entityId);
            const claim = { id: text(op.id, '记录标识', 200), entityId: op.entityId, field: safeField(op.field), value: structuredClone(op.value), nature: op.nature, source: sourceOf(op.source), status: 'pending', eventId, version };
            invariant(!state.claims.some(c => c.id === claim.id), '记录标识重复'); state.claims.push(claim); record('claim', claim.id, null, claim);
        } else if (op.type === 'resolve') {
            const claim = state.claims.find(c => c.id === op.claimId); invariant(claim?.status === 'pending', '该候选已处理或已撤回');
            invariant(['accepted', 'dismissed', 'withdrawn'].includes(op.status), '处理方式无效');
            if (op.status === 'accepted') setField(claim.entityId, claim.field, claim.value, { ...claim.source, label: `${claim.source.label}；人工确认` });
            const before = structuredClone(claim); claim.status = op.status; claim.resolvedEventId = eventId; record('claim', claim.id, before, claim);
        } else if (op.type === 'source') {
            text(op.module, '来源类型', 100);
            if (op.module.startsWith(TURN_PREFIX)) validateTurnRecord(op.module, op.snapshot);
            if (op.module.startsWith(UPDATE_PREFIX)) validateUpdateRecord(op.module, op.snapshot);
            record('source', op.module, state.sources[op.module], op.snapshot); state.sources[op.module] = structuredClone(op.snapshot);
        } else if (op.type === 'purchase') {
            const buyer = entityById(state, op.buyerId), seller = entityById(state, op.sellerId), item = entityById(state, op.itemId);
            invariant(buyer.id !== seller.id && ['person', 'organization'].includes(buyer.kind) && ['person', 'organization'].includes(seller.kind) && item.kind === 'item', '交易参与者或物品无效');
            invariant(Number.isSafeInteger(op.price) && op.price > 0, '价格必须是正整数');
            const balance = fieldValue(buyer, 'coins'), income = fieldValue(seller, 'coins');
            invariant(Number.isSafeInteger(balance) && Number.isSafeInteger(income) && balance >= op.price, '金币尚未确认或余额不足');
            invariant(Number.isSafeInteger(income + op.price), '交易金额超过支持范围');
            invariant(fieldValue(item, 'owner')?.entityId === seller.id, '卖方已不再持有这件物品');
            setField(buyer.id, 'coins', balance - op.price, op.source); setField(seller.id, 'coins', income + op.price, op.source);
            setField(item.id, 'owner', { entityId: buyer.id }, op.source);
        } else throw new Error('不支持的世界命令');
    }
    state.version = version;
    const origin = command.origin ? { origin: structuredClone(command.origin) } : {};
    state.events.push({ id: eventId, commandId: command.id, title: command.title, at: command.at, version, effects, ...origin });
    const nextReceipt = { commandId: command.id, fingerprint, eventId, version, ...origin,
        ...(command.origin ? { effectFingerprint: canonical(command.operations) } : {}) };
    state.receipts.push(nextReceipt); validateWorld(state);
    return { state, receipt: nextReceipt, repeated: false };
}

export function forkWorld(state, version, branchId) {
    invariant(Number.isSafeInteger(version) && version >= 0 && version <= state.version, '分支起点无效');
    const next = emptyWorld(state.worldId, text(branchId), state.title);
    for (const event of state.events.slice(0, version)) for (const change of event.effects) {
        invariant(['source', 'entity', 'claim', 'module'].includes(change.type), '历史变更类型无效');
        if (change.type === 'module') { invariant(['map', 'variables'].includes(change.id) && canonical(next.modules[change.id] ?? null) === canonical(change.before), '模块历史不连续'); next.modules[change.id] = structuredClone(change.after); }
        else if (change.type === 'source') { invariant(canonical(next.sources[change.id] ?? null) === canonical(change.before), '来源历史不连续'); next.sources[change.id] = structuredClone(change.after); }
        else { const list = change.type === 'entity' ? next.entities : next.claims; const index = list.findIndex(x => x.id === change.id); invariant(canonical(list[index] ?? null) === canonical(change.before), '对象历史不连续'); if (index < 0) list.push(structuredClone(change.after)); else list[index] = structuredClone(change.after); }
    }
    next.version = version; next.events = structuredClone(state.events.slice(0, version)); next.receipts = structuredClone(state.receipts.slice(0, version));
    next.parent = { branchId: state.branchId, version }; return validateWorld(next);
}
