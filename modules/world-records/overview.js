import { KINDS, FIELD_LABELS } from './domain.js';

// A read-only projection of the world. It owns no storage, commands or model calls.
export function createWorldOverview({ navigate }) {
    let root, state;
    const expanded = new Set();
    const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
    function link(label, route) { const button = el('button', label, 'menu_button'); button.type = 'button'; button.addEventListener('click', () => navigate(route)); return button; }
    function valueText(value) {
        if (value?.entityId) return `${state.entities.find(e => e.id === value.entityId)?.name || '未知对象'}${value.description ? ` · ${value.description}` : ''}`;
        return typeof value === 'string' ? value : JSON.stringify(value);
    }
    function show(next) {
        if (!root || !next) return;
        state = next; root.replaceChildren();
        root.append(el('h3', state.title, 'standoutHeader'), el('p', '人物、地点、物品、局势与设定共同构成当前世界。', 'tk-record-note'));
        const status = el('p', `已登记 ${state.entities.length} 个对象 · 第 ${state.version} 版`, 'tk-record-status'); status.setAttribute('role', 'status'); root.append(status);
        const nav = el('div', undefined, 'tk-record-actions');
        for (const [route, label] of [['people', '查看人物'], ['map', '查看地图'], ['situation', '查看局势'], ['lore', '查看设定']]) nav.append(link(label, route));
        root.append(nav, el('h4', '对象与当前状态'));
        if (!state.entities.length) root.append(el('p', '尚未登记世界对象。已有剧情和地图记录会在可用时汇入这里。', 'tk-record-note'));
        for (const [kind, label] of Object.entries(KINDS)) {
            const entities = state.entities.filter(e => e.kind === kind); if (!entities.length) continue;
            const group = el('details'); group.open = true; group.append(el('summary', `${label} · ${entities.length}`));
            for (const entity of entities) {
                const detail = el('details', undefined, 'tk-world-overview-entity'); detail.open = expanded.has(entity.id);
                detail.addEventListener('toggle', () => { if (!detail.isConnected) return; if (detail.open) expanded.add(entity.id); else expanded.delete(entity.id); });
                detail.append(el('summary', entity.name));
                if (entity.aliases.length) detail.append(el('p', `别名：${entity.aliases.join('、')}`, 'tk-record-note'));
                const fields = Object.entries(entity.fields);
                if (!fields.length) detail.append(el('p', '尚无已确认状态。', 'tk-record-note'));
                for (const [field, record] of fields) {
                    const row = el('div', undefined, 'tk-record-value'); row.append(el('strong', FIELD_LABELS[field] || field), el('p', valueText(record.value)), el('small', record.source.label)); detail.append(row);
                }
                const pending = state.claims.filter(c => c.entityId === entity.id && c.status === 'pending').length;
                if (pending) detail.append(el('p', `${pending} 条来源记录待确认`, 'tk-record-note'));
                group.append(detail);
            }
            root.append(group);
        }
        const pending = state.claims.filter(c => c.status === 'pending').length;
        if (pending) { const section = el('section'); section.append(el('h4', '待处理记录'), el('p', `${pending} 条来源记录尚未确认为世界事实。`), link('处理来源记录', 'world-management')); root.append(section); }
        root.append(el('h4', '近期变化'));
        const history = el('ol', undefined, 'tk-world-overview-history');
        for (const event of state.events.slice(-6).reverse()) {
            const row = el('li'); row.append(el('strong', event.title), el('p', `第 ${event.version} 版 · ${event.at}`, 'tk-record-note'));
            const names = [...new Set(event.effects.filter(e => e.type === 'entity').map(e => e.after.name))];
            if (names.length) row.append(el('p', names.join('、'))); history.append(row);
        }
        if (state.events.length) root.append(history); else root.append(el('p', '还没有世界变更记录。', 'tk-record-note'));
        const management = el('details'); management.append(el('summary', '管理与接入'), el('p', '新增、修订、交易、历史分支与备份位于设置中的世界管理。分类页的数据接管仍在逐步进行。', 'tk-record-note'), link('打开世界管理', 'world-management')); root.append(management);
    }
    return {
        mount(parent) { if (!root) { root = el('div', undefined, 'tk-world-records tk-world-overview'); root.setAttribute('aria-label', '世界总览'); } if (root.parentElement !== parent) parent.append(root); },
        show,
        isEditing: () => false,
        empty() { root.replaceChildren(el('h3', '世界总览', 'standoutHeader'), el('p', '选择一段对话后，这里汇总它的世界状态。', 'tk-record-note')); },
        reset() { state = null; expanded.clear(); root?.replaceChildren(); },
    };
}
