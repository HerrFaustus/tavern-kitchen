import { protagonistIdentity } from '../story-state/protagonist-identity.js';
import { createIdentifier } from '../../shared/common/identifier.js';
import { BELIEFS, PRESENCE, THREAD_STATUS, availableStoryRecords, parseStoryUpdates } from '../story-state/records.js';
import { FIELD_LABELS, KINDS, NATURES } from './domain.js';
import { PERSON_SECTIONS, POSSESSION_ROLES, RELATION_PREFIX } from './person-fields.js';
import { applyWorldStoryProposal, worldStoryRecords } from './world-story-state.js';

const PRESET_PERSON_FIELDS = [
    ...new Set([
        ...Object.values(PERSON_SECTIONS).flat(),
        'location',
        'owner',
        ...Object.keys(POSSESSION_ROLES),
        'description',
    ]),
];

const PRESET_WORLD_FIELDS = [
    ...new Set([
        ...Object.keys(FIELD_LABELS).filter(k => k !== 'coins'),
        ...Object.keys(POSSESSION_ROLES),
    ]),
];

const REFERENCE_FIELDS = new Set(['owner', 'location', 'parent', ...Object.keys(POSSESSION_ROLES)]);
const PLACE_REFERENCE_FIELDS = new Set(['location', 'parent']);
const MANUAL_STORY_KINDS = [
    ['situation', '局势'],
    ['plan', '计划'],
    ['goal', '目标'],
    ['suspense', '悬念'],
    ['clock', '时钟'],
    ['knowledge', '认知'],
    ['person', '在场人物'],
];

/**
 * Manual world intervention drawer mounted inside the existing people/situation tabs.
 * Every mutation goes through createWorldService commands so provenance, branch scope
 * and optimistic version checks remain uniform with automatic updates.
 */
export function createWorldEditorPanel({ service, getIdentity, section = 'situation', getSelectedPerson, getPlayerName = () => '', getMemorySnapshot = () => null }) {
    let root;
    let doc;
    let state = null;
    let editing = false;
    let busy = false;
    let epoch = 0;
    let message = '';

    const isInventory = section === 'overview';
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
        const chosen = Number.isInteger(node.selectedIndex) ? options[node.selectedIndex] : options.find(option => option.selected);
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

    function openForm(drawer, title, nodes, commitTitle, buildOperations, { needsCommand = false } = {}) {
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
            const returned = root.querySelector('details');
            if (returned) { returned.open = false; returned.querySelector('summary')?.focus(); }
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
                command ||= (() => {
                    if (!needsCommand) return service.command(expected, buildOperations(), commitTitle);
                    const cmd = service.command(expected, [], commitTitle);
                    cmd.operations = buildOperations(cmd);
                    return cmd;
                })();
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
            const id = doc?.getElementById('archive-people')?.dataset.personId;
            if (id) return entities.find(item => item.id === id) || null;
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

        const isWalletInput = () => {
            const raw = fieldInput.value.trim();
            const resolved = resolveFieldKey(raw);
            return resolved === 'coins' || ['coins', '金币', '余额', '钱包'].includes(raw);
        };

        const syncValueMode = () => {
            const fieldKey = resolveFieldKey(fieldInput.value);
            if (isWalletInput()) {
                refSelect.hidden = true;
                textValueInput.hidden = false;
                currentSummary.textContent = '金币余额须通过「调整余额」专用账本维护，不能在此直接设置。';
                return;
            }
            if (REFERENCE_FIELDS.has(fieldKey)) {
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
                fieldLabel('属性名（如 身份、owner、location）', fieldInput),
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
                // WHY: Coins must stay behind the dedicated non-negative ledger form to preserve accounting invariants.
                if (isWalletInput()) throw new Error('金币余额请通过「调整余额」专用账本维护，不能直接覆写。');
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
        const { hero } = protagonistIdentity(state.entities, getPlayerName());
        if (!hero) throw new Error('请先在主角档案核对玩家身份');
        const peers = actors.filter(actor => actor.id !== hero.id);
        const direction = select([['buy', '买入'], ['sell', '卖出']], 'buy');
        const counterparty = select(peers.map(item => [item.id, item.name]), peers[0].id);
        const itemSelect = select(items.map(item => [item.id, item.name]), items[0].id);
        const priceInput = input('number', '1');
        priceInput.min = '1';
        priceInput.step = '1';
        priceInput.required = true;
        const quantityInput = input('number','1');
        quantityInput.min = '1'; quantityInput.step = '1'; quantityInput.required = true;
        const reasonInput = input('text', '玩家确认的交易');
        reasonInput.required = true;
        const hint = el('p', '按本次实际收付的总价，同笔保存主角余额、物品归属和成交回执。', 'tk-record-note');
        openForm(
            drawer,
            '登记交易',
            [
                fieldLabel('主角收支方向', direction),
                fieldLabel('交易对象', counterparty),
                fieldLabel('物品', itemSelect),
                fieldLabel('价格（金币）', priceInput),
                fieldLabel('成交数量',quantityInput),
                fieldLabel('交易依据', reasonInput),
                hint,
            ],
            '手动登记交易',
            () => [{
                type: 'purchase',
                heroId: hero.id,
                buyerId: getSelectValue(direction) === 'buy' ? hero.id : getSelectValue(counterparty),
                sellerId: getSelectValue(direction) === 'sell' ? hero.id : getSelectValue(counterparty),
                itemId: getSelectValue(itemSelect),
                price: Number(priceInput.value),
                quantity: Number(quantityInput.value),
                source: manualSource(reasonInput.value),
            }],
        );
    }

    function renderClearFieldForm(drawer) {
        const entities = state.entities;
        if (!entities.length) return;
        const clearableKeys = entity => Object.keys(entity?.fields || {}).filter(k => k !== 'coins');
        const pref = preferredEntity();
        const defaultEntity = (pref && clearableKeys(pref).length ? pref : entities.find(e => clearableKeys(e).length)) || pref || entities[0];
        const entitySelect = select(entities.map(item => [item.id, entityLabel(item)]), defaultEntity.id);
        const fieldSelect = select([], '');
        const currentNote = el('p', undefined, 'tk-record-note');
        const refreshFields = () => {
            const entity = entities.find(item => item.id === getSelectValue(entitySelect));
            const keys = clearableKeys(entity);
            fieldSelect.replaceChildren();
            for (const key of keys) {
                const opt = el('option', FIELD_LABELS[key] ? `${FIELD_LABELS[key]}（${key}）` : key);
                opt.value = key;
                fieldSelect.append(opt);
            }
            setSelectValue(fieldSelect, keys[0] || '');
            const activeKey = getSelectValue(fieldSelect);
            currentNote.textContent = activeKey
                ? `当前值：${formatValue(entity.fields[activeKey]?.value)}`
                : '该对象暂无可清空的非余额属性。';
        };
        const refreshPreview = () => {
            const entity = entities.find(item => item.id === getSelectValue(entitySelect));
            const key = getSelectValue(fieldSelect);
            currentNote.textContent = key && entity?.fields?.[key]
                ? `当前值：${formatValue(entity.fields[key].value)}`
                : '该对象暂无可清空的非余额属性。';
        };
        entitySelect.addEventListener('change', refreshFields);
        fieldSelect.addEventListener('change', refreshPreview);
        refreshFields();
        openForm(
            drawer,
            '清空对象属性',
            [fieldLabel('目标对象', entitySelect), fieldLabel('要清空的属性', fieldSelect), currentNote],
            '手动清空属性',
            () => {
                const entityId = getSelectValue(entitySelect);
                const field = getSelectValue(fieldSelect);
                if (!field) throw new Error('该对象暂无可清空的非余额属性。');
                return [{ type: 'clear_field', entityId, field }];
            },
        );
    }

    function renderMergeForm(drawer) {
        const entities = state.entities;
        if (entities.length < 2) return;
        const pref = preferredEntity() || entities[0];
        const sourceSelect = select(entities.map(item => [item.id, entityLabel(item)]), pref.id);
        const targetSelect = select([], '');
        const hint = el('p', '合并将把源对象的名称/别名、来源绑定、目标缺失的属性、被引用关系与候选一并并入目标对象，并移除源对象。', 'tk-record-note');
        const confirmCheck = input('checkbox');
        confirmCheck.className = '';
        const confirmWrap = el('label', undefined, 'tk-world-editor-field');
        confirmWrap.append(confirmCheck, el('span', '确认不可逆合并并移除被合并对象'));
        const refreshTargets = () => {
            const src = entities.find(item => item.id === getSelectValue(sourceSelect));
            const compatible = entities.filter(item => item.id !== src?.id && (item.kind === src?.kind || item.kind === 'subject' || src?.kind === 'subject'));
            targetSelect.replaceChildren();
            for (const item of compatible) {
                const opt = el('option', entityLabel(item));
                opt.value = item.id;
                targetSelect.append(opt);
            }
            setSelectValue(targetSelect, compatible[0]?.id || '');
        };
        sourceSelect.addEventListener('change', refreshTargets);
        refreshTargets();
        openForm(
            drawer,
            '合并重复对象',
            [fieldLabel('被合并（将删除）的对象', sourceSelect), fieldLabel('保留并合入的目标对象', targetSelect), hint, confirmWrap],
            '手动合并对象',
            () => {
                const sourceId = getSelectValue(sourceSelect);
                const targetId = getSelectValue(targetSelect);
                if (!targetId) throw new Error('没有兼容类型可合并的目标对象。');
                if (!confirmCheck.checked) throw new Error('请先勾选确认合并操作。');
                return [{ type: 'merge_entities', sourceId, targetId }];
            },
        );
    }

    function renderDeleteForm(drawer) {
        const entities = state.entities;
        if (!entities.length) return;
        const pref = preferredEntity() || entities[0];
        const entitySelect = select(entities.map(item => [item.id, entityLabel(item)]), pref.id);
        const impactNote = el('p', undefined, 'tk-record-note');
        const confirmCheck = input('checkbox');
        confirmCheck.className = '';
        const confirmWrap = el('label', undefined, 'tk-world-editor-field');
        confirmWrap.append(confirmCheck, el('span', '确认永久删除该对象及指向它的引用和候选'));
        const refreshImpact = () => {
            const id = getSelectValue(entitySelect);
            const incoming = entities.filter(e => e.id !== id && Object.values(e.fields || {}).some(f => f?.value?.entityId === id)).length;
            const claimsCount = (state.claims || []).filter(c => c.entityId === id).length;
            impactNote.textContent = `删除将同时清理 ${incoming} 处其他对象的引用及 ${claimsCount} 条关联合同候选。`;
        };
        entitySelect.addEventListener('change', refreshImpact);
        refreshImpact();
        openForm(
            drawer,
            '删除世界对象',
            [fieldLabel('要删除的对象', entitySelect), impactNote, confirmWrap],
            '手动删除对象',
            () => {
                if (!confirmCheck.checked) throw new Error('请先勾选确认删除该对象。');
                return [{ type: 'delete_entity', entityId: getSelectValue(entitySelect) }];
            },
        );
    }

    function renderResolveClaimsForm(drawer) {
        const pending = (state.claims || []).filter(c => c.status === 'pending');
        if (!pending.length) return;
        const prefId = preferredEntity()?.id;
        const sorted = [...pending].sort((a, b) => Number(b.entityId === prefId) - Number(a.entityId === prefId));
        const claimLabel = c => {
            const name = state.entities.find(e => e.id === c.entityId)?.name || c.entityId;
            return `${name} · ${FIELD_LABELS[c.field] || c.field} = ${formatValue(c.value)}（${NATURES[c.nature] || c.nature}）`;
        };
        const claimSelect = select(sorted.map(c => [c.id, claimLabel(c)]), sorted[0].id);
        const detailNote = el('p', undefined, 'tk-record-note');
        const statusSelect = select([['accepted', '采纳为已确认事实'], ['dismissed', '忽略 / 驳回']], 'accepted');
        const syncDetail = () => {
            const c = sorted.find(item => item.id === getSelectValue(claimSelect));
            detailNote.textContent = c ? `来源：${c.source?.label || '未标注'}` : '';
        };
        claimSelect.addEventListener('change', syncDetail);
        syncDetail();
        openForm(
            drawer,
            '裁决待核候选',
            [fieldLabel('待处理候选', claimSelect), detailNote, fieldLabel('裁决结果', statusSelect)],
            '手动裁决候选',
            () => [{ type: 'resolve', claimId: getSelectValue(claimSelect), status: getSelectValue(statusSelect) }],
        );
    }

    function renderCoinsLedgerForm(drawer) {
        const people = state.entities.filter(e => e.kind === 'person');
        if (!people.length) return;
        const { hero } = protagonistIdentity(state.entities, getPlayerName());
        const pref = isInventory ? hero : (preferredEntity()?.kind === 'person' ? preferredEntity() : hero);
        const personSelect = select(people.map(p => [p.id, p.name]), (pref || people[0]).id);
        const modeSelect = select([['set', '设定明确余额'], ['add', '入账（+金币）'], ['sub', '支出（-金币）']], 'set');
        const amountInput = input('number', '0');
        amountInput.min = '0';
        amountInput.step = '1';
        amountInput.required = true;
        const currentNote = el('p', undefined, 'tk-record-note');
        const previewNote = el('p', undefined, 'tk-record-note');
        const reasonInput = input('text', '玩家账本核对');
        reasonInput.required = true;
        const confirmCheck = input('checkbox');
        confirmCheck.className = '';
        const confirmWrap = el('label', undefined, 'tk-world-editor-field');
        confirmWrap.append(confirmCheck, el('span', '确认写入本次金币余额变动'));
        const computeNext = () => {
            const entity = people.find(p => p.id === getSelectValue(personSelect));
            const current = entity?.fields?.coins?.value;
            const base = Number.isSafeInteger(current) ? current : 0;
            const amount = Number(amountInput.value);
            const mode = getSelectValue(modeSelect);
            const nextVal = mode === 'add' ? base + amount : mode === 'sub' ? base - amount : amount;
            return { current, base, nextVal, mode, amount };
        };
        const syncCoins = (resetAmount = false) => {
            const entity = people.find(p => p.id === getSelectValue(personSelect));
            const cur = entity?.fields?.coins?.value;
            if (resetAmount && getSelectValue(modeSelect) === 'set') amountInput.value = String(Number.isSafeInteger(cur) ? cur : 0);
            const { current, nextVal } = computeNext();
            currentNote.textContent = Number.isSafeInteger(current) ? `当前余额：${current} 金币` : '当前尚未建账（按 0 金币起算）';
            previewNote.textContent = Number.isSafeInteger(nextVal) && nextVal >= 0
                ? `调整后余额：${nextVal} 金币`
                : '调整后余额无效（须为非负整数金币）';
        };
        personSelect.addEventListener('change', () => syncCoins(true));
        modeSelect.addEventListener('change', () => syncCoins(true));
        amountInput.addEventListener('input', () => syncCoins(false));
        syncCoins(true);
        openForm(
            drawer,
            '金币账本调整',
            [
                fieldLabel('账户人物', personSelect),
                currentNote,
                fieldLabel('调整方式', modeSelect),
                fieldLabel('金额 / 目标余额（金币）', amountInput),
                previewNote,
                fieldLabel('调整原因（必填）', reasonInput),
                confirmWrap,
            ],
            '手动调整金币余额',
            () => {
                if (!confirmCheck.checked) throw new Error('请先勾选确认登记余额变动。');
                const reason = reasonInput.value.trim();
                if (!reason) throw new Error('请填写余额调整原因。');
                const { nextVal, mode, amount } = computeNext();
                if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(nextVal) || nextVal < 0) {
                    throw new Error('调整后余额必须是非负整数金币。');
                }
                const verb = mode === 'add' ? `+${amount}` : mode === 'sub' ? `-${amount}` : `=${nextVal}`;
                return [{
                    type: 'set',
                    entityId: getSelectValue(personSelect),
                    field: 'coins',
                    value: nextVal,
                    source: manualSource(`账本调整（${verb}）：${reason}`),
                }];
            },
        );
    }

    function renderStoryRecordForm(drawer) {
        const snapshot = getMemorySnapshot?.();
        const baseline = snapshot?.enabled ? availableStoryRecords(snapshot.store, snapshot.invalidFrom) : [];
        const records = worldStoryRecords(state, baseline);
        const modeSelect = select(
            records.length ? [['add', '新增记录'], ['edit', '编辑已有记录'], ['delete', '删除已有记录']] : [['add', '新增记录']],
            'add',
        );
        const recordSelect = select(
            records.map(r => [r.id, `${MANUAL_STORY_KINDS.find(([k]) => k === r.kind)?.[1] || r.kind} · ${r.title || r.label || r.content || r.name || r.id}`]),
            records[0]?.id || '',
        );
        const kindSelect = select(MANUAL_STORY_KINDS, isPeople ? 'plan' : 'situation');
        const titleInput = input('text');
        const descriptionInput = el('textarea', undefined, 'text_pole');
        descriptionInput.rows = 2;
        const holdersInput = input('text', getPlayerName() || '');
        const conditionsInput = input('text');
        const statusNoteInput = input('text');
        const scopeInput = input('text');
        const statusSelect = select(Object.entries(THREAD_STATUS), 'open');
        const dueInput = input('text');
        const reasonInput = input('text');
        const labelInput = input('text');
        const dateInput = input('text');
        const personInput = input('text', getSelectedPerson?.() || '');
        const contentInput = el('textarea', undefined, 'text_pole');
        contentInput.rows = 2;
        const certaintySelect = select(Object.entries(BELIEFS), 'known');
        const evidenceInput = input('text', '玩家人工补录');
        const learnedAtInput = input('text');
        const presenceSelect = select(Object.entries(PRESENCE), 'present');
        const presenceNoteInput = input('text');
        const natureSelect = select([['established_fact', '已确认事实'], ['intention', '计划意图'], ['belief', '角色认知'], ['rumor', '传闻'], ['hypothesis', '推测']], 'established_fact');
        const sourceInput = input('text', '玩家手动维护');
        sourceInput.required = true;
        const confirmDeleteCheck = input('checkbox');
        confirmDeleteCheck.className = '';
        const confirmDeleteWrap = el('label', undefined, 'tk-world-editor-field');
        confirmDeleteWrap.append(confirmDeleteCheck, el('span', '确认删除该条剧情记录'));

        const wraps = {
            record: fieldLabel('选择现有记录', recordSelect),
            kind: fieldLabel('记录类型', kindSelect),
            title: fieldLabel('标题', titleInput),
            description: fieldLabel('具体描述', descriptionInput),
            holders: fieldLabel('持有人（逗号分隔）', holdersInput),
            conditions: fieldLabel('条件约束', conditionsInput),
            statusNote: fieldLabel('当前进展', statusNoteInput),
            scope: fieldLabel('影响范围', scopeInput),
            status: fieldLabel('状态', statusSelect),
            due: fieldLabel('期限', dueInput),
            reason: fieldLabel('结案原因（非进行中时必填）', reasonInput),
            label: fieldLabel('故事时间文本', labelInput),
            date: fieldLabel('可计算日期 YYYY-MM-DD（可留空）', dateInput),
            person: fieldLabel('人物名', personInput),
            content: fieldLabel('认知内容', contentInput),
            certainty: fieldLabel('认知性质', certaintySelect),
            evidence: fieldLabel('获知依据', evidenceInput),
            learnedAt: fieldLabel('获知时间', learnedAtInput),
            presence: fieldLabel('在场度', presenceSelect),
            presenceNote: fieldLabel('在场依据', presenceNoteInput),
            nature: fieldLabel('记录性质', natureSelect),
            source: fieldLabel('来源说明', sourceInput),
            confirmDelete: confirmDeleteWrap,
        };

        const populateFromRecord = r => {
            if (!r) return;
            setSelectValue(kindSelect, r.kind);
            titleInput.value = r.title || '';
            descriptionInput.value = r.description || '';
            holdersInput.value = (r.holders || []).join('，');
            conditionsInput.value = r.conditions || '';
            statusNoteInput.value = r.statusNote || '';
            scopeInput.value = r.scope || '';
            setSelectValue(statusSelect, r.status || 'open');
            dueInput.value = r.due || '';
            reasonInput.value = r.reason || '';
            labelInput.value = r.label || '';
            dateInput.value = r.date || '';
            personInput.value = r.kind === 'knowledge' ? (r.person || '') : (r.name || '');
            contentInput.value = r.content || '';
            setSelectValue(certaintySelect, r.certainty || 'known');
            evidenceInput.value = r.evidence || '玩家人工补录';
            learnedAtInput.value = r.learnedAt || '';
            setSelectValue(presenceSelect, r.presence || 'present');
            presenceNoteInput.value = r.note || '';
            setSelectValue(natureSelect, r._nature || 'established_fact');
        };

        const syncVisibility = () => {
            const mode = getSelectValue(modeSelect);
            const isDelete = mode === 'delete';
            const kind = getSelectValue(kindSelect);
            wraps.record.hidden = mode === 'add';
            wraps.kind.hidden = isDelete;
            kindSelect.disabled = mode === 'edit';
            wraps.confirmDelete.hidden = !isDelete;
            wraps.source.hidden = false;

            const isThread = ['situation', 'plan', 'goal', 'suspense'].includes(kind);
            const isAgenda = ['plan', 'goal'].includes(kind);
            wraps.title.hidden = isDelete || !isThread;
            wraps.description.hidden = isDelete || !isThread;
            wraps.holders.hidden = isDelete || !isAgenda;
            wraps.conditions.hidden = isDelete || !isAgenda;
            wraps.statusNote.hidden = isDelete || !isAgenda;
            wraps.scope.hidden = isDelete || kind !== 'situation';
            wraps.status.hidden = isDelete || !isThread;
            wraps.due.hidden = isDelete || !isThread;
            wraps.reason.hidden = isDelete || !isThread;
            wraps.label.hidden = isDelete || kind !== 'clock';
            wraps.date.hidden = isDelete || kind !== 'clock';
            wraps.person.hidden = isDelete || !['knowledge', 'person'].includes(kind);
            wraps.content.hidden = isDelete || kind !== 'knowledge';
            wraps.certainty.hidden = isDelete || kind !== 'knowledge';
            wraps.evidence.hidden = isDelete || kind !== 'knowledge';
            wraps.learnedAt.hidden = isDelete || kind !== 'knowledge';
            wraps.presence.hidden = isDelete || kind !== 'person';
            wraps.presenceNote.hidden = isDelete || kind !== 'person';
            wraps.nature.hidden = isDelete || !['plan', 'goal', 'knowledge'].includes(kind);
        };

        modeSelect.addEventListener('change', () => {
            if (getSelectValue(modeSelect) !== 'add') {
                populateFromRecord(records.find(r => r.id === getSelectValue(recordSelect)));
            }
            syncVisibility();
        });
        recordSelect.addEventListener('change', () => {
            if (getSelectValue(modeSelect) !== 'add') {
                populateFromRecord(records.find(r => r.id === getSelectValue(recordSelect)));
            }
            syncVisibility();
        });
        kindSelect.addEventListener('change', syncVisibility);
        syncVisibility();

        openForm(
            drawer,
            '维护剧情状态记录',
            [
                fieldLabel('操作类型', modeSelect),
                ...Object.values(wraps),
            ],
            '手动维护剧情记录',
            cmd => {
                const mode = getSelectValue(modeSelect);
                const src = manualSource(sourceInput.value);
                if (mode === 'delete') {
                    if (!confirmDeleteCheck.checked) throw new Error('请先勾选确认删除该条剧情记录。');
                    const target = records.find(r => r.id === getSelectValue(recordSelect));
                    if (!target) throw new Error('未找到要删除的剧情记录。');
                    const [parsed] = parseStoryUpdates([{ id: target.id, kind: target.kind, remove: true }], { requireHolders: true });
                    const applied = applyWorldStoryProposal(
                        state,
                        { record: parsed, nature: 'established_fact' },
                        src,
                        (cmd.expectedVersion ?? state.version) + 1,
                        `event:${cmd.id}`,
                        `manual:${cmd.id}:${parsed.id}`,
                        { start: 0, end: 0 },
                    );
                    return [{ type: 'module', module: 'story', value: applied.value }];
                }
                const kind = mode === 'edit'
                    ? (records.find(r => r.id === getSelectValue(recordSelect))?.kind || getSelectValue(kindSelect))
                    : getSelectValue(kindSelect);
                const id = mode === 'edit'
                    ? getSelectValue(recordSelect)
                    : (kind === 'clock' ? 'clock' : `manual-${createIdentifier()}`);
                let raw = { id, kind };
                if (kind === 'clock') {
                    raw = { ...raw, label: labelInput.value.trim(), date: dateInput.value.trim() };
                } else if (kind === 'person') {
                    raw = { ...raw, name: personInput.value.trim(), presence: getSelectValue(presenceSelect), note: presenceNoteInput.value.trim() };
                } else if (kind === 'knowledge') {
                    raw = {
                        ...raw,
                        person: personInput.value.trim(),
                        content: contentInput.value.trim(),
                        certainty: getSelectValue(certaintySelect),
                        evidence: evidenceInput.value.trim(),
                        learnedAt: learnedAtInput.value.trim(),
                    };
                } else {
                    raw = {
                        ...raw,
                        title: titleInput.value.trim(),
                        description: descriptionInput.value.trim(),
                        status: getSelectValue(statusSelect),
                        due: dueInput.value.trim(),
                        reason: reasonInput.value.trim(),
                        ...(kind === 'situation' && scopeInput.value.trim() ? { scope: scopeInput.value.trim() } : {}),
                        ...(['plan', 'goal'].includes(kind) ? {
                            holders: holdersInput.value.split(/[,，]/).map(item => item.trim()).filter(Boolean),
                            conditions: conditionsInput.value.trim(),
                            statusNote: statusNoteInput.value.trim(),
                        } : {}),
                    };
                }
                const [parsed] = parseStoryUpdates([raw], { requireHolders: true });
                let nature = 'established_fact';
                if (['plan', 'goal'].includes(kind)) {
                    const picked = getSelectValue(natureSelect);
                    nature = ['established_fact', 'intention'].includes(picked) ? picked : 'established_fact';
                } else if (kind === 'knowledge') {
                    const picked = getSelectValue(natureSelect);
                    nature = ['established_fact', 'belief', 'rumor', 'hypothesis'].includes(picked) ? picked : 'established_fact';
                }
                const applied = applyWorldStoryProposal(
                    state,
                    { record: parsed, nature },
                    src,
                    (cmd.expectedVersion ?? state.version) + 1,
                    `event:${cmd.id}`,
                    `manual:${cmd.id}:${parsed.id}`,
                    { start: 0, end: 0 },
                );
                return [{ type: 'module', module: 'story', value: applied.value }];
            },
            { needsCommand: true },
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

        const summaryLabel = isPeople ? '编辑人物' : isInventory ? '主角物品栏交易' : '手动维护世界对象';
        const drawer = el('details', undefined, 'tk-world-editor-drawer');
        drawer.dataset.summaryLabel = summaryLabel;
        drawer.open = wasOpen;
        drawer.append(el('summary', summaryLabel));

        const entities = next.entities || [];
        const peopleCount = entities.filter(item => ['person', 'subject'].includes(item.kind)).length;
        const personCount = entities.filter(item => item.kind === 'person').length;
        const actorCount = entities.filter(item => ['person', 'organization'].includes(item.kind)).length;
        const itemCount = entities.filter(item => item.kind === 'item').length;
        const hasClearableField = entities.some(item => Object.keys(item.fields || {}).some(k => k !== 'coins'));
        const pendingClaimsCount = (next.claims || []).filter(item => item.status === 'pending').length;

        const actions = el('div', undefined, 'tk-world-editor-actions');
        if (!isInventory) actions.append(button(isPeople ? '+ 新增人物' : '+ 新增对象', () => renderCreateForm(drawer)));

        if (!isInventory && entities.length && (!isPeople || preferredEntity())) {
            actions.append(
                button('编辑名称', () => renderRenameForm(drawer)),
                button('设置属性', () => renderFieldForm(drawer)),
            );
            if (hasClearableField) actions.append(button('清空属性', () => renderClearFieldForm(drawer)));
            if (entities.length >= 2) actions.append(button('合并对象', () => renderMergeForm(drawer)));
            actions.append(button('删除对象', () => renderDeleteForm(drawer)));
        }
        if (isPeople && peopleCount >= 2 && preferredEntity()) {
            actions.append(button('绑定关系', () => renderRelationForm(drawer)));
        }
        if (isInventory && protagonistIdentity(entities, getPlayerName()).hero && actorCount >= 2 && itemCount >= 1) {
            actions.append(button('登记交易', () => renderPurchaseForm(drawer)));
        }
        if (personCount >= 1 && (isInventory ? protagonistIdentity(entities, getPlayerName()).hero : (!isPeople || preferredEntity()?.kind === 'person'))) {
            actions.append(button('调整余额', () => renderCoinsLedgerForm(drawer)));
        }
        if (!isInventory) {
            if (pendingClaimsCount > 0) actions.append(button(`裁决候选（${pendingClaimsCount}）`, () => renderResolveClaimsForm(drawer)));
            actions.append(button('维护剧情记录', () => renderStoryRecordForm(drawer)));
        }

        const versionNote = el('p', `当前世界档案共有 ${entities.length} 个对象（第 ${next.version} 版 · ${next.branchId}）。`, 'tk-record-note');
        drawer.append(actions, versionNote);
        root.append(drawer);
    }

    const personChanged = () => {
        if (busy || !state) return;
        editing = false;
        const drawer = root?.querySelector('details'); if (drawer) drawer.open = false;
        show(state);
    };
    return {
        mount(target) {
            if (isPeople && root !== target) {
                root?.closest('#archive-people')?.removeEventListener('kitchen-person-changed', personChanged);
                target.closest('#archive-people')?.addEventListener('kitchen-person-changed', personChanged);
            }
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
