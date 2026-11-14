import { createIdentifier } from '../../shared/common/identifier.js';
import { FIELD_LABELS, KINDS, NATURES } from './domain.js';
import { PERSON_SECTIONS, POSSESSION_ROLES, RELATION_PREFIX } from './person-fields.js';

const PRESET_PERSON_FIELDS = [
    ...new Set([
        ...Object.values(PERSON_SECTIONS).flat(),
        'coins',
        'location',
        'owner',
        ...Object.keys(POSSESSION_ROLES),
        'description',
    ]),
];

const PRESET_WORLD_FIELDS = [
    ...new Set([
        ...Object.keys(FIELD_LABELS),
        ...Object.keys(POSSESSION_ROLES),
    ]),
];

const REFERENCE_FIELDS = new Set(['owner', 'location', 'parent', ...Object.keys(POSSESSION_ROLES)]);
const PLACE_REFERENCE_FIELDS = new Set(['location', 'parent']);

/**
 * Manual world intervention drawer mounted inside the existing people/situation tabs.
 * Every mutation goes through createWorldService commands so provenance, branch scope
 * and optimistic version checks remain uniform with automatic updates.
 */
export function createWorldEditorPanel({ service, getIdentity, section = 'situation', getSelectedPerson }) {
    let root;
    let doc;
    let state = null;
    let editing = false;
    let busy = false;
    let epoch = 0;
    let message = '';

    const isPeople = section === 'people';
    const el = (tag, text, className) => {
        const node = doc.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (className) node.className = className;
        return node;
    };
    const button = (title, action) => {
        const node = el('button', title, 'menu_button');
        node.type = 'button';
        node.addEventListener('click', action);
        return node;
    };
    const input = (type, value = '') => {
        const node = el('input', undefined, 'text_pole');
        node.type = type;
        node.value = value;
        return node;
    };
    const setSelectValue = (node, value) => {
        const target = String(value ?? '');
        const options = [...(node.options || [])];
        for (const option of options) {
            if (option.value === target) {
                option.selected = true;
                option.setAttribute('selected', '');
            } else {
                option.removeAttribute('selected');
            }
        }
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value')
            || Object.getOwnPropertyDescriptor(node, 'value');
        if (!descriptor || descriptor.writable || typeof descriptor.set === 'function') {
            node.value = target;
        }
    };
    const getSelectValue = node => {
        const options = [...(node.options || [])];
        const chosen = options.find(option => option.selected || option.hasAttribute('selected'));
        return chosen ? chosen.value : (node.value ?? options[0]?.value ?? '');
    };
    const select = (choices, value) => {
        const node = el('select', undefined, 'text_pole');
        for (const [key, title] of choices) {
            const option = el('option', title);
            option.value = key;
            node.append(option);
        }
        setSelectValue(node, value);
        return node;
    };
    const fieldLabel = (title, control) => {
        const node = el('label', undefined, 'tk-world-editor-field');
        node.append(el('span', title), control);
        control.setAttribute('aria-label', title);
        return node;
    };
    const manualSource = reason => ({
        module: 'manual',
        key: createIdentifier(),
        label: String(reason || '').trim() || '玩家登记',
    });
    const entityLabel = entity => `${entity.name}（${KINDS[entity.kind] || entity.kind}）`;
    const formatValue = value => {
        if (value && typeof value === 'object' && typeof value.entityId === 'string') {
            const name = state?.entities.find(item => item.id === value.entityId)?.name || value.entityId;
            return value.role ? `${name}（${value.role}）` : name;
        }
        return typeof value === 'string' ? value : value == null ? '未设置' : JSON.stringify(value);
    };

    function run(task, status, controls) {
        if (busy) return;
        busy = true;
        const token = epoch;
        const owner = getIdentity();
        status.textContent = '正在保存…';
        status.setAttribute('role', 'status');
        const disabled = controls.map(node => node.disabled);
        controls.forEach(node => { node.disabled = true; });
        Promise.resolve()
            .then(task)
            .then(result => {
                if (token !== epoch || owner !== getIdentity()) return;
                editing = false;
                busy = false;
                message = `已保存 · 第 ${result.state.version} 版`;
                show(result.state);
            })
            .catch(error => {
                if (token !== epoch || owner !== getIdentity()) return;
                status.setAttribute('role', 'alert');
                status.textContent = error?.message || '保存失败，请重试';
            })
            .finally(() => {
                if (token !== epoch) return;
                busy = false;
                controls.forEach((node, index) => { node.disabled = disabled[index]; });
            });
    }

    function openForm(drawer, title, nodes, commitTitle, buildOperations) {
        if (busy || !state) return;
        const expected = state;
        editing = true;
        const form = el('form', undefined, 'tk-world-editor-form');
        const heading = el('p');
        heading.append(el('strong', title));
        form.append(heading, ...nodes);
        const status = el('p', undefined, 'tk-record-note');
        status.setAttribute('role', 'status');
        const save = el('button', '确认保存', 'menu_button');
        save.type = 'submit';
        const cancel = button('取消', () => {
            if (busy) return;
            editing = false;
            show(state);
        });
        const actions = el('div', undefined, 'tk-world-editor-actions');
        actions.append(save, cancel);
        form.append(actions, status);
        let command = null;
        form.addEventListener('input', () => { command = null; });
        form.addEventListener('change', () => { command = null; });
        form.addEventListener('submit', event => {
            event.preventDefault();
            run(() => {
                command ||= service.command(expected, buildOperations(), commitTitle);
                return service.commit(command);
            }, status, [...form.querySelectorAll('button,input,select,textarea')]);
        });
        drawer.replaceChildren(el('summary', drawer.dataset.summaryLabel), form);
        drawer.open = true;
        form.querySelector('input,select,textarea')?.focus();
    }

    function preferredEntity() {
        const entities = state?.entities || [];
        if (!entities.length) return null;
        if (isPeople) {
            const selectedName = getSelectedPerson?.() || doc?.querySelector('#profile-content .prof-name')?.textContent?.trim();
            if (selectedName) {
                const match = entities.find(item => item.name === selectedName || item.aliases?.includes(selectedName));
                if (match) return match;
            }
            return entities.find(item => item.kind === 'person') || entities[0];
        }
        return entities[0];
    }

    function renderCreateForm(drawer) {
        const selectedName = isPeople
            ? (getSelectedPerson?.() || doc?.querySelector('#profile-content .prof-name')?.textContent?.trim() || '')
            : '';
        const prefill = selectedName && !state.entities.some(item => item.name === selectedName || item.aliases?.includes(selectedName))
            ? selectedName : '';
        const nameInput = input('text', prefill);
        nameInput.required = true;
        nameInput.maxLength = 200;
        const kindChoices = isPeople
            ? [['person', KINDS.person], ['subject', KINDS.subject], ['organization', KINDS.organization]]
            : Object.entries(KINDS);
        const kindSelect = select(kindChoices, isPeople ? 'person' : 'subject');
        const aliasesInput = input('text');
        const sourceInput = input('text', '玩家登记');
        sourceInput.required = true;
        const id = createIdentifier();
        openForm(
            drawer,
            isPeople ? '新增人物 / 角色对象' : '新增世界对象',
            [
                fieldLabel('名称', nameInput),
                fieldLabel('类型', kindSelect),
                fieldLabel('别名（用逗号分隔）', aliasesInput),
                fieldLabel('来源说明', sourceInput),
            ],
            isPeople ? '手动新增人物' : '手动新增世界对象',
            () => [{
                type: 'create',
                id,
                name: nameInput.value.trim(),
                kind: getSelectValue(kindSelect),
                aliases: aliasesInput.value.split(/[,，]/).map(item => item.trim()).filter(Boolean),
                source: manualSource(sourceInput.value),
            }],
        );
    }

    function renderRenameForm(drawer) {
        const entities = state.entities;
        if (!entities.length) return;
        const target = preferredEntity() || entities[0];
        const entitySelect = select(entities.map(item => [item.id, entityLabel(item)]), target.id);
        const nameInput = input('text', target.name);
        nameInput.required = true;
        nameInput.maxLength = 200;
        const aliasesInput = input('text', (target.aliases || []).join('，'));
        const kindSelect = select(Object.entries(KINDS), target.kind);
        const syncSelected = () => {
            const currentId = getSelectValue(entitySelect);
            const current = entities.find(item => item.id === currentId);
            if (!current) return;
            nameInput.value = current.name;
            aliasesInput.value = (current.aliases || []).join('，');
            setSelectValue(kindSelect, current.kind);
            kindSelect.disabled = current.kind !== 'subject';
        };
        syncSelected();
        entitySelect.addEventListener('change', syncSelected);
        openForm(
            drawer,
            '编辑对象名称与别名',
            [
                fieldLabel('对象', entitySelect),
                fieldLabel('名称', nameInput),
                fieldLabel('别名（用逗号分隔）', aliasesInput),
                fieldLabel('类型（仅主题可更改）', kindSelect),
            ],
            '手动编辑对象名称',
            () => [{
                type: 'rename',
                entityId: getSelectValue(entitySelect),
                name: nameInput.value.trim(),
                aliases: aliasesInput.value.split(/[,，]/).map(item => item.trim()).filter(Boolean),
                kind: getSelectValue(kindSelect),
            }],
        );
    }

    function renderFieldForm(drawer) {
        const entities = state.entities;
        if (!entities.length) return;
        const target = preferredEntity() || entities[0];
        const entitySelect = select(entities.map(item => [item.id, entityLabel(item)]), target.id);
        const fieldInput = input('text', isPeople ? '身份' : 'description');
        fieldInput.required = true;
        fieldInput.maxLength = 100;
        const listId = `tk-field-presets-${section}`;
        const datalist = el('datalist');
        datalist.id = listId;
        const presets = isPeople ? PRESET_PERSON_FIELDS : PRESET_WORLD_FIELDS;
        for (const key of presets) {
            const opt = el('option');
            opt.value = FIELD_LABELS[key] || key;
            datalist.append(opt);
        }
        fieldInput.setAttribute('list', listId);
        const currentSummary = el('p', undefined, 'tk-record-note');
        const valueTypeSelect = select([['text', '文本'], ['number', '数值'], ['reference', '关联对象']], 'text');
        const textValueInput = el('textarea', undefined, 'text_pole');
        textValueInput.rows = 2;
        textValueInput.maxLength = 30000;
        textValueInput.setAttribute('aria-label', '值');
        const refSelect = select([], '');
        refSelect.hidden = true;
        refSelect.setAttribute('aria-label', '关联对象值');
        const natureSelect = select(Object.entries(NATURES), 'established_fact');
        const sourceInput = input('text', '玩家确认');
        sourceInput.required = true;

        const resolveFieldKey = raw => {
            const trimmed = raw.trim();
            return Object.entries(FIELD_LABELS).find(([, labelText]) => labelText === trimmed)?.[0] || trimmed;
        };

        const refreshRefOptions = fieldKey => {
            const selectedId = getSelectValue(entitySelect);
            const candidates = entities.filter(item => item.id !== selectedId
                && (!PLACE_REFERENCE_FIELDS.has(fieldKey) || item.kind === 'place'));
            refSelect.replaceChildren();
            const clearOpt = el('option', '无／清空');
            clearOpt.value = '';
            refSelect.append(clearOpt);
            for (const item of candidates) {
                const opt = el('option', entityLabel(item));
                opt.value = item.id;
                refSelect.append(opt);
            }
            setSelectValue(refSelect, '');
        };

        const syncValueMode = () => {
            const fieldKey = resolveFieldKey(fieldInput.value);
            if (fieldKey === 'coins' || fieldInput.value.trim() === '金币') {
                setSelectValue(valueTypeSelect, 'number');
            } else if (REFERENCE_FIELDS.has(fieldKey)) {
                setSelectValue(valueTypeSelect, 'reference');
            }
            const isRef = getSelectValue(valueTypeSelect) === 'reference';
            refSelect.hidden = !isRef;
            textValueInput.hidden = isRef;
            if (isRef) refreshRefOptions(fieldKey);

            const selectedId = getSelectValue(entitySelect);
            const currentEntity = entities.find(item => item.id === selectedId);
            const existing = currentEntity?.fields?.[fieldKey];
            currentSummary.textContent = existing
                ? `当前记录（${NATURES[existing.nature] || existing.nature}）：${formatValue(existing.value)}`
                : '当前尚无此属性记录。';
        };

        entitySelect.addEventListener('change', syncValueMode);
        fieldInput.addEventListener('input', syncValueMode);
        valueTypeSelect.addEventListener('change', () => {
            const fieldKey = resolveFieldKey(fieldInput.value);
            const isRef = getSelectValue(valueTypeSelect) === 'reference';
            refSelect.hidden = !isRef;
            textValueInput.hidden = isRef;
            if (isRef) refreshRefOptions(fieldKey);
        });
        syncValueMode();

        const valueWrap = el('div');
        valueWrap.append(textValueInput, refSelect, datalist);
        openForm(
            drawer,
            '设置 / 覆写对象属性',
            [
                fieldLabel('目标对象', entitySelect),
                fieldLabel('属性名（如 身份、金币、owner、location）', fieldInput),
                currentSummary,
                fieldLabel('值类型', valueTypeSelect),
                fieldLabel('值', valueWrap),
                fieldLabel('记录性质', natureSelect),
                fieldLabel('来源说明', sourceInput),
            ],
            '手动编辑属性',
            () => {
                const key = resolveFieldKey(fieldInput.value);
                if (!key) throw new Error('请填写属性名。');
                const mode = getSelectValue(valueTypeSelect);
                let parsed;
                if (mode === 'reference') {
                    const chosenRef = getSelectValue(refSelect);
                    parsed = chosenRef ? { entityId: chosenRef } : null;
                } else if (mode === 'number') {
                    const trimmed = textValueInput.value.trim();
                    if (!trimmed || !Number.isFinite(Number(trimmed))) throw new Error('请输入有效数值。');
                    parsed = Number(trimmed);
                } else {
                    if (!textValueInput.value.trim()) throw new Error('请输入文本内容。');
                    parsed = textValueInput.value.trim();
                }
                const chosenNature = getSelectValue(natureSelect);
                return [{
                    type: chosenNature === 'established_fact' ? 'set' : 'claim',
                    id: createIdentifier(),
                    entityId: getSelectValue(entitySelect),
                    field: key,
                    value: parsed,
                    nature: chosenNature,
                    source: manualSource(sourceInput.value),
                }];
            },
        );
    }

    function renderRelationForm(drawer) {
        const people = state.entities.filter(item => ['person', 'subject'].includes(item.kind));
        if (people.length < 2) return;
        const target = preferredEntity();
        const defaultFrom = target && people.some(item => item.id === target.id) ? target.id : people[0].id;
        const defaultTo = (people.find(item => item.id !== defaultFrom) || people[0]).id;
        const fromSelect = select(people.map(item => [item.id, entityLabel(item)]), defaultFrom);
        const toSelect = select(people.map(item => [item.id, entityLabel(item)]), defaultTo);
        const roleInput = input('text');
        roleInput.required = true;
        roleInput.maxLength = 100;
        const sourceInput = input('text', '玩家登记');
        sourceInput.required = true;
        openForm(
            drawer,
            '绑定人物关系（甲方是对方的某种身份）',
            [
                fieldLabel('甲方人物', fromSelect),
                fieldLabel('乙方人物', toSelect),
                fieldLabel('关系身份（如 师父、兄妹、同僚）', roleInput),
                fieldLabel('来源说明', sourceInput),
            ],
            '手动绑定人物关系',
            () => {
                const fromId = getSelectValue(fromSelect);
                const toId = getSelectValue(toSelect);
                if (fromId === toId) throw new Error('关系双方不能为同一人物。');
                const role = roleInput.value.trim();
                if (!role) throw new Error('请填写关系身份。');
                return [{
                    type: 'set',
                    id: createIdentifier(),
                    entityId: fromId,
                    field: `${RELATION_PREFIX}${toId}`,
                    value: { entityId: toId, role },
                    nature: 'established_fact',
                    source: manualSource(sourceInput.value),
                }];
            },
        );
    }

    function renderPurchaseForm(drawer) {
        const actors = state.entities.filter(item => ['person', 'organization'].includes(item.kind));
        const items = state.entities.filter(item => item.kind === 'item');
        if (actors.length < 2 || !items.length) return;
        const buyerSelect = select(actors.map(item => [item.id, item.name]), actors[0].id);
        const sellerSelect = select(actors.map(item => [item.id, item.name]), actors[1].id);
        const itemSelect = select(items.map(item => [item.id, item.name]), items[0].id);
        const priceInput = input('number', '1');
        priceInput.min = '1';
        priceInput.step = '1';
        priceInput.required = true;
        const reasonInput = input('text', '玩家确认的交易');
        reasonInput.required = true;
        const hint = el('p', '保存后在单笔事务内同步扣除买方金币、增加卖方金币并转移物品归属。', 'tk-record-note');
        openForm(
            drawer,
            '登记交易',
            [
                fieldLabel('买方', buyerSelect),
                fieldLabel('卖方', sellerSelect),
                fieldLabel('物品', itemSelect),
                fieldLabel('价格（金币）', priceInput),
                fieldLabel('交易依据', reasonInput),
                hint,
            ],
            '手动登记交易',
            () => [{
                type: 'purchase',
                buyerId: getSelectValue(buyerSelect),
                sellerId: getSelectValue(sellerSelect),
                itemId: getSelectValue(itemSelect),
                price: Number(priceInput.value),
                source: manualSource(reasonInput.value),
            }],
        );
    }

    function show(next) {
        if (!root || editing || busy) return;
        if (!next) {
            root.replaceChildren();
            root.hidden = true;
            return;
        }
        state = next;
        const wasOpen = Boolean(root.querySelector('details.tk-world-editor-drawer')?.open);
        root.hidden = false;
        root.replaceChildren();
        if (message) {
            const status = el('p', message, 'tk-record-note');
            status.setAttribute('role', 'status');
            root.append(status);
            message = '';
        }

        const summaryLabel = isPeople ? '手动维护人物与关系' : '手动维护世界对象与交易';
        const drawer = el('details', undefined, 'tk-world-editor-drawer');
        drawer.dataset.summaryLabel = summaryLabel;
        drawer.open = wasOpen;
        drawer.append(el('summary', summaryLabel));

        const entities = next.entities || [];
        const peopleCount = entities.filter(item => ['person', 'subject'].includes(item.kind)).length;
        const actorCount = entities.filter(item => ['person', 'organization'].includes(item.kind)).length;
        const itemCount = entities.filter(item => item.kind === 'item').length;

        const actions = el('div', undefined, 'tk-world-editor-actions');
        actions.append(button(isPeople ? '+ 新增人物' : '+ 新增对象', () => renderCreateForm(drawer)));

        if (entities.length) {
            actions.append(
                button('编辑名称', () => renderRenameForm(drawer)),
                button('设置属性', () => renderFieldForm(drawer)),
            );
        }
        if (isPeople && peopleCount >= 2) {
            actions.append(button('绑定关系', () => renderRelationForm(drawer)));
        }
        if (actorCount >= 2 && itemCount >= 1) {
            actions.append(button('登记交易', () => renderPurchaseForm(drawer)));
        }

        const versionNote = el('p', `当前世界档案共有 ${entities.length} 个对象（第 ${next.version} 版 · ${next.branchId}）。`, 'tk-record-note');
        drawer.append(actions, versionNote);
        root.append(drawer);
    }

    return {
        mount(target) {
            root = target;
            doc = target.ownerDocument;
            root.classList.add('tk-world-editor');
        },
        show,
        isEditing: () => editing || busy,
        reset() {
            epoch++;
            editing = false;
            busy = false;
            message = '';
            state = null;
            if (root) {
                root.replaceChildren();
                root.hidden = true;
            }
        },
    };
}
