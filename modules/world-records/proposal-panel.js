import { FIELD_LABELS, KINDS, NATURES } from './domain.js';
import { isPrivateStoryField } from './authority.js';
import { worldUpdates } from './update-context.js';
import { STORY_FIELDS, STORY_KINDS, PRESENCE, BELIEFS, THREAD_STATUS, storyRecordText } from '../story-state/records.js';

// The queue is a small part of the existing situation page, not a world editor.
export function createProposalPanel({ service, getIdentity }) {
    let root, doc, state, editing = false, busy = false, epoch = 0, showPrivate = false, message = '';
    const el = (tag, text, className) => {
        const node = doc.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (className) node.className = className;
        return node;
    };
    const button = (title, action) => {
        const node = el('button', title, 'menu_button'); node.type = 'button'; node.addEventListener('click', action); return node;
    };
    const input = (type, value = '') => {
        const node = el('input', undefined, 'text_pole'); node.type = type; node.value = value; return node;
    };
    const select = (choices, value) => {
        const node = el('select', undefined, 'text_pole');
        for (const [key, title] of choices) { const option = el('option', title); option.value = key; node.append(option); }
        node.value = value ?? ''; return node;
    };
    const label = (title, control) => {
        const node = el('label', undefined, 'tk-proposal-field');
        node.append(el('span', title), control); control.setAttribute('aria-label', title); return node;
    };
    const name = id => state.entities.find(item => item.id === id)?.name || '未知对象';
    const format = value => {
        if (value && typeof value === 'object' && typeof value.entityId === 'string') {
            const extras = Object.entries(value).filter(([key]) => key !== 'entityId').map(([key, item]) => `${key}：${item}`);
            return [name(value.entityId), ...extras].join(' · ');
        }
        return typeof value === 'string' ? value : value == null ? '无' : JSON.stringify(value);
    };
    const titleOf = proposal => proposal.type === 'field'
        ? `${name(proposal.entityId)} · ${FIELD_LABELS[proposal.field] || proposal.field}`
        : proposal.type === 'entity' ? proposal.name
            : `${STORY_KINDS[proposal.record.kind] || '剧情记录'} · ${proposal.record.title || proposal.record.name || proposal.record.person || ''}`;
    const sensitive = (proposal, record, view) => {
        if (['creative_proposal','hypothesis','intention'].includes(proposal.nature)
            || proposal.type === 'field' && isPrivateStoryField(proposal.field)
            || proposal.type === 'story') return true;
        const text = record.update.source.messages.find(item => item.floor === proposal.evidence.floor)?.text || '';
        const disclosed = value => {
            if (value == null || value === '') return true;
            if (typeof value === 'number') {
                const chinese = ['零','一','二','三','四','五','六','七','八','九','十'][value];
                const numeric = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                return new RegExp(`(?<![0-9.])${numeric}(?![0-9.])`).test(text)
                    || !!chinese && new RegExp(`(?<![零一二三四五六七八九十百千万亿0-9])${chinese}(?![零一二三四五六七八九十百千万亿0-9])`).test(text);
            }
            if (typeof value === 'string') return text.includes(value.trim());
            if (value && typeof value === 'object' && typeof value.entityId === 'string') {
                const entity = state.entities.find(item => item.id === value.entityId);
                return !!entity && disclosed(entity.name)
                    && Object.entries(value).filter(([key]) => key !== 'entityId').every(([,part]) => disclosed(part));
            }
            return false;
        };
        if (proposal.type === 'entity') return !disclosed(proposal.name) || proposal.aliases.some(alias => !disclosed(alias));
        if (proposal.type === 'field') {
            const target = state.entities.find(item => item.id === proposal.entityId);
            return !target || !disclosed(target.name) || !Object.hasOwn(FIELD_LABELS,proposal.field) && !disclosed(proposal.field)
                || !disclosed(proposal.value) || proposal.before?.present && !disclosed(proposal.before.value)
                || view?.before?.present && !disclosed(view.before.value);
        }
        return true;
    };
    function groups(next) {
        const result = [];
        for (const record of [...worldUpdates(next)].reverse()) {
            if (record.status === 'retracted') continue;
            const seen = new Set();
            for (const [index, proposal] of record.update.proposals.entries()) {
                if (proposal.type === 'story' && proposal.record.kind === 'scene' || record.reviews?.some(review => review.index === index)) continue;
                const indices = service.proposalGroup(next, record.update.requestId, index);
                const key = indices.join(','); if (seen.has(key)) continue; seen.add(key);
                const proposals = indices.map(value => record.update.proposals[value]);
                let views;
                try { views = indices.map(value => service.proposalView(next,record.update.requestId,value)); }
                catch { views = []; }
                result.push({ record, indices, proposals, private: views.length !== proposals.length || proposals.some((item,offset) => sensitive(item,record,views[offset])), key: `${record.update.requestId}/${key}` });
            }
        }
        return result;
    }
    function fields(view, rejecting) {
        const proposal = view.original, nodes = [];
        nodes.push(el('p', `原提案：${titleOf(proposal)} · ${NATURES[proposal.nature] || proposal.nature}`));
        if (proposal.before) nodes.push(el('p', `当前值：${view.before?.present ? proposal.type === 'story' ? storyRecordText(view.before.value) : format(view.before.value) : '未记录'}`, 'tk-record-note'));
        nodes.push(el('p', `依据：第 ${proposal.evidence.floor + 1} 楼「${proposal.evidence.quote}」`, 'tk-record-note'));
        if (view.stale && !rejecting) nodes.push(el('p', '世界已变化，请核对当前值；确认后以当前值为基线。', 'tk-record-note'));
        let read = () => ({});
        if (rejecting) return { nodes, read };
        const nature = select(Object.entries(NATURES), proposal.nature); nodes.push(label('记录性质', nature));
        if (proposal.type === 'field') {
            if (['owner','location','parent','保管人','使用人'].includes(proposal.field)
                || proposal.value && typeof proposal.value === 'object' && !Array.isArray(proposal.value) && typeof proposal.value.entityId === 'string') {
                const candidates = state.entities.filter(item => !['location','parent'].includes(proposal.field) || item.kind === 'place');
                const target = select([['','无／清空'], ...candidates.map(item => [item.id,item.name])], proposal.value?.entityId || '');
                nodes.push(label('新值',target));
                const extra = Object.entries(proposal.value || {}).filter(([key,value]) => key !== 'entityId' && typeof value === 'string').map(([key,value]) => {
                    const control = input('text',value); nodes.push(label(key === 'role' ? '关系身份' : key,control)); return [key,control];
                });
                read = () => ({nature:nature.value,value:target.value ? { ...(proposal.value || {}), entityId:target.value,
                    ...Object.fromEntries(extra.map(([key,control]) => [key,control.value])) } : null});
            } else {
                const type = select([['text','文本'],['number','数值'],['json','其他数据']], typeof proposal.value === 'string' ? 'text' : typeof proposal.value === 'number' ? 'number' : 'json');
                if (proposal.field === 'coins') { type.value = 'number'; type.disabled = true; }
                const value = el('textarea', undefined, 'text_pole'); value.rows = 3; value.maxLength = 30000;
                value.value = typeof proposal.value === 'string' ? proposal.value : JSON.stringify(proposal.value);
                nodes.push(label('值类型',type),label('新值',value));
                read = () => {
                    if (type.value === 'number' && !value.value.trim()) throw new Error('请填写新值，数值不能留空。');
                    return {nature:nature.value,value:type.value === 'text' ? value.value : type.value === 'number' ? Number(value.value) : JSON.parse(value.value)};
                };
            }
        } else if (proposal.type === 'entity') {
            const entityName = input('text',proposal.name); entityName.required = true; entityName.maxLength = 200;
            const kind = select(Object.entries(KINDS),proposal.kind), aliases = input('text',proposal.aliases.join('，'));
            nodes.push(label('名称',entityName),label('类型',kind),label('别名（逗号分隔）',aliases));
            read = () => ({nature:nature.value,name:entityName.value,kind:kind.value,aliases:aliases.value.split(/[,，]/).map(value=>value.trim()).filter(Boolean)});
        } else {
            const record = proposal.record, original = record.remove ? view.before?.value || record : record;
            const remove = input('checkbox'); remove.checked = record.remove === true; nodes.push(label('撤回这条记录',remove));
            const editors = Object.entries(original).filter(([key]) => !['id','kind','remove'].includes(key) && !key.startsWith('_')).map(([key,value]) => {
                const choices = {presence:PRESENCE,certainty:BELIEFS,status:THREAD_STATUS}[key];
                const control = choices ? select(Object.entries(choices),value) : el('textarea', undefined, 'text_pole');
                if (!choices) { control.rows = ['description','content'].includes(key) ? 3 : 1; control.value = Array.isArray(value) ? value.join('，') : String(value ?? ''); }
                const title = STORY_FIELDS[key] || {flavor:'类别',category:'类别',period:'时节',phase:'阶段',relatedId:'关联局势'}[key] || key;
                nodes.push(label(title + (Array.isArray(value) ? '（逗号分隔）' : ''),control));
                return {key,control,array:Array.isArray(value)};
            });
            read = () => ({nature:nature.value,record:remove.checked ? {id:record.id,kind:record.kind,remove:true}
                : {id:record.id,kind:record.kind,...Object.fromEntries(editors.map(({key,control,array}) => [key,
                    array ? control.value.split(/[,，]/).map(value=>value.trim()).filter(Boolean) : control.value]))}});
        }
        return {nodes,read};
    }
    function run(task, status, controls) {
        if (busy) return;
        busy = true; const token = epoch, owner = getIdentity();
        status.textContent = '正在保存…'; status.setAttribute('role','status');
        const disabled = controls.map(node => node.disabled); controls.forEach(node => { node.disabled = true; });
        Promise.resolve().then(task).then(result => {
            if (token !== epoch || owner !== getIdentity()) return;
            editing = false; busy = false; message = `已保存 · 第 ${result.state.version} 版`; show(result.state);
        }).catch(error => {
            if (token !== epoch || owner !== getIdentity()) return;
            status.setAttribute('role','alert'); status.textContent = error?.message || '保存失败，请重试';
        }).finally(() => { if (token === epoch) { busy = false; controls.forEach((node,index) => { node.disabled = disabled[index]; }); } });
    }
    function edit(group, container, rejecting, actions) {
        if (busy) return;
        const expected = state, views = group.indices.map(index => service.proposalView(expected,group.record.update.requestId,index));
        editing = true; actions.hidden = true;
        const form = el('form', undefined, 'tk-proposal-form');
        const entries = views.map(view => fields(view,rejecting));
        if (entries.length > 1) form.append(el('p', `这 ${entries.length} 条关联变化会一起${rejecting ? '拒绝' : '保存'}。`, 'tk-record-note'));
        entries.forEach((entry,index) => {
            const section = el('fieldset'); if (entries.length > 1) section.append(el('legend',`变化 ${index + 1}`));
            section.append(...entry.nodes); form.append(section);
        });
        const reason = el('textarea',undefined,'text_pole'); reason.rows = 2; reason.maxLength = 1000;
        form.append(label('处理说明（可选）',reason));
        const status = el('p',undefined,'tk-record-note'); status.setAttribute('role','status');
        const save = el('button', rejecting ? '拒绝变化' : '确认并保存','menu_button'); save.type = 'submit';
        const cancel = button('取消',() => {
            if (busy) return;
            busy = true; const token = epoch, owner = getIdentity();
            service.read().then(next => {
                if (token !== epoch || owner !== getIdentity()) return;
                editing = false; busy = false; show(next);
            }).catch(error => { if (token === epoch && owner === getIdentity()) { status.setAttribute('role','alert'); status.textContent = error.message; } })
                .finally(() => { if (token === epoch) busy = false; });
        });
        const formActions = el('div',undefined,'tk-proposal-actions'); formActions.append(save,cancel); form.append(formActions,status);
        let command;
        form.addEventListener('input',() => { command = null; }); form.addEventListener('change',() => { command = null; });
        form.addEventListener('submit',event => {
            event.preventDefault();
            run(() => {
                const items = Object.fromEntries(views.map((view,index) => [view.index,
                    {view,rechecked:view.stale,reason:reason.value,...(!rejecting && {edit:entries[index].read()})}]));
                command ||= group.indices.length === 1
                    ? service.proposalCommand(expected,group.record.update.requestId,group.indices[0],rejecting ? 'rejected' : 'accepted',items[group.indices[0]])
                    : service.proposalBatchCommand(expected,group.record.update.requestId,group.indices,rejecting ? 'rejected' : 'accepted',{reason:reason.value,items});
                return service.commit(command);
            },status,[...form.querySelectorAll('button,input,select,textarea')]);
        });
        container.replaceChildren(form); form.querySelector('input,select,textarea')?.focus();
    }
    function show(next) {
        if (!root || !next || editing || busy) return;
        if (state && (state.worldId !== next.worldId || state.branchId !== next.branchId)) showPrivate = false;
        state = next;
        const open = new Set([...root.querySelectorAll('details[open][data-proposal-key]')].map(node => node.dataset.proposalKey));
        root.replaceChildren();
        const pending = groups(next);
        if (!pending.length && !message) { root.hidden = true; return; }
        root.hidden = false;
        if (message) { const status = el('p',message,'tk-record-note'); status.setAttribute('role','status'); root.append(status); message = ''; }
        if (!pending.length) return;
        const queue = el('details',undefined,'tk-proposal-queue'); queue.dataset.proposalKey = 'queue'; queue.open = open.has('queue');
        queue.append(el('summary','待核对的世界变化'));
        const hiddenLabel = el('label',undefined,'tk-proposal-private'), hiddenToggle = input('checkbox');
        hiddenToggle.checked = showPrivate; hiddenLabel.append(hiddenToggle,'显示未直接证实或幕后变化（可能涉及剧透）');
        hiddenToggle.addEventListener('change',() => { showPrivate = hiddenToggle.checked; show(state); }); queue.append(hiddenLabel);
        let visible = 0;
        for (const group of pending) {
            if (group.private && !showPrivate) continue;
            visible++;
            const row = el('details',undefined,'tk-proposal-row'); row.dataset.proposalKey = group.key; row.open = open.has(group.key);
            const floor = group.proposals[0].evidence.floor + 1;
            row.append(el('summary',`第 ${floor} 楼 · ${titleOf(group.proposals[0])}${group.proposals.length > 1 ? ` 等 ${group.proposals.length} 项` : ''}`));
            let views;
            try { views = group.indices.map(index => service.proposalView(state,group.record.update.requestId,index)); }
            catch (error) { row.append(el('p',error.message,'tk-record-note')); queue.append(row); continue; }
            for (const [index,proposal] of group.proposals.entries()) {
                const value = proposal.type === 'field' ? format(proposal.value) : proposal.type === 'story' ? storyRecordText(proposal.record) : proposal.name;
                row.append(el('p', `${titleOf(proposal)}：${value} · ${NATURES[proposal.nature] || proposal.nature}`),
                    el('p',`依据：第 ${proposal.evidence.floor + 1} 楼「${proposal.evidence.quote}」`,'tk-record-note'));
                if (proposal.before) row.append(el('p', `当前值：${views[index].before?.present
                    ? proposal.type === 'story' ? storyRecordText(views[index].before.value) : format(views[index].before.value) : '未记录'}`,'tk-record-note'));
            }
            const actions = el('div',undefined,'tk-proposal-actions'), area = el('div');
            const status = el('p',undefined,'tk-record-note'); status.setAttribute('role','status');
            if (views.some(view => view.stale)) {
                actions.append(button('核对并确认',() => edit(group,area,false,actions)));
            } else {
                const expected = state; let command;
                actions.append(button('确认写入',() => run(() => {
                    command ||= group.indices.length === 1
                        ? service.proposalCommand(expected,group.record.update.requestId,group.indices[0],'accepted',{view:views[0]})
                        : service.proposalBatchCommand(expected,group.record.update.requestId,group.indices,'accepted',
                            {items:Object.fromEntries(views.map(view => [view.index,{view}]))});
                    return service.commit(command);
                },status,[...actions.querySelectorAll('button')] )));
            }
            actions.append(button('修改',() => edit(group,area,false,actions)), button('拒绝',() => edit(group,area,true,actions)));
            row.append(actions,status,area); queue.append(row);
        }
        if (!visible) queue.append(el('p','没有可展示的待核对变化。','tk-record-note'));
        root.append(queue);
    }
    return {
        mount(target) { root = target; doc = target.ownerDocument; root.classList.add('tk-world-proposals'); },
        show,
        isEditing: () => editing || busy,
        reset() { epoch++; editing = busy = showPrivate = false; message = ''; if (root) { root.replaceChildren(); root.hidden = true; } },
    };
}
