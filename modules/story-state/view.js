import { nameKey, protagonistIdentity } from './protagonist-identity.js';
import { isPersonalAgenda, projectPersonalAgendas, availableStoryRecords, characterStoryState, PRESENCE, BELIEFS, THREAD_STATUS, SITUATION_FIELDS, STORY_KINDS, storyRecordText, relativeStoryTime } from './records.js';
import { FIELD_LABELS } from '../world-records/domain.js';
import { PERSON_FIELDS, PERSON_SECTIONS, POSSESSION_ROLES, RELATION_PREFIX } from '../world-records/person-fields.js';
import { worldStoryRecords } from '../world-records/world-story-state.js';

const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
function source(record) {
    if (!Number.isInteger(record?._addedAt)) return el('small', '导入记录', 'tk-record-note');
    const start = (record._sourceStart ?? record._addedAt) + 1, end = record._addedAt + 1;
    return el('small', start === end ? `来源：第 ${end} 楼` : `来源：第 ${start}–${end} 楼`, 'tk-record-note');
}
function section(parent, title, className) { const node = el('section', undefined, className); node.append(el('h4', title)); parent.append(node); return node; }
function line(parent, label, value) { if (value) { const row = el('p'); row.append(el('strong', `${label}：`), document.createTextNode(value)); parent.append(row); } }
export function renderPersonState(parent, records, name, resolveName) {
    const state = characterStoryState(records, name, resolveName);
    if (state.presence === 'unknown' && !state.note && !state.knowledge.length) return null;
    const group = section(parent, '在场度与认知'); group.className = 'tk-person-state';
    if (state.presence !== 'unknown') line(group, '在场度', PRESENCE[state.presence]);
    if (state.note) group.append(el('p', state.note, 'tk-record-note'));
    for (const knowledge of state.knowledge) {
        const row = el('details'); row.append(el('summary', `${BELIEFS[knowledge.certainty]} · ${knowledge.content}`));
        line(row, '依据', knowledge.evidence); line(row, '获知时间', knowledge.learnedAt); row.append(source(knowledge)); group.append(row);
    }
    return group;
}
export function renderPersonalAgendas(parent, records, matches) {
    const owned = records.filter(record => isPersonalAgenda(record) && record.holders?.some(matches));
    for (const kind of ['plan', 'goal']) {
        if (owned.some(record => record.kind === kind)) renderThreads(parent, owned, [kind]);
    }
}
export function renderThreads(parent, records, kinds = ['plan', 'suspense', 'situation'], limit = Infinity) {
    const labels = { plan: '计划', goal:'目标', suspense: '悬念', situation: '局面' };
    const clock = records.find(record => record.kind === 'clock');
    for (const kind of kinds) {
        const entries = records.filter(record => record.kind === kind), open = entries.filter(record => record.status === 'open');
        const group = section(parent, labels[kind]);
        const append = (container, record) => {
            const row = el('details'); row.dataset.recordId = record.id; row.append(el('summary', `${record.title} · ${THREAD_STATUS[record.status]}`));
            if (kind === 'situation') {
                const scenery = record.flavor === 'scenery' || record.flavor === 'encounter';
                line(row, '类型', record.flavor === 'encounter' ? '风物 · 街头见闻' : scenery ? '风物' : '事态');
                line(row, scenery ? '眼前细节' : '局势概况', record.description);
                if (scenery) {
                    if (record.flavor !== 'encounter') line(row, '类别', record.category);
                    line(row, '时节', record.period);
                    line(row, '阶段', record.phase);
                    line(row, '关联局势', record._relatedTitle || records.find(item => item.id === record.relatedId)?.title);
                }
                for (const [key, label] of Object.entries(SITUATION_FIELDS)) line(row, label, record[key]);
                const history = el('details'); history.append(el('summary', '局势历史'));
                for (const step of record._history || []) {
                    const item = el('p', step.text); item.append(document.createTextNode(' '), source(step)); history.append(item);
                }
                row.append(history);
                for (const item of record._developments || []) line(row, '幕后进展 · ' + item.title, item.body);
            } else if (isPersonalAgenda(record)) {
                line(row,'持有人',record.holders?.join('、') || '待归属');
                line(row,'具体内容',record.description);
                line(row,'条件约束',record.conditions);
                line(row,'当前进展',record.statusNote);
            } else if (record.description) row.append(el('p', record.description));
            const relative = relativeStoryTime(record.due, clock?.date);
            line(row, record.flavor === 'encounter' ? '散场条件' : '期限', record.due ? `${record.due}${relative ? `（${relative}）` : ''}` : '');
            line(row, '结案原因', record.reason); row.append(source(record)); container.append(row);
        };
        if (!open.length) group.append(el('p', `暂无未结${labels[kind]}。`, 'tk-record-note'));
        const shown = open.slice(0, limit);
        shown.forEach(record => append(group, record));
        if (open.length > shown.length) group.append(el('p', `另有 ${open.length - shown.length} 项未结${labels[kind]}。`, 'tk-record-note'));
        const closed = entries.filter(record => record.status !== 'open');
        if (closed.length) { const history = el('details'); history.append(el('summary', `已结 ${closed.length} 项`)); closed.forEach(record => append(history, record)); group.append(history); }
    }
}
export function createSuspenseBook({ getSnapshot }) {
    let root;
    return {
        mount(parent) {
            root ||= el('div', undefined, 'tk-world-records');
            if (root.parentElement !== parent) parent.append(root);
        },
        show(world) {
            const expanded = new Set([...root.querySelectorAll('details')].filter(item => item.open).map(item => item.dataset.recordId));
            root.replaceChildren();
            const snapshot = getSnapshot(), store = snapshot?.store;
            if (!snapshot?.enabled || !store || snapshot.invalidFrom != null || store.summaryInvalid || store.sourceInvalidFromFloor != null) {
                root.append(el('p', '正在等待有效的剧情记忆。', 'tk-record-note'));
                return;
            }
            renderThreads(root, worldStoryRecords(world, availableStoryRecords(store)), ['suspense']);
            for (const item of root.querySelectorAll('details')) item.open = expanded.has(item.dataset.recordId);
        },
        isEditing: () => false,
        empty() { root.replaceChildren(el('p', '选择一段对话后查看悬念。', 'tk-record-note')); },
        reset() { root?.replaceChildren(); },
    };
}
export function renderWorldAttributes(root, entities, person) {
    const byId = new Map(entities.map(entity => [entity.id, entity.name]));
    const fields = Object.entries(person?.fields || {}).filter(([, record]) => record.nature === 'established_fact');
    const groups = new Map();
    const group = label => {
        if (!groups.has(label)) groups.set(label, section(root,label));
        return groups.get(label);
    };
    for (const [label, keys] of Object.entries(PERSON_SECTIONS)) {
        for (const key of keys) {
            const record = person?.fields?.[key];
            const raw = record?.nature === 'established_fact' ? record.value : null;
            const value = raw && typeof raw === 'object' ? byId.get(raw.entityId) || JSON.stringify(raw) : raw;
            if (value) line(group(label), key, value);
        }
    }
    for (const [field, record] of fields) {
        if (PERSON_FIELDS.has(field)) continue;
        const value = record.value;
        if (field.startsWith(RELATION_PREFIX)) {
            if (value?.role) line(group('关系身份'), byId.get(value.entityId) || '未知人物', '本人是对方的' + value.role);
            continue;
        }
        line(root, FIELD_LABELS[field] || field, value?.entityId ? byId.get(value.entityId) || '未知对象'
            : typeof value === 'string' ? value : JSON.stringify(value));
    }
    for (const other of entities) {
        if (!person || other.id === person.id) continue;
        const roles = Object.entries(POSSESSION_ROLES).flatMap(([key,label]) => {
            const record = other.fields?.[key];
            const id = record?.nature === 'established_fact' && record.value?.entityId;
            return id ? [{id, label, name:byId.get(id) || '未知对象'}] : [];
        });
        const asset = other.kind === 'place' || other.fields?.['持有类别']?.nature === 'established_fact' && other.fields['持有类别'].value === '资产';
        const possession = asset || other.kind === 'item';
        if (possession && roles.some(role => role.id === person.id)) {
            line(group(asset ? '资产' : '物品'),other.name,roles.map(role => role.label + '：' + role.name).join('；'));
        }
        for (const [field, record] of Object.entries(other.fields || {})) {
            if (record.nature !== 'established_fact' || record.value?.entityId !== person.id) continue;
            if (possession && Object.hasOwn(POSSESSION_ROLES,field)) continue;
            if (field.startsWith(RELATION_PREFIX) && record.value.role) line(group('关系身份'),other.name,'对方是本人的' + record.value.role);
            else line(group('直接关联'),other.name,(FIELD_LABELS[field] || field) + '为' + person.name);
        }
    }
}

export function createProtagonistView({ getSnapshot, getPlayerName, getInvolvement }) {
    let root;
    return {
        mount(parent) {
            root ||= el('div', undefined, 'tk-world-records');
            root.setAttribute('aria-label', '主角');
            if (root.parentElement !== parent) parent.append(root);
        },
        show(world) {
            const entities = world.entities;
            const { hero, names, title } = protagonistIdentity(entities, getPlayerName());
            root.replaceChildren(el('h3', title || '主角', 'standoutHeader'));
            if (!hero && !names.size) {
                root.append(el('p', '尚无法确定当前玩家对应的人物。', 'tk-record-note'));
                return;
            }
            if (hero) renderWorldAttributes(root, entities, hero);
            const snapshot = getSnapshot();
            const records = worldStoryRecords(world, snapshot?.enabled ? availableStoryRecords(snapshot.store, snapshot.invalidFrom) : []);
            const matches = name => names.has(nameKey(name));
            const knownNames = new Set(entities.filter(entity => ['person','subject'].includes(entity.kind))
                .flatMap(entity => [entity.name,...(entity.aliases || [])]));
            knownNames.add(title);
            renderPersonalAgendas(root, projectPersonalAgendas(records, knownNames), matches);
            const personal = records.filter(record => record.kind === 'person' && matches(record.name)
                || record.kind === 'knowledge' && matches(record.person)
                || record.kind === 'scene' && record.participants.some(matches));
            if (personal.length) {
                const identity = Symbol('player');
                const resolve = name => name === identity || matches(name) ? identity : name;
                const current = characterStoryState(records, identity, resolve);
                const scene = personal.find(record => record.kind === 'scene');
                if (scene && current.presence === 'present' && !hero?.fields.location) line(root, '所在场景', scene.location);
                renderPersonState(root, records, identity, resolve);
            }
            const near = (getInvolvement?.(world) || []).filter(item => item.near);
            if (near.length) {
                const group = section(root, '当前牵涉');
                for (const item of near) line(group, item.title, item.reason);
            }
            if (root.childElementCount === 1) root.append(el('p', '尚无与主角明确相关的世界记录。', 'tk-record-note'));
        },
        isEditing: () => false,
        empty() { root.replaceChildren(el('p', '选择一段对话后查看主角状态。', 'tk-record-note')); },
        reset() { root?.replaceChildren(); },
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
