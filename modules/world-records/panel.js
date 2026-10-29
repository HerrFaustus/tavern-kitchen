import { createIdentifier } from '../../shared/common/identifier.js';
import { KINDS, NATURES, FIELD_LABELS, fieldValue } from './domain.js';

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
    function form(title, fields, build) {
        editing = true; content.replaceChildren(heading(title));
        const f = el('form'); for (const field of fields) f.append(field);
        const save = el('button', '保存', 'menu_button'); save.type = 'submit';
        const actions = el('div', undefined, 'tk-record-actions'); actions.append(save, button('取消', () => { editing = false; show(state); })); f.append(actions);
        let command;
        f.addEventListener('input', () => { command = null; }); f.addEventListener('change', () => { command = null; });
        f.addEventListener('submit', event => { event.preventDefault(); run(() => { command ||= service.command(state, build(), title); return service.commit(command); }); });
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
    function show(next) {
        if (!root || !next) return;
        state = next; editing = false; root.replaceChildren();
        status = el('p', `第 ${state.version} 版 · ${state.entities.length} 个对象`, 'tk-record-status'); status.setAttribute('role', 'status');
        const toolbar = el('div', undefined, 'tk-record-actions');
        toolbar.append(button('新增', createEntity), button('同步来源', () => run(sync)), button('登记交易', purchase), button('重新加载', () => run(() => service.read())));
        const search = input('search', query); search.placeholder = '搜索名称或别名'; search.setAttribute('aria-label', '搜索世界档案');
        const filter = select([['', '全部类型'], ...Object.entries(KINDS)], kind); filter.setAttribute('aria-label', '档案类型');
        results = el('div', undefined, 'tk-record-results'); content = el('section'); content.setAttribute('aria-label', '档案详情');
        search.addEventListener('input', () => { query = search.value; renderList(); }); filter.addEventListener('change', () => { kind = filter.value; renderList(); });
        const backups = el('details'); backups.append(el('summary', '存档管理'), el('p', '档案保存在当前浏览器／应用。导出包含全部管理记录；恢复会建立新分支，原分支仍保留。', 'tk-record-note'), button('导出完整档案', download));
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
        root.append(status, el('p', '管理档案中的修改暂不回写旧变量或地图；来源更新先进入待处理记录。', 'tk-record-note'), toolbar, search, filter, results, content, backups); renderList(); renderDetail();
    }
    return {
        mount(parent) { if (!root) { root = el('div', undefined, 'tk-world-records'); root.setAttribute('aria-label', '世界管理'); } if (root.parentElement !== parent) parent.append(root); },
        show,
        isEditing: () => editing || busy,
        empty() { root.replaceChildren(el('p', '选择一段对话后，可以建立和管理这段故事的世界档案。', 'tk-record-note')); },
        reset() { epoch++; busy = false; editing = false; state = null; selected = ''; query = ''; kind = ''; root?.replaceChildren(); },
    };
}
