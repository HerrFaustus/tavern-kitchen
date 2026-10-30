import { EMPTY_FLOOR_PAYLOAD, FIELD_LABELS, floorPanelModel } from './panel-model.js';
import { observeBackgroundTask } from '../../../shared/common/async-errors.js';

const choices = { presence: { present: '在场', nearby: '附近', away: '离场', unknown: '未知' },
    memoryRole: { 具体经历: '具体经历', 状态变化: '状态变化', 约定承诺: '约定承诺', 信息揭示: '信息揭示', 偏好习惯: '偏好习惯' },
    certainty: { known: '已知', believed: '相信／误解', uncertain: '怀疑' },
    status: { open: '未结', done: '完成', cancelled: '取消', failed: '失败' },
    weight: { 核心: '核心', 重要: '重要', 一般: '一般' } };
const arrays = new Set(['participants', 'causedBy', 'from']);
const booleans = new Set(['isState', 'retracted']);
const iconNames = { 人物: 'user', 认知: 'brain', 场景: 'location-dot', 故事时钟: 'clock', 剧情: 'book-open',
    场景锚点: 'bookmark',
    物品: 'box-open', 变量: 'sliders', 计划: 'list-check', 悬念: 'circle-question', 局面: 'flag', 世界: 'globe' };

export function createFloorPanel({ doc, floor, updateFloor, extractFloor, openMemory, schedule }) {
    const root = doc.createElement('article'); root.className = 'tk-floor-summary tk-fp';
    let model, expanded = false, editKey = null, busy = false, confirmingDelete = false, confirmingExtract = false, signature = '', error = '';
    const run = action => observeBackgroundTask(act(action), { source: import.meta.url, operation: 'floor-edit' });
    function element(tag, cls, text) {
        const node = doc.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node;
    }
    function button(text, action, cls = '', title = text) {
        const node = element('button', `tk-fp-button ${cls}`, text); node.type = 'button'; node.title = title;
        node.addEventListener('click', action); return node;
    }
    function icon(name) { const node = element('i', `fa-solid fa-${name}`); node.setAttribute('aria-hidden', 'true'); return node; }
    const head = element('header', 'tk-fp-head');
    const toggle = button('', () => { expanded = !expanded; confirmingDelete = false; updateExpanded(); }, 'tk-fp-toggle', '展开本楼总结');
    const top = element('span', 'tk-fp-head-top');
    const number = element('span', 'tk-fp-floor', `#${floor + 1}`);
    const clock = element('span', 'tk-fp-head-time'); const status = element('span', 'tk-fp-status');
    const preview = element('span', 'tk-fp-preview');
    top.append(number, clock, status); toggle.append(top, preview);
    const omit = button('', () => run(async () => {
        const empty = !model.payload.summary || model.entry?.empty;
        const payload = empty ? { ...EMPTY_FLOOR_PAYLOAD, summary: '（未提供摘要）' } : model.payload;
        await updateFloor(floor, { payload, omitted: !model.entry?.omitted, deleted: empty, empty }, model.source.digest);
    }), 'tk-fp-icon', '标为番外：不计入剧情记忆');
    omit.append(icon('wand-magic-sparkles')); omit.setAttribute('aria-label', omit.title);
    const doExtract = async () => {
        const result = await extractFloor(floor);
        if (!result?.committed && !result?.unchanged) throw new Error(result?.error || '主回复未附带总结，请在下方补写或用酒馆重新生成本楼。');
    };
    const extract = button('', () => {
        if (model.entry && !model.entry.deleted || model.staged || editKey) {
            confirmingExtract = true; confirmingDelete = false; expanded = true; renderExtractConfirmation(); updateExpanded();
        } else run(doExtract);
    }, 'tk-fp-icon', '重新提取主回复附带的总结（不调用 API）');
    extract.append(icon('magnifying-glass')); extract.setAttribute('aria-label', extract.title);
    head.append(toggle, omit, extract);
    const drawer = element('div', 'tk-fp-drawer'); const inner = element('div', 'tk-fp-drawer-inner');
    const body = element('div', 'tk-fp-body'); const notice = element('p', 'tk-fp-notice'); notice.setAttribute('role', 'status');
    const extractConfirmation = element('div', 'tk-fp-extract-confirm');
    const content = element('div', 'tk-fp-content'); body.append(notice, extractConfirmation, content); inner.append(body); drawer.append(inner); root.append(head, drawer);
    function renderExtractConfirmation() {
        extractConfirmation.replaceChildren(); extractConfirmation.hidden = !confirmingExtract;
        if (!confirmingExtract) return;
        extractConfirmation.append(element('p', '', '重新提取会用主回复中的原始总结替换本楼摘要与变化，覆盖人工修改。继续？'),
            button('取消重新提取', () => { confirmingExtract = false; renderExtractConfirmation(); }, 'menu_button'),
            button('确认重新提取', () => run(doExtract), 'menu_button'));
    }
    function updateExpanded() {
        root.classList.toggle('is-expanded', expanded); drawer.classList.toggle('is-open', expanded); drawer.inert = !expanded;
        toggle.setAttribute('aria-expanded', String(expanded));
        if (!expanded) { editKey = null; confirmingExtract = false; renderContent(); }
        renderExtractConfirmation();
    }
    function updateNotice() {
        notice.textContent = error || model?.error || (model?.entry?.omitted ? '此楼为番外，不计入剧情记忆。取消番外后恢复。'
            : model?.pending && model.payload.summary ? '以下内容尚未写入。可逐条审查、编辑，再确认写入。' : '');
        notice.hidden = !notice.textContent;
    }
    async function act(action) {
        if (busy) return;
        busy = true; error = ''; updateNotice();
        for (const node of root.querySelectorAll('button,input,textarea,select')) node.disabled = true;
        try { await action(); editKey = null; confirmingDelete = false; confirmingExtract = false; signature = ''; }
        catch (caught) { error = caught.message; expanded = true; }
        finally { busy = false; for (const node of root.querySelectorAll('button,input,textarea,select')) node.disabled = false;
            updateNotice(); updateExpanded(); schedule(); }
    }
    function commitPayload(payload, extra = {}) {
        return updateFloor(floor, { payload, stage: model.pending && !model.entry, reviewed: true, deleted: false, empty: false, ...extra }, model.source.digest);
    }
    function editor(key, values, fieldNames, save, remove) {
        editKey = key;
        const form = element('form', 'tk-fp-editform'); const controls = new Map();
        for (const name of fieldNames) {
            if (name === 'edges') {
                const edges = values.edges || [];
                for (let i = 0; i < 3; i++) for (const [key, label] of [['s', '发起者'], ['r', '行动'], ['t', '对象']]) {
                    const row = element('label', 'tk-fp-editrow'); row.append(element('span', 'tk-fp-label', `互动${i + 1}·${label}`));
                    const control = element('input', 'text_pole'); control.value = edges[i]?.[key] || ''; control.placeholder = '无此互动请整组留空';
                    controls.set(`edge${i}${key}`, control); row.append(control); form.append(row);
                }
                continue;
            }
            const row = element('label', 'tk-fp-editrow'); row.append(element('span', 'tk-fp-label', FIELD_LABELS[name] || ({ scene: '场景叙述', where: '场景地点', timeStart: '起始时间', timeEnd: '结束时间', date: '明确公历日期', location: '地点' })[name] || name));
            let control;
            if (choices[name]) {
                control = element('select', 'text_pole');
                for (const [value, label] of Object.entries(choices[name])) { const option = element('option', '', label); option.value = value; control.append(option); }
                control.value = values[name] || Object.keys(choices[name])[0];
            } else if (booleans.has(name)) { control = element('input'); control.type = 'checkbox'; control.checked = !!values[name]; }
            else {
                control = element('textarea', 'text_pole'); control.rows = ['scene', 'summary', 'description', 'content', 'evidence'].includes(name) ? 3 : 1;
                control.value = Array.isArray(values[name]) ? values[name].join('、') : String(values[name] ?? '');
                const resize = () => { control.style.height = 'auto'; control.style.height = `${Math.max(30, control.scrollHeight + 2)}px`; };
                control.addEventListener('input', resize); setTimeout(resize, 0);
                if (arrays.has(name)) control.placeholder = '多个值用顿号或逗号分隔';
                if (name === 'date') control.placeholder = 'YYYY-MM-DD；架空历法请留空';
            }
            controls.set(name, control); row.append(control); form.append(row);
        }
        const footer = element('div', 'tk-fp-editfoot');
        if (remove) footer.append(button('删除此条', () => run(remove), 'tk-fp-remove'));
        footer.append(element('span', 'tk-fp-spacer'), button('取消', () => { editKey = null; error = ''; renderContent(); updateNotice(); schedule(); }, 'menu_button'));
        const submit = button('保存', () => {}, 'menu_button'); submit.type = 'submit'; footer.append(submit); form.append(footer);
        form.addEventListener('submit', event => {
            event.preventDefault();
            const result = { ...values };
            for (const [name, control] of controls) {
                if (name.startsWith('edge')) continue;
                const value = booleans.has(name) ? control.checked : control.value.trim();
                if (arrays.has(name)) result[name] = value ? value.split(/[、,，\n]/).map(part => part.trim()).filter(Boolean) : [];
                else if (name === 'progress') result[name] = value === '' ? 0 : Number(value);
                else if (value !== '' || ['summary', 'o', 'reason', 'date', 'timeStart', 'timeEnd', 'location'].includes(name)) result[name] = value;
                else delete result[name];
            }
            if (fieldNames.includes('edges')) result.edges = Array.from({ length: 3 }, (_, i) => Object.fromEntries(
                ['s', 't', 'r'].map(key => [key, controls.get(`edge${i}${key}`).value.trim()]))).filter(edge => edge.s || edge.t || edge.r);
            run(() => save(result));
        });
        form.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); editKey = null; error = ''; renderContent(); schedule(); } });
        setTimeout(() => form.querySelector('textarea,input,select')?.focus(), 0);
        return form;
    }
    function editPayload(key, fieldNames) {
        renderContent();
        const form = editor(key, model.payload, fieldNames, values => commitPayload(values));
        const target = content.querySelector(`[data-edit="${key}"]`); target?.replaceWith(form);
    }
    function editItem(item) {
        renderContent();
        const patch = (value, remove = false) => {
            const payload = structuredClone(model.payload);
            const eventIds = [...(model.entry?.eventIds || [])];
            if (item.bucket === 'anchors') {
                if (remove) payload.anchors.splice(item.index, 1); else payload.anchors[item.index] = value;
                return commitPayload(payload);
            }
            if (remove) { payload.updates[item.bucket].splice(item.index, 1); if (item.bucket === 'events') eventIds.splice(item.index, 1); }
            else payload.updates[item.bucket][item.index] = item.bucket === 'newCharacters' ? value.name : value;
            return commitPayload(payload, { eventIds, ...(remove && item.bucket === 'events' && !payload.updates.events.length ? { suppressDefaultEvent: true } : {}) });
        };
        const form = editor(item.key, item.value, item.fields, values => patch(values), () => patch(null, true));
        content.querySelector(`[data-edit="${item.key}"]`)?.replaceWith(form);
    }
    function renderContent() {
        if (!model || busy) return;
        content.replaceChildren();
        if (model.legacy) {
            const events = model.legacyEvents;
            content.append(element('p', '', `旧版区间总结 · 第 ${model.legacy.previousEndMesId + 2}–${model.legacy.endMesId + 1} 楼`));
            for (const event of events) content.append(element('p', 'tk-fp-summary', event.summary));
            content.append(button('在剧情资料中编辑', () => openMemory(floor), 'menu_button')); return;
        }
        const disabled = !!model.entry?.omitted;
        const chips = element('div', 'tk-fp-chips');
        const time = button(model.payload.timeStart && model.payload.timeEnd && model.payload.timeStart !== model.payload.timeEnd
            ? `${model.payload.timeStart} → ${model.payload.timeEnd}` : model.payload.timeEnd || model.payload.timeStart || model.payload.date || '设置时间',
        () => editPayload('time', ['timeStart', 'timeEnd', 'date']), 'tk-fp-chip');
        time.prepend(icon('clock')); time.dataset.edit = 'time'; time.disabled = disabled;
        const location = button(model.payload.location || '设置地点', () => editPayload('location', ['location']), 'tk-fp-chip');
        location.prepend(icon('location-dot')); location.dataset.edit = 'location'; location.disabled = disabled;
        chips.append(time, location); content.append(chips);
        const summary = button(model.payload.summary || '此楼尚无摘要，点击补写。', () => editPayload('summary', ['summary']), 'tk-fp-summary');
        summary.dataset.edit = 'summary'; summary.disabled = disabled; summary.title = '点击编辑摘要'; content.append(summary);
        const grouped = new Map();
        for (const item of model.items) { if (!grouped.has(item.group)) grouped.set(item.group, []); grouped.get(item.group).push(item); }
        const grid = element('div', 'tk-fp-groups');
        for (const [name, items] of grouped) {
            const section = element('section', 'tk-fp-group'); const heading = element('h4', '', name); heading.prepend(icon(iconNames[name] || 'list'));
            const list = element('div', 'tk-fp-tags');
            for (const item of items) {
                const tag = button('', () => editItem(item), 'tk-fp-tagline', '点击审查或编辑此条变化'); tag.dataset.edit = item.key; tag.disabled = disabled;
                const badge = element('span', 'tk-fp-op', item.operation); badge.dataset.operation = item.operation;
                const details = element('span', 'tk-fp-tagbody'); details.append(element('span', 'tk-fp-tagmain', item.title));
                if (item.sub) details.append(element('span', 'tk-fp-tagsub', item.sub));
                tag.append(badge, details); list.append(tag);
            }
            section.append(heading, list); grid.append(section);
        }
        content.append(grid);
        const footer = element('div', 'tk-fp-footer');
        if (model.pending && model.payload.summary && !disabled) footer.append(button('确认写入', () => run(() =>
            updateFloor(floor, { payload: model.payload, reviewed: true, deleted: false, omitted: false }, model.source.digest)), 'menu_button'));
        if (model.entry && !disabled) {
            if (confirmingDelete) footer.append(element('span', '', '删除此楼摘要并重新计算后续变化？'),
                button('取消', () => { confirmingDelete = false; renderContent(); }, 'menu_button'),
                button('确认删除', () => run(() => updateFloor(floor, { deleted: true }, model.source.digest)), 'menu_button'));
            else if (!model.entry.deleted) footer.append(button('删除摘要', () => { confirmingDelete = true; renderContent(); }, 'tk-fp-remove'));
        }
        footer.append(element('span', 'tk-fp-spacer'), button('查看剧情', () => openMemory(floor), 'tk-fp-link'));
        content.append(footer);
    }
    return { node: root, floor, refresh(snapshot) {
        const next = floorPanelModel(snapshot, floor);
        const nextSignature = JSON.stringify(next);
        if (model && editKey && (model.source.digest !== next.source.digest || JSON.stringify(model.payload) !== JSON.stringify(next.payload))) {
            error = '资料已变化，请取消当前编辑后重新打开，避免覆盖新内容。'; updateNotice();
            for (const form of root.querySelectorAll('form')) form.querySelector('button[type="submit"]')?.setAttribute('disabled', '');
            return;
        }
        model = next;
        status.textContent = model.status; clock.textContent = model.payload.timeEnd || model.payload.timeStart || model.payload.date;
        preview.textContent = model.entry?.omitted ? '不计入剧情记忆' : model.payload.summary || (model.legacy ? '查看旧版区间总结' : '待总结');
        number.classList.toggle('is-pending', model.pending); root.classList.toggle('is-omit', !!model.entry?.omitted);
        omit.classList.toggle('is-active', !!model.entry?.omitted); omit.disabled = busy || !!model.legacy;
        omit.title = model.entry?.omitted ? '取消番外：恢复参与剧情记忆' : '标为番外：不计入剧情记忆'; omit.setAttribute('aria-label', omit.title);
        extract.disabled = busy || !!model.legacy || !!model.entry?.omitted;
        if (signature !== nextSignature && !editKey) { signature = nextSignature; renderContent(); }
        updateNotice(); updateExpanded();
    } };
}
