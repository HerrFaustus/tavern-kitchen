import { createIdentifier } from '../../shared/common/identifier.js';
import { KINDS, NATURES, FIELD_LABELS, fieldValue } from './domain.js';
import { worldUpdates } from './update-context.js';
import { storyRecordText, STORY_FIELDS, PRESENCE, BELIEFS, THREAD_STATUS } from '../story-state/records.js';
import { proposalTurn } from './proposal-policy.js';

export function createWorldPanel({ service, sync, getIdentity }) {
    let root, state, selected = '', query = '', kind = '', editing = false, busy = false, epoch = 0;
    let status, content, results;
    const el = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
    const button = (label, action) => { const e = el('button', label, 'menu_button'); e.type = 'button'; e.addEventListener('click', action); return e; };
    const input = (type, value = '') => { const e = el('input', undefined, 'text_pole'); e.type = type; e.value = value; return e; };
    const select = (entries, value = '') => { const e = el('select', undefined, 'text_pole'); for (const [id, title] of entries) { const option = el('option', title); option.value = id; e.append(option); } e.value = value; return e; };
    const label = (title, control) => { const e = el('label', title, 'tk-record-field'); if (control.matches('input,select,textarea') && !control.hasAttribute('aria-label')) control.setAttribute('aria-label', title); e.append(control); return e; };
    const heading = title => el('h3', title, 'standoutHeader');
    const describe = value => value?.entityId ? `${state.entities.find(e => e.id === value.entityId)?.name || '未知对象'}${value.description ? ` · ${value.description}` : ''}` : typeof value === 'string' ? value : JSON.stringify(value);
    function run(task) {
        if (busy) return;
        busy = true; const token = epoch, identity = getIdentity();
        status.textContent = '正在保存…'; status.setAttribute('role', 'status');
        const controls = [...root.querySelectorAll('button,input,select,textarea')]; const disabled = controls.map(e => e.disabled); controls.forEach(e => { e.disabled = true; });
        Promise.resolve().then(task).then(next => {
            if (token !== epoch || identity !== getIdentity()) return;
            editing = false; show(next?.state || next); status.textContent = '已保存';
        }).catch(error => {
            if (token !== epoch || identity !== getIdentity()) return;
            status.setAttribute('role', 'alert'); status.textContent = error?.message || '保存失败，请重试';
        }).finally(() => { if (token === epoch) { busy = false; controls.forEach((e, i) => { e.disabled = disabled[i]; }); } });
    }
    function form(title, fields, build, { saveLabel = '保存', createCommand = operations => service.command(state, operations, title) } = {}) {
        editing = true; content.replaceChildren(heading(title));
        const f = el('form'); for (const field of fields) f.append(field);
        const save = el('button', saveLabel, 'menu_button'); save.type = 'submit';
        const actions = el('div', undefined, 'tk-record-actions'); actions.append(save, button('取消', () => { editing = false; show(state); })); f.append(actions);
        let command;
        f.addEventListener('input', () => { command = null; }); f.addEventListener('change', () => { command = null; });
        f.addEventListener('submit', event => { event.preventDefault(); run(() => { command ||= createCommand(build()); return service.commit(command); }); });
        content.append(f); f.querySelector('input,select,textarea')?.focus();
    }
    const manual = reason => ({ module: 'manual', key: createIdentifier(), label: reason || '玩家登记' });
    function createEntity() {
        const name = input('text'); name.required = true; name.maxLength = 200;
        const type = select(Object.entries(KINDS), 'person'), aliases = input('text');
        const source = input('text', '玩家登记'); source.required = true;
        const id = createIdentifier();
        form('新增档案', [label('名称', name), label('类型', type), label('别名（用逗号分隔）', aliases), label('来源', source)], () => {
            selected = id;
            return [{ type: 'create', id, name: name.value, kind: type.value, aliases: aliases.value.split(/[,，]/).map(s => s.trim()).filter(Boolean), source: manual(source.value) }];
        });
    }
    function rename(entity) {
        const name = input('text', entity.name); name.required = true; name.maxLength = 200;
        const aliases = input('text', entity.aliases.join('，'));
        const type = select(Object.entries(KINDS), entity.kind); type.disabled = entity.kind !== 'subject';
        form('编辑档案名称', [label('名称', name), label('别名（用逗号分隔）', aliases), label('类型', type)], () => [{ type: 'rename', entityId: entity.id, name: name.value, aliases: aliases.value.split(/[,，]/).map(s => s.trim()).filter(Boolean), kind: type.value }]);
    }
    function addRecord(entity) {
        const field = input('text'); field.required = true; field.maxLength = 100;
        const type = select([['text', '文本'], ['number', '数值'], ['reference', '关联对象']], 'text');
        const value = input('text'); value.required = true;
        const candidates = state.entities.filter(e => e.id !== entity.id).map(e => [e.id, `${e.name} · ${KINDS[e.kind]}`]);
        const target = select(candidates, candidates[0]?.[0]); target.hidden = true;
        type.addEventListener('change', () => { target.hidden = type.value !== 'reference'; value.hidden = type.value === 'reference'; value.required = !value.hidden; });
        const nature = select(Object.entries(NATURES), 'established_fact'), source = input('text', '玩家确认'); source.required = true;
        const values = el('div'); values.append(value, target);
        const hint = el('p', '金币使用“金币”数值；归属、所在地和上级地点使用关联对象。', 'tk-record-note');
        form('新增状态记录', [label('属性', field), label('值类型', type), label('值', values), label('性质', nature), label('来源与依据', source), hint], () => {
            const key = Object.entries(FIELD_LABELS).find(([, v]) => v === field.value)?.[0] || field.value;
            const parsed = type.value === 'reference' ? { entityId: target.value } : type.value === 'number' ? Number(value.value) : value.value;
            return [{ type: nature.value === 'established_fact' ? 'set' : 'claim', id: createIdentifier(), entityId: entity.id, field: key, value: parsed, nature: nature.value, source: manual(source.value) }];
        });
    }
    function purchase() {
        const actors = state.entities.filter(e => ['person', 'organization'].includes(e.kind)).map(e => [e.id, e.name]);
        const items = state.entities.filter(e => e.kind === 'item').map(e => [e.id, e.name]);
        const buyer = select(actors, actors[0]?.[0]), seller = select(actors, actors[1]?.[0]), item = select(items, items[0]?.[0]);
        const price = input('number', '1'); price.min = '1'; price.step = '1'; price.required = true;
        const reason = input('text', '玩家确认的交易'); reason.required = true;
        form('登记交易', [label('买方', buyer), label('卖方', seller), label('物品', item), label('价格（金）', price), label('依据', reason), el('p', '保存后同时更新双方金币与物品归属。参与者金币、物品归属须先登记为已确认事实。', 'tk-record-note')], () => [{ type: 'purchase', buyerId: buyer.value, sellerId: seller.value, itemId: item.value, price: Number(price.value), source: manual(reason.value) }]);
    }
    function renderList() {
        results.replaceChildren();
        const needle = query.trim().toLocaleLowerCase();
        const entities = state.entities.filter(e => (!kind || e.kind === kind) && [e.name, ...e.aliases].some(n => n.toLocaleLowerCase().includes(needle)));
        if (!entities.length) results.append(el('p', state.entities.length ? '没有匹配的档案。' : '还没有档案。可以新增对象，或同步已有剧情和地图记录。', 'tk-record-note'));
        for (const entity of entities) {
            const b = button(`${entity.name} · ${KINDS[entity.kind]}`, () => { editing = false; selected = entity.id; renderList(); renderDetail(); });
            b.classList.add('tk-record-result'); b.setAttribute('aria-pressed', String(selected === entity.id)); if (selected === entity.id) b.classList.add('active'); results.append(b);
        }
    }
    function history(entity) {
        const box = el('details'); box.append(el('summary', '变更历史'));
        const events = state.events.filter(event => !entity || event.effects.some(change => change.type === 'entity' && change.id === entity.id || change.type === 'claim' && change.after.entityId === entity.id));
        for (const event of [...events].reverse().slice(0, 100)) {
            const row = el('details'); row.append(el('summary', `第 ${event.version} 版 · ${event.title}`), el('p', `记录于 ${event.at}`, 'tk-record-note'));
            for (const change of event.effects) {
                if (entity && change.type === 'entity' && change.id !== entity.id) continue;
                if (change.type === 'entity') {
                    const before = change.before, after = change.after;
                    if (!before) row.append(el('p', `登记 ${after.name}`));
                    else {
                        if (before.name !== after.name) row.append(el('p', `名称：${before.name} → ${after.name}`));
                        for (const [key, record] of Object.entries(after.fields)) if (JSON.stringify(before.fields[key]) !== JSON.stringify(record)) row.append(el('p', `${after.name} · ${FIELD_LABELS[key] || key}：${before.fields[key] ? describe(before.fields[key].value) : '未登记'} → ${describe(record.value)}；${record.source.label}`));
                    }
                } else if (change.type === 'claim' && (!entity || change.after.entityId === entity.id)) row.append(el('p', `${FIELD_LABELS[change.after.field] || change.after.field}：${describe(change.after.value)} · ${change.after.status === 'pending' ? NATURES[change.after.nature] : { accepted: '已确认', dismissed: '已忽略', withdrawn: '来源已更新' }[change.after.status]}`));
            }
            row.append(button('从此版本建立分支', () => run(() => service.fork(state, event.version)))); box.append(row);
        }
        if (!events.length) box.append(el('p', '还没有变更记录。'));
        if (events.length > 100) box.append(el('p', '这里只显示最近 100 次变更，完整历史保存在导出文件中。', 'tk-record-note'));
        return box;
    }
    function renderDetail() {
        content.replaceChildren(); const entity = state.entities.find(e => e.id === selected);
        if (!entity) { content.append(history()); return; }
        content.append(heading(entity.name));
        const meta = el('p', `${KINDS[entity.kind]}${entity.aliases.length ? ` · 别名：${entity.aliases.join('、')}` : ''}`, 'tk-record-note'); content.append(meta);
        const actions = el('div', undefined, 'tk-record-actions'); actions.append(button('编辑名称', () => rename(entity)), button('新增记录', () => addRecord(entity))); content.append(actions);
        content.append(el('h4', '当前事实'));
        for (const [field, record] of Object.entries(entity.fields)) {
            const row = el('div', undefined, 'tk-record-value'); row.append(el('strong', FIELD_LABELS[field] || field));
            if (record.value?.entityId) row.append(button(describe(record.value), () => { selected = record.value.entityId; renderList(); renderDetail(); }));
            else row.append(el('p', describe(record.value)));
            row.append(el('small', `${record.source.label} · 第 ${record.version} 版`)); content.append(row);
        }
        if (!Object.keys(entity.fields).length) content.append(el('p', '尚无已确认状态。', 'tk-record-note'));
        const inventory = state.entities.filter(e => e.kind === 'item' && fieldValue(e, 'owner')?.entityId === entity.id);
        if (inventory.length) { content.append(el('h4', `持有物品（${inventory.length}）`)); for (const item of inventory) content.append(button(item.name, () => { selected = item.id; renderList(); renderDetail(); })); }
        const claims = state.claims.filter(c => c.entityId === entity.id && c.status === 'pending');
        if (claims.length) content.append(el('h4', `待处理记录（${claims.length}）`));
        for (const claim of claims) {
            const row = el('div', undefined, 'tk-record-value'); row.append(el('strong', `${FIELD_LABELS[claim.field] || claim.field} · ${NATURES[claim.nature]}`), el('p', describe(claim.value)), el('small', claim.source.label));
            const resolve = status => run(() => service.commit(service.command(state, [{ type: 'resolve', claimId: claim.id, status }], status === 'accepted' ? '确认来源记录' : '忽略候选记录')));
            row.append(button('确认为事实', () => resolve('accepted')), button('忽略', () => resolve('dismissed'))); content.append(row);
        }
        const origins = el('details'); origins.append(el('summary', '身份与来源'), el('p', `身份：${entity.id}`, 'tk-record-note'));
        origins.append(el('p', entity.source.label)); for (const binding of entity.bindings) origins.append(el('p', binding, 'tk-record-note')); content.append(origins, history(entity));
    }
    function download() {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob);
        const a = el('a'); a.href = url; a.download = `tavern-kitchen-world-${state.branchId}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function proposalText(proposal) {
        if (proposal.type === 'field') return `${state.entities.find(entity => entity.id === proposal.entityId)?.name || '原对象已不在当前分支'} · ${FIELD_LABELS[proposal.field] || proposal.field}：${proposal.before.present ? describe(proposal.before.value) : '未登记'} → ${describe(proposal.value)}`;
        if (proposal.type === 'story') return proposal.record.remove ? '撤回记录' : storyRecordText(proposal.record);
        return `新增${KINDS[proposal.kind]}：${proposal.name}`;
    }
    function proposalFields(view, reject) {
        const proposal = view.original, controls = [];
        controls.push(el('p', `原提案：${proposalText(proposal)} · ${NATURES[proposal.nature]}`));
        if (proposal.before) controls.push(el('p', `当前值：${view.before.present ? proposal.type === 'story' ? storyRecordText(view.before.value) : describe(view.before.value) : '未登记'}`, 'tk-record-note'));
        controls.push(el('p', `依据：第 ${proposal.evidence.floor + 1} 楼「${proposal.evidence.quote}」`, 'tk-record-note'));
        if (view.stale && !reject) controls.push(el('p', '世界已经变化。请核对当前值；确认后将以当前值为基线写入。', 'tk-record-note'));
        let readEdit = () => ({});
        if (!reject) {
            const nature = select(Object.entries(NATURES), proposal.nature);
            controls.push(label('记录性质', nature));
            if (proposal.type === 'field') {
                if (['owner', 'location', 'parent'].includes(proposal.field)) {
                    const choices = state.entities.filter(entity => proposal.field === 'owner' || entity.kind === 'place').map(entity => [entity.id, entity.name]);
                    const targetId = proposal.value?.entityId || '';
                    if (targetId && !choices.some(([id]) => id === targetId)) choices.push([targetId, '原关联对象已不在当前分支']);
                    const target = select([['', '未知／清空'], ...choices], targetId);
                    controls.push(label('新值', target)); readEdit = () => ({ value: target.value ? { entityId: target.value } : null, nature: nature.value });
                } else {
                    const type = select([['text', '文本'], ['number', '数值'], ['json', '复杂数据（JSON）']], typeof proposal.value === 'string' ? 'text' : typeof proposal.value === 'number' ? 'number' : 'json');
                    if (proposal.field === 'coins') { type.value = 'number'; type.disabled = true; }
                    const value = el('textarea', undefined, 'text_pole'); value.rows = 3; value.maxLength = 30000;
                    value.value = typeof proposal.value === 'string' ? proposal.value : JSON.stringify(proposal.value);
                    controls.push(label('值类型', type), label('新值', value));
                    readEdit = () => {
                        if (type.value === 'number' && !value.value.trim()) throw new Error('请填写新值，数值不能留空。');
                        return { value: type.value === 'text' ? value.value : type.value === 'number' ? Number(value.value) : JSON.parse(value.value), nature: nature.value };
                    };
                }
            } else if (proposal.type === 'entity') {
                const name = input('text', proposal.name); name.required = true; name.maxLength = 200;
                const kind = select(Object.entries(KINDS), proposal.kind), aliases = input('text', proposal.aliases.join('，'));
                controls.push(label('名称', name), label('类型', kind), label('别名（逗号分隔）', aliases));
                readEdit = () => ({ name: name.value, kind: kind.value, aliases: aliases.value.split(/[,，]/).map(value => value.trim()).filter(Boolean), nature: nature.value });
            } else {
                const record = proposal.record, previous = record.remove ? view.before.value || {} : record;
                const keys = { scene: ['location', 'situation', 'participants', 'tension', 'pendingBeat'], clock: ['label', 'date'],
                    person: ['name', 'presence', 'note'], knowledge: ['person', 'content', 'certainty', 'evidence', 'learnedAt'] }[record.kind]
                    || ['title', 'description', 'status', 'reason', 'due'];
                const remove = input('checkbox'); remove.checked = record.remove === true;
                controls.push(label('撤回这条记录', remove));
                const editors = keys.map(key => {
                    const choices = { presence: PRESENCE, certainty: BELIEFS, status: THREAD_STATUS }[key];
                    const control = choices ? select(Object.entries(choices), previous[key] || Object.keys(choices)[0]) : el('textarea', undefined, 'text_pole');
                    if (!choices) { control.rows = ['description', 'content', 'situation'].includes(key) ? 3 : 1; control.maxLength = 2000;
                        control.value = key === 'participants' ? (previous[key] || []).join('，') : previous[key] || ''; }
                    controls.push(label(`${STORY_FIELDS[key] || key}${key === 'participants' ? '（逗号分隔）' : ''}`, control));
                    return [key, control];
                });
                readEdit = () => ({ nature: nature.value, record: remove.checked ? { id: record.id, kind: record.kind, remove: true }
                    : { id: record.id, kind: record.kind, ...Object.fromEntries(editors.map(([key, control]) => [key,
                        key === 'participants' ? control.value.split(/[,，]/).map(value => value.trim()).filter(Boolean) : control.value])) } });
            }
            controls.push(el('p', '事实写入当前状态；传闻保留为待确认记录，认知保留持有人与性质，计划保留状态和期限，创作候选不会变成已发生的场景。', 'tk-record-note'));
        }
        return { controls, readEdit };
    }
    function proposalEditor(view, reject = false, indices = service.proposalGroup?.(state, view.requestId, view.index) || [view.index]) {
        const expected = state;
        const views = indices.map(index => index === view.index ? view : service.proposalView(state, view.requestId, index));
        const entries = views.map(value => proposalFields(value, reject)), controls = [];
        if (views.length > 1) controls.push(el('p', `这 ${views.length} 条关联变化将一起${reject ? '拒绝' : '保存'}；任何一条未通过检查，整组都不会写入。`, 'tk-record-note'));
        entries.forEach((entry, index) => {
            if (entries.length === 1) controls.push(...entry.controls);
            else { const group = el('fieldset'); group.append(el('legend', `变化 ${index + 1}`), ...entry.controls); controls.push(group); }
        });
        const reason = el('textarea', undefined, 'text_pole'); reason.rows = 2; reason.maxLength = 1000;
        controls.push(label('处理说明（可选）', reason));
        form(reject ? '拒绝世界变化提案' : '核对世界变化提案', controls,
            () => ({ reason: reason.value, items: Object.fromEntries(views.map((value, index) => [value.index,
                { edit: reject ? undefined : entries[index].readEdit(), reason: reason.value, rechecked: value.stale, view: value }])) }),
            { saveLabel: reject ? '拒绝提案' : '确认并保存', createCommand: options => indices.length === 1
                ? service.proposalCommand(expected, view.requestId, view.index, reject ? 'rejected' : 'accepted', options.items[view.index])
                : service.proposalBatchCommand(expected, view.requestId, indices, reject ? 'rejected' : 'accepted', options) });
    }
    function proposalQueue() {
        const updates = worldUpdates(state).filter(record => (record.status !== 'retracted' || record.reviews?.length) && (record.update.proposals.length || record.update.conflicts.length));
        if (!updates.length) return null;
        const box = el('details', undefined, 'tk-record-proposals');
        box.dataset.proposalKey = 'queue';
        const count = updates.reduce((sum, record) => sum + (record.status === 'retracted' ? 0 : record.update.proposals.length - (record.reviews?.length || 0)), 0);
        box.append(el('summary', `世界变化提案（${count} 条）`), el('p', '明确且无冲突的关联变化自动一起写入；其余留在这里核对、修改或拒绝。原提案、来源和处理回执保留。', 'tk-record-note'));
        for (const record of [...updates].reverse()) {
            const update = record.update, row = el('details'); row.dataset.proposalKey = update.requestId || 'legacy-batch';
            const remaining = update.proposals.length - (record.reviews?.length || 0);
            const batchStatus = record.status === 'retracted' ? '来源已撤回' : update.conflicts.length ? '有冲突待核对'
                : !remaining ? '已处理' : record.status === 'stale' ? '世界已变化，需重新核对' : '待确认';
            row.append(el('summary', `第 ${update.source.start + 1}–${update.source.end + 1} 楼 · ${batchStatus}`));
            if (record.status === 'retracted') row.append(el('p', '来源已撤回。已写入的世界变化仍有回执，请核对历史或切回变更前的分支。', 'tk-record-note'));
            if (record.status !== 'retracted' && service.proposalBatchCommand) {
                const turns = new Map();
                update.proposals.forEach((proposal, index) => {
                    if (record.reviews?.some(review => review.index === index)) return;
                    const turn = proposalTurn(state, proposal); if (!turn) return;
                    if (!turns.has(turn.id)) turns.set(turn.id, []);
                    turns.get(turn.id).push(index);
                });
                for (const indices of turns.values()) if (indices.length > 1) row.append(button(`核对本轮全部变化（${indices.length} 条）`, () =>
                    proposalEditor(service.proposalView(state, update.requestId, indices[0]), false, indices)));
            }
            for (const [index, proposal] of update.proposals.entries()) {
                const item = el('details'); item.dataset.proposalKey = `${update.requestId}/${index}`;
                const review = record.reviews?.find(value => value.index === index);
                const reviewStatus = review ? review.action === 'rejected' ? '已拒绝' : review.mode === 'automatic' ? '已自动写入'
                    : { applied: '已写入', claim: '已登记待确认记录', candidate: '已保留候选' }[review.outcome] : '待确认';
                item.append(el('summary', `${proposal.type === 'field' ? FIELD_LABELS[proposal.field] || proposal.field : proposal.type === 'entity' ? proposal.name : '剧情状态'} · ${reviewStatus}${review?.edited ? '（已修改）' : ''}`));
                const nature = proposal.nature === 'established_fact' ? '事实变化提案' : NATURES[proposal.nature];
                if (proposal.type === 'field') {
                    const entity = state.entities.find(entity => entity.id === proposal.entityId);
                    item.append(el('p', `${entity?.name || '原对象已不在当前分支'} · ${FIELD_LABELS[proposal.field] || proposal.field}：${proposal.before.present ? describe(proposal.before.value) : '未登记'} → ${describe(proposal.value)} · ${nature}`));
                    if (entity) item.append(button('查看对象', () => { selected = entity.id; editing = false; renderList(); renderDetail(); }));
                } else item.append(el('p', `${proposalText(proposal)} · ${nature}`));
                item.append(el('p', `依据：第 ${proposal.evidence.floor + 1} 楼「${proposal.evidence.quote}」`, 'tk-record-note'));
                if (review) {
                    if (review.proposal) item.append(el('p', `确认内容：${proposalText(review.proposal)} · ${NATURES[review.proposal.nature]}`));
                    item.append(el('p', `第 ${review.worldVersion} 版 · ${reviewStatus}${review.reason ? ` · ${review.reason}` : ''}`, 'tk-record-note'));
                } else if (record.status !== 'retracted' && update.requestId && service.proposalView) {
                    const view = service.proposalView(state, update.requestId, index), expected = state;
                    const group = service.proposalGroup?.(state, update.requestId, index) || [index];
                    const actions = el('div', undefined, 'tk-record-actions'); let command;
                    if (group.length > 1) {
                        item.append(el('p', `关联组 ${proposal.groupId} · 共 ${group.length} 条变化，须一起处理。`, 'tk-record-note'));
                        actions.append(button('核对并一起确认', () => proposalEditor(view)));
                    } else if (view.stale) actions.append(button('核对并确认', () => proposalEditor(view)));
                    else actions.append(button('确认写入', () => run(() => { command ||= service.proposalCommand(expected, update.requestId, index, 'accepted', { view }); return service.commit(command); })));
                    actions.append(button('修改', () => proposalEditor(view)), button('拒绝', () => proposalEditor(view, true))); item.append(actions);
                }
                row.append(item);
            }
            for (const conflict of update.conflicts) row.append(el('p', `待核对：${conflict.description}；第 ${conflict.evidence.floor + 1} 楼「${conflict.evidence.quote}」`));
            if (update.acknowledgedReceipts.length) row.append(el('p', `已核对 ${update.acknowledgedReceipts.length} 条执行回执，未重复执行。`, 'tk-record-note'));
            box.append(row);
        }
        return box;
    }
    function show(next) {
        if (!root || !next) return;
        const open = new Set([...root.querySelectorAll('details[data-proposal-key]')].filter(element => element.open).map(element => element.dataset.proposalKey));
        state = next; editing = false; root.replaceChildren();
        const pending = state.claims.filter(claim => claim.status === 'pending').length;
        status = el('p', `第 ${state.version} 版 · ${state.entities.length} 个对象${pending ? ` · ${pending} 条待确认` : ''}`, 'tk-record-status'); status.setAttribute('role', 'status');
        const toolbar = el('div', undefined, 'tk-record-actions tk-record-primary-actions');
        toolbar.append(button('新增对象', createEntity));
        const more = el('details', undefined, 'tk-record-more');
        const moreActions = el('div', undefined, 'tk-record-actions');
        moreActions.append(button('同步来源', () => run(sync)), button('登记交易', purchase), button('重新加载', () => run(() => service.read())));
        more.append(el('summary', '更多操作'), moreActions); toolbar.append(more);
        const search = input('search', query); search.placeholder = '搜索名称或别名'; search.setAttribute('aria-label', '搜索世界档案');
        const filter = select([['', '全部类型'], ...Object.entries(KINDS)], kind); filter.setAttribute('aria-label', '档案类型');
        const filters = el('div', undefined, 'tk-record-filters'); filters.append(search, filter);
        results = el('div', undefined, 'tk-record-results'); content = el('section'); content.setAttribute('aria-label', '档案详情');
        search.addEventListener('input', () => { query = search.value; renderList(); }); filter.addEventListener('change', () => { kind = filter.value; renderList(); });
        const backups = el('details'); backups.append(el('summary', '存档管理'), el('p', '档案保存在当前浏览器／应用。导出包含全部管理记录；恢复会建立新分支，原分支仍保留。管理档案中的修改暂不回写旧变量或地图；来源更新先进入待处理记录。', 'tk-record-note'), button('导出完整档案', download));
        const file = input('file'); file.accept = '.json,application/json'; file.setAttribute('aria-label', '选择世界档案备份');
        file.addEventListener('change', () => {
            const chosen = file.files?.[0]; if (!chosen) return;
            const expected = state;
            run(async () => { if (chosen.size > 20 * 1024 * 1024) throw new Error('备份超过 20 MB'); return service.restore(JSON.parse(await chosen.text()), expected); });
        }); backups.append(label('恢复到新分支', file));
        const branchList = el('div', undefined, 'tk-record-actions');
        backups.append(button('查看分支', () => {
            const token = epoch, identity = getIdentity();
            service.branches().then(branches => {
                if (token !== epoch || identity !== getIdentity()) return;
                branchList.replaceChildren();
                for (const branch of branches) {
                    const active = branch.branchId === state.branchId;
                    const b = button(`${active ? '当前 · ' : '切换 · '}${branch.title} · 第 ${branch.version} 版 · ${branch.branchId.slice(-6)}`, () => run(() => service.selectBranch(branch.branchId, state)));
                    b.disabled = active; branchList.append(b);
                }
            }).catch(error => { if (token === epoch) { status.textContent = error.message; status.setAttribute('role', 'alert'); } });
        }), branchList);
        root.append(status, toolbar); const proposals = proposalQueue(); if (proposals) root.append(proposals);
        root.append(filters, results, content, backups); renderList(); renderDetail();
        for (const detail of root.querySelectorAll('details[data-proposal-key]')) detail.open = open.has(detail.dataset.proposalKey);
    }
    return {
        mount(parent) { if (!root) { root = el('div', undefined, 'tk-world-records'); root.setAttribute('aria-label', '世界管理'); } if (root.parentElement !== parent) parent.append(root); },
        show,
        isEditing: () => editing || busy,
        empty() { root.replaceChildren(el('p', '选择一段对话后，可以建立和管理这段故事的世界档案。', 'tk-record-note')); },
        reset() { epoch++; busy = false; editing = false; state = null; selected = ''; query = ''; kind = ''; root?.replaceChildren(); },
    };
}
