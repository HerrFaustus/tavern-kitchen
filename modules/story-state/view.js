import { availableStoryRecords, characterStoryState, PRESENCE, BELIEFS, THREAD_STATUS, STORY_KINDS, storyRecordText, relativeStoryTime } from './records.js';
import { FIELD_LABELS } from '../world-records/domain.js';

const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
function source(record) {
    if (!Number.isInteger(record?._addedAt)) return el('small', '导入记录', 'tk-record-note');
    const start = (record._sourceStart ?? record._addedAt) + 1, end = record._addedAt + 1;
    return el('small', start === end ? `来源：第 ${end} 楼` : `来源：第 ${start}–${end} 楼`, 'tk-record-note');
}
function section(parent, title) { const node = el('section'); node.append(el('h4', title)); parent.append(node); return node; }
function line(parent, label, value) { if (value) { const row = el('p'); row.append(el('strong', `${label}：`), document.createTextNode(value)); parent.append(row); } }
export function renderPersonState(parent, records, name, resolveName) {
    const state = characterStoryState(records, name, resolveName);
    const group = section(parent, '在场度与认知'); group.className = 'tk-person-state';
    line(group, '在场度', PRESENCE[state.presence]);
    if (state.note) group.append(el('p', state.note, 'tk-record-note'));
    if (!state.knowledge.length) group.append(el('p', '尚未记录这个人物获知了什么。', 'tk-record-note'));
    for (const knowledge of state.knowledge) {
        const row = el('details'); row.append(el('summary', `${BELIEFS[knowledge.certainty]} · ${knowledge.content}`));
        line(row, '依据', knowledge.evidence); line(row, '获知时间', knowledge.learnedAt); row.append(source(knowledge)); group.append(row);
    }
    return group;
}
export function renderThreads(parent, records, kinds = ['plan', 'suspense', 'situation']) {
    const labels = { plan: '计划', suspense: '悬念', situation: '局面' };
    const clock = records.find(record => record.kind === 'clock');
    for (const kind of kinds) {
        const entries = records.filter(record => record.kind === kind), open = entries.filter(record => record.status === 'open');
        const group = section(parent, labels[kind]);
        const append = (container, record) => {
            const row = el('details'); row.append(el('summary', `${record.title} · ${THREAD_STATUS[record.status]}`));
            if (record.description) row.append(el('p', record.description));
            const relative = relativeStoryTime(record.due, clock?.date);
            line(row, '期限', record.due ? `${record.due}${relative ? `（${relative}）` : ''}` : '');
            line(row, '结案原因', record.reason); row.append(source(record)); container.append(row);
        };
        if (!open.length) group.append(el('p', `暂无未结${labels[kind]}。`, 'tk-record-note'));
        open.forEach(record => append(group, record));
        const closed = entries.filter(record => record.status !== 'open');
        if (closed.length) { const history = el('details'); history.append(el('summary', `已结 ${closed.length} 项`)); closed.forEach(record => append(history, record)); group.append(history); }
    }
}
export function createStoryOverview({ getSnapshot, navigate }) {
    let root;
    const expanded = new Set();
    function button(label, route) { const node = el('button', label, 'menu_button'); node.type = 'button'; node.addEventListener('click', () => navigate(route)); return node; }
    return {
        mount(parent) { root ||= el('div', undefined, 'tk-world-records tk-story-overview'); root.setAttribute('aria-label', '故事总览'); if (root.parentElement !== parent) parent.append(root); },
        show(world) {
            for (const detail of root.querySelectorAll('details')) { const key = detail.querySelector('summary')?.textContent; if (detail.open) expanded.add(key); else expanded.delete(key); }
            root.replaceChildren(el('h3', '总览', 'standoutHeader'));
            const snapshot = getSnapshot(), store = snapshot?.enabled ? snapshot.store : null;
            const invalid = store?.summaryInvalid || snapshot?.invalidFrom != null || store?.sourceInvalidFromFloor != null;
            const records = availableStoryRecords(store, snapshot?.invalidFrom);
            const json = !invalid && store?.json || {};
            const scene = records.find(record => record.kind === 'scene'), clock = records.find(record => record.kind === 'clock');
            const status = el('p', invalid ? '原文已变化，正在等待剧情回退；旧场景暂不显示。' : !snapshot?.enabled ? '剧情模块尚未启用；世界已确认状态仍可查看。' : store?.lastSummarizedMesId >= 0 ? `剧情已整理至第 ${store.lastSummarizedMesId + 1} 楼，之后的对话尚未纳入。` : '尚未整理剧情。生成总结后，场景和重要变化会汇入这里。', 'tk-record-note'); status.setAttribute('role', 'status'); root.append(status);
            const current = section(root, '当前场景');
            line(current, '故事时间', clock?.label || '未记录');
            line(current, '地点', scene?.location || '未记录');
            if (scene) { line(current, '局面', scene.situation); line(current, '张力', scene.tension); line(current, '待兑现', scene.pendingBeat); current.append(source(scene)); }
            else current.append(el('p', '尚无场景快照；不会从旧事件推测当前地点与人物。', 'tk-record-note'));
            const people = section(root, '在场与附近人物');
            const names = [...new Set([...(scene?.participants || []), ...records.filter(record => record.kind === 'person').map(record => record.name)])];
            const nearby = names.filter(name => ['present', 'nearby'].includes(characterStoryState(records, name).presence));
            if (!nearby.length) people.append(el('p', '尚未确认在场人物。', 'tk-record-note'));
            for (const name of nearby) { const state = characterStoryState(records, name); const detail = el('details'); detail.append(el('summary', `${name} · ${PRESENCE[state.presence]} · ${state.knowledge.length} 条认知`)); renderPersonState(detail, records, name); people.append(detail); }
            people.append(button('查看全部人物', 'people'));
            renderThreads(root, records);
            const recent = section(root, '近期剧情');
            for (const event of (json.events || []).slice(-5).reverse()) { const detail = el('details'); detail.append(el('summary', event.title || '未命名事件'), el('p', event.summary)); if (event.timeLabel) detail.append(el('small', event.timeLabel, 'tk-record-note')); recent.append(detail); }
            if (!json.events?.length) recent.append(el('p', '暂无已整理剧情。', 'tk-record-note'));
            for (const arc of (json.arcs || []).slice(0, 5)) line(recent, arc.name, arc.trajectory);
            recent.append(button('查看剧情', 'memory'));
            const state = section(root, '世界重要状态');
            const entries = (world?.entities || []).flatMap(entity => Object.entries(entity.fields).map(([field, record]) => ({ entity, field, record }))).sort((a, b) => b.record.version - a.record.version);
            for (const { entity, field, record } of entries.slice(0, 8)) {
                const value = record.value?.entityId ? world.entities.find(item => item.id === record.value.entityId)?.name || '未知对象' : typeof record.value === 'string' ? record.value : JSON.stringify(record.value);
                line(state, `${entity.name} · ${FIELD_LABELS[field] || field}`, value);
            }
            if (!entries.length) state.append(el('p', '尚无已确认世界状态。', 'tk-record-note'));
            const pending = world?.claims?.filter(claim => claim.status === 'pending').length || 0;
            if (pending) state.append(el('p', `${pending} 条来源记录待确认`, 'tk-record-note'));
            state.append(button('查看世界', 'world'), button('查看规划', 'planner'));
            for (const detail of root.querySelectorAll('details')) detail.open = expanded.has(detail.querySelector('summary')?.textContent);
        },
        isEditing: () => false,
        empty() { root.replaceChildren(el('h3', '总览', 'standoutHeader'), el('p', '选择一段对话后，这里汇总当前场景、剧情与世界状态。', 'tk-record-note')); },
        reset() { expanded.clear(); root?.replaceChildren(); },
    };
}

export function floorChangeText(change) {
    const label = STORY_KINDS[(change.after || change.before)?.kind] || { events: '剧情', facts: '世界', characters: '人物', arcs: '叙事线', keywords: '关键词', storyRecords: '状态' }[change.collection] || '变化';
    const describe = value => {
        if (Array.isArray(value)) return value.map(describe).join('；');
        if (!value) return '';
        if (value.kind) return storyRecordText(value);
        if (value.s) return `${value.s} · ${value.p}：${value.o || '撤回'}`;
        return value.title || value.name || value.text || '';
    };
    const before = describe(change.before), after = describe(change.after);
    if (before === after) return '';
    return `${label} · ${!change.before ? '新增' : !change.after ? '撤回' : '更新'}：${before && after ? `${before} → ${after}` : after || before}`;
}
