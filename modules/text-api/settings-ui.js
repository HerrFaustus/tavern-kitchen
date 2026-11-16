import { requestFields, supportsRequestExtras } from '../../shared/common/request-extras.js';
import './settings-ui.css';
import { createIdentifier } from '../../shared/common/identifier.js';
import { createSaveFeedback } from '../agent-core/ui/save-feedback.js';
import { PROVIDER_OPTIONS, TOOL_MODE_OPTIONS } from '../agent-core/provider-resolution.js';
import { samplingParametersFor } from '../agent-core/sampling.js';
import { resolveReasoningCapability, getReasoningModeOptions, getReasoningEffortOptions } from '../agent-core/reasoning-capabilities.js';
import { getModelListAuthOptions, normalizeModelListAuth, supportsModelListAuth } from '../agent-core/model-list-auth.js';
import { AGENT_BINDINGS, featureBinding, readAgentBinding, usableAgentConnection, createPreset, HOST_BINDING, HOST_PROVIDER } from './model.js';
import { PROFILE_FEATURES, profileChoices } from './profiles.js';
import { TEXT_API_COPY as COPY, deletionMessage } from './copy.js';

export function mountTextApiSettings(root, { feature, namespace, transport, library = false }) {
    const doc = root.ownerDocument;
    const win = doc.defaultView;
    const origin = new URL(doc.referrer || win.location.href).origin;
    let settings, draft, selected, busy = false, revision = 0, networkBusy = false, destroyed = false;
    const requests = new Map();
    const element = (tag, text, className) => {
        const node = doc.createElement(tag); if (text != null) node.textContent = text;
        if (className) node.className = className; return node;
    };
    root.classList.add('text-api');
    const fields = element('fieldset');
    let configuration = fields;
    const status = element('div', '', 'text-api-status'); status.setAttribute('role', 'status');
    const retry = element('button', COPY.retry); retry.type = 'button'; retry.hidden = true;
    root.replaceChildren(status, retry, fields);
    const saveFeedback = createSaveFeedback(syncSaveButton);
    function syncSaveButton(value = saveFeedback.current) {
        const button = fields.querySelector('[data-save]');
        if (button) {
            button.disabled = !draft || value.status === 'saving';
            button.textContent = value.status === 'saving' ? COPY.saving : value.status === 'success' ? COPY.saved : '保存';
            button.setAttribute('aria-label', value.status === 'idle' ? COPY.save : button.textContent);
        }
    }
    fields.addEventListener('input', () => saveFeedback.resetSuccess());
    fields.addEventListener('change', () => saveFeedback.resetSuccess());
    function cancelRequests() {
        for (const [requestId, pending] of requests) {
            if (!['models', 'test'].includes(pending.action)) continue;
            win.parent.postMessage({ source: namespace, type: 'TEXT_API_REQUEST', action: 'cancel', targetRequestId: requestId }, origin);
            requests.delete(requestId); win.clearTimeout(pending.timer);
            pending.reject(new Error(COPY.cancelled));
        }
    }
    function feedback(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
    function request(action, extra = {}) {
        if (transport) return transport(action, { feature, ...extra });
        const requestId = createIdentifier();
        return new Promise((resolve, reject) => {
            const timer = win.setTimeout(() => { requests.delete(requestId); reject(new Error(COPY.timeout)); }, ['load', 'mutate'].includes(action) ? 35000 : 190000);
            requests.set(requestId, { resolve, reject, timer, action });
            win.parent.postMessage({ source: namespace, type: 'TEXT_API_REQUEST', requestId, action, feature, ...extra }, origin);
        });
    }
    function receive(event) {
        if (event.origin !== origin || event.source !== win.parent || event.data?.type !== 'TEXT_API_RESULT') return;
        const pending = requests.get(event.data.requestId); if (!pending) return;
        requests.delete(event.data.requestId); win.clearTimeout(pending.timer);
        if (event.data.error) pending.reject(new Error(event.data.error)); else pending.resolve(event.data.result);
    }
    // eslint-disable-next-line no-restricted-syntax -- Checks parent window and exact origin before reading a response.
    win.addEventListener('message', receive);
    function control(label, input, container = configuration) {
        const field = input.matches('input, select, textarea') ? input : input.querySelector('input, select, textarea');
        field?.setAttribute('aria-label', label);
        const wrapper = element('label');
        if (container === configuration) wrapper.dataset.settingSection = 'model';
        wrapper.append(element('span', label), input); container.append(wrapper); return wrapper;
    }
    function input(key, type = 'text', source = draft) {
        const node = element('input'); node.type = type; node.value = source[key] ?? '';
        if (type === 'number') { node.step = 'any'; node.placeholder = COPY.inherit; }
        if (type === 'password') node.autocomplete = 'off';
        node.oninput = () => { source[key] = type === 'number' ? (node.value === '' ? null : Number(node.value)) : node.value; revision++; feedback(''); };
        return node;
    }
    function select(options, value, change) {
        const node = element('select');
        for (const option of options) {
            const item = element('option', option.label); item.value = option.value; item.disabled = !!option.disabled; node.append(item);
        }
        node.value = value ?? '';
        node.onchange = () => { revision++; feedback(''); Promise.resolve().then(() => change(node.value)).catch(error => feedback(error.message, true)); };
        return node;
    }
    function button(label, run) {
        const node = element('button', label); node.type = 'button';
        node.onclick = () => { Promise.resolve().then(run).catch(error => feedback(error.message, true)); };
        return node;
    }
    const statsRow = element('div', null, 'text-api-call-stats');
    const statsText = element('output', '正在读取调用统计…');
    let statsRevision = 0;
    async function refreshStats(action = 'call-stats') {
        const ticket = ++statsRevision;
        const snapshot = await request(action);
        if (destroyed || ticket !== statsRevision) return snapshot;
        const rows = Object.values(snapshot.features);
        const sum = key => rows.reduce((total, row) => total + row[key], 0);
        statsText.textContent = `Agent 任务 ${Object.values(snapshot.tasks || {}).reduce((a,b) => a+b,0)} 次 · 实际请求 ${sum('calls')} 次 · 失败 ${sum('failures')} · 累计 ${(sum('totalMs') / 1000).toFixed(1)} 秒`;
        return snapshot;
    }
    function readStats() {
        if (!destroyed && !doc.hidden) refreshStats().catch(() => { statsText.textContent = '调用统计暂不可用'; });
    }
    if (library) {
        const copyStats = button('复制统计', async () => {
            const snapshot = await refreshStats();
            await win.navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
            feedback('已复制调用统计');
        });
        statsRow.append(statsText, copyStats, button('清空统计', () => refreshStats('clear-call-stats')));
        root.append(statsRow);
        win.addEventListener('focus', readStats);
    }
    function choose(id) {
        revision++; cancelRequests(); selected = id;
        const saved = settings.presets.find(preset => preset.id === id);
        draft = id === HOST_BINDING ? createPreset(id, COPY.host) : saved && createPreset(saved.id, saved.name, saved);
        render();
    }
    async function mutate(mutation, selection = null) {
        if (busy) return;
        busy = true; fields.disabled = true;
        saveFeedback.set({ status: 'idle' });
        feedback(COPY.saving);
        try {
            settings = await request('mutate', { mutation });
            if (!destroyed) choose(selection || (library ? selected : settings.bindings[feature]));
            feedback(COPY.saved);
        } finally {
            busy = false; fields.disabled = false;
            if (fields.querySelector('.text-api-presets')) fields.querySelector('.text-api-presets').disabled = false;
        }
    }
    async function save() {
        if (busy) return;
        busy = true;
        const stamp = revision;
        root.insertBefore(status, fields);
        fields.querySelector('.text-api-presets').disabled = true;
        saveFeedback.set({ status: 'saving' });
        feedback(COPY.saving);
        try {
            const mutation = selected === HOST_BINDING ? { type: 'select-host' }
                : { type: 'save', id: selected, preset: structuredClone(draft) };
            settings = await request('mutate', { mutation });
            if (!destroyed && library) refreshBindingRows();
            // Keep the live draft and its input bindings, including edits made
            // while the submitted snapshot was being saved.
            feedback(stamp === revision ? COPY.saved : '');
            saveFeedback.set({ status: stamp === revision ? 'success' : 'idle' });
        } catch (error) {
            saveFeedback.set({ status: 'error', error: error.message });
            throw error;
        } finally {
            busy = false;
            fields.querySelector('.text-api-presets').disabled = false;
        }
    }
    async function add() {
        const name = await request('dialog', { kind:'input', message:COPY.name, initial:'新配置' });
        if (!name?.trim()) return;
        const id = createIdentifier();
        await mutate({ type: 'add', id, afterId: selected, name, preset: createPreset('', '', { provider: 'openai-compatible' }) }, id);
    }
    async function rename() {
        const saved = settings.presets.find(preset => preset.id === selected);
        const name = await request('dialog', { kind:'input', message:COPY.name, initial:saved.name }); if (!name?.trim() || name === saved.name) return;
        const preservedDraft = structuredClone(draft);
        const oldSelection = selected;
        await mutate({ type: 'rename', id: selected, name });
        selected = oldSelection; draft = { ...preservedDraft, name: name.trim() }; render();
    }
    async function remove() {
        if (settings.presets.length === 1) throw new Error(COPY.last);
        const index = settings.presets.findIndex(preset => preset.id === selected);
        const remaining = settings.presets.filter(preset => preset.id !== selected);
        const replacement = remaining[Math.min(index, remaining.length - 1)];
        const affected = Object.keys(settings.bindings).filter(key => settings.bindings[key] === selected);
        if (library && affected.length) throw new Error('此配置仍被 ' + affected.map(key => PROFILE_FEATURES[key]).join('、') + ' 使用，请先更换调用配置');
        if (!await request('dialog', { kind:'confirm', message:deletionMessage(settings.presets[index].name, replacement.name, affected) })) return;
        await mutate({ type: 'delete', id: selected }, replacement.id);
    }
    async function importTavern(connectionOnly) {
        if (busy) return;
        busy = true; fields.disabled = true; feedback('正在读取酒馆连接…');
        try {
            const result = await request('import', { connectionOnly });
            if (destroyed) return;
            settings = result.settings; choose(result.id); feedback(result.message);
        } finally { busy = false; fields.disabled = false; render(); }
    }
    function renderBindings(parent) {
        const bindings = element('div', null, 'text-api-agent-rows');
        const recall = element('details', null, 'text-api-recall');
        recall.append(element('summary', '检索服务'));
        const option = preset => ({ value: preset.id, label: preset.name });
        const previousName = id => id === HOST_BINDING ? COPY.host : settings.presets.find(item => item.id === id)?.name || '未配置';
        function bindingRow(container, label, current, choices, mutation, help) {
            const selector = select([{value:'', label: help ? '旧配置待选择' : '待配置'}, ...choices], current, async value => {
                if (busy) { selector.value = current; return; }
                fields.disabled = busy = true;
                try {
                    settings = await request('mutate', mutation(value));
                } catch (error) { selector.value = current; throw error; }
                finally { fields.disabled = busy = false; }
                if (destroyed) return;
                render();
                fields.querySelector('[aria-label="' + label + '"]')?.focus();
                feedback('已保存' + label);
            });
            const row = control(label, selector, container);
            if (help) row.append(element('small', help));
            return selector;
        }
        for (const [key, group] of Object.entries(AGENT_BINDINGS)) {
            const state = readAgentBinding(settings, key);
            const help = state.conflict ? group.features.map((feature, index) =>
                PROFILE_FEATURES[feature] + ' · ' + previousName(state.previous[index])).join('，') : '';
            const selector = bindingRow(bindings, group.name + ' Agent', state.id, settings.presets.filter(preset => usableAgentConnection(preset, key)).map(option),
                id => ({ mutation: { type: 'bind-agent', agent: key, id } }), help);
            selector.dataset.agentBinding = key;
            if (!settings.presets.some(preset => usableAgentConnection(preset, key))) {
                selector.parentElement.append(element('small', '在「编辑连接」填写地址和模型。'));
            }
        }
        for (const key of ['embedding', 'rerank']) {
            bindingRow(recall, PROFILE_FEATURES[key], settings.bindings[key] || '', profileChoices(settings, key),
                id => ({ feature: key, mutation: id ? {type:'select', id} : {type:'clear'} }));
        }
        parent.append(bindings);
        return recall;
    }
    function refreshBindingRows() {
        const fragment = doc.createDocumentFragment();
        const recall = renderBindings(fragment), previous = fields.querySelector('.text-api-recall');
        recall.open = previous?.open || false;
        fields.querySelector('.text-api-agent-rows')?.replaceWith(fragment);
        previous?.replaceWith(recall);
    }
    function render() {
        if (destroyed) return;
        if (!library) {
            configuration = fields;
            fields.replaceChildren();
            const choices = [{ value: '', label: COPY.unset, disabled: true },
                ...(feature === 'summary' ? [{ value: HOST_BINDING, label: '跟随酒馆主 API' }] : []), ...profileChoices(settings, feature)];
            const selector = select(choices, settings.bindings[feature], value => {
                mutate(value === HOST_BINDING ? { type: 'select-host' } : { type: 'select', id: value })
                    .catch(error => { selector.value = settings.bindings[feature] || ''; feedback(error.message, true); });
            });
            control(PROFILE_FEATURES[feature] + '使用的配置', selector);
            const current = settings.presets.find(p => p.id === settings.bindings[feature]);
            if (current) configuration.append(element('p', current.model || '此配置尚未选择模型', 'text-api-status'));
            configuration.append(element('p', '请在「API」标签页的「编辑连接」中创建、命名和编辑配置。', 'text-api-status'));
            return;
        }
        const previousFocus = doc.activeElement;
        const focusLabel = fields.contains(previousFocus) ? previousFocus.getAttribute('aria-label') : '';
        const libraryOpen = fields.querySelector('.text-api-library')?.open || false;
        const recallOpen = fields.querySelector('.text-api-recall')?.open || false;
        const parametersOpen = fields.querySelector('.text-api-parameters')?.open || false;
        configuration = element('div', null, 'text-api-configuration');
        fields.replaceChildren();
        const recall = renderBindings(fields); recall.open = recallOpen;
        const libraryDrawer = element('details', null, 'text-api-library'); libraryDrawer.open = libraryOpen;
        libraryDrawer.append(element('summary', '编辑连接'));
        const toolbar = element('fieldset', null, 'text-api-presets');
        toolbar.disabled = busy;
        const choices = settings.presets.map(preset => ({ value: preset.id, label: preset.name }));
        const selector = select(choices, selected, value => {
            choose(value);
        });
        control('选择连接', selector, toolbar);
        const usage = Object.entries(PROFILE_FEATURES).filter(([key]) =>
            featureBinding(settings, key) === selected).map(([,name]) => name);
        toolbar.append(element('small', usage.length ? '用于：' + usage.join('、') : '尚无功能使用此配置'));
        const actions = element('div', null, 'text-api-tools');
        actions.dataset.settingSection = 'function';
        actions.append(button('新建', add));
        if (draft) {
            const saveButton = button('保存', save); saveButton.dataset.save = ''; actions.append(saveButton);
        }
        const imports = element('details'); imports.append(element('summary','从酒馆导入'),
            button('复制完整配置', () => importTavern(false)), button('只复制连接', () => importTavern(true)));
        actions.append(imports);
        if (draft) {
            const more = element('details'), removeButton = button(COPY.remove, remove);
            removeButton.disabled = settings.presets.length === 1 || usage.length > 0;
            more.append(element('summary','更多'),button(COPY.rename,rename),removeButton);
            actions.append(more);
        }
        configuration.append(actions);
        libraryDrawer.append(toolbar, configuration);
        fields.append(libraryDrawer, recall);
        syncSaveButton();
        if (focusLabel) [...fields.querySelectorAll('[aria-label]')].find(node => node.getAttribute('aria-label') === focusLabel)?.focus({ preventScroll: true });
        if (!draft) return;
        control('接口用途', select([{ value: 'text', label: '文本生成' }, { value: 'embedding', label: '向量嵌入' }, { value: 'rerank', label: '重排' }], draft.kind || 'text', value => {
            draft.kind = value; if (value !== 'text') draft.provider = 'openai-compatible'; render();
        }));
        control(COPY.provider, select((draft.kind || 'text') === 'text' ? [{ value: HOST_PROVIDER, label: COPY.host }, ...PROVIDER_OPTIONS] : [{ value: 'openai-compatible', label: 'OpenAI 兼容接口' }], draft.provider, value => { draft.provider = value; render(); }));
        if (draft.provider !== HOST_PROVIDER) {
            control(COPY.url, input('baseUrl'));
            const prefix = element('div', null, 'text-api-grid');
            control(COPY.prefix, select([{ value: 'auto', label: COPY.autoPrefix }, { value: 'custom', label: COPY.customPrefix }], draft.prefixMode, value => { draft.prefixMode = value; render(); }), prefix);
            if (draft.prefixMode === 'custom') control(COPY.customPrefix, input('customPrefix'), prefix);
            prefix.dataset.settingSection = 'model'; configuration.append(prefix);
            const key = input('apiKey', 'password'); const keyRow = element('div', null, 'text-api-inline');
            const reveal = button(COPY.show, () => { key.type = key.type === 'password' ? 'text' : 'password'; reveal.textContent = key.type === 'password' ? COPY.show : COPY.hide; });
            keyRow.append(key, reveal); control(COPY.key, keyRow);
            const modelInput = input('model');
            modelInput.onchange = () => { if ((draft.kind || 'text') === 'text') renderParameters(); };
            control(COPY.model, modelInput);
            if (supportsModelListAuth(draft.provider)) control(COPY.modelListAuth, select(getModelListAuthOptions(draft.provider), normalizeModelListAuth(draft.modelListAuth, draft.provider), value => { draft.modelListAuth = value; }));
        }
        if (supportsRequestExtras(draft.provider)) {
            const extras = element('details', null, 'text-api-request-extras');
            extras.append(element('summary', '附加请求参数'), element('p', '支持 YAML 和 JSON。主体参数覆盖同名字段，随后移除排除项。', 'text-api-status'));
            for (const [key, label, example] of requestFields) {
                const area = element('textarea');
                area.className = 'text_pole'; area.rows = 3; area.spellcheck = false;
                area.value = draft.requestExtras?.[key] || ''; area.placeholder = example;
                area.oninput = () => { (draft.requestExtras ??= {})[key] = area.value; revision++; feedback(''); };
                control(label, area, extras);
            }
            extras.dataset.settingSection = 'model'; configuration.append(extras);
        }
        const modelList = select([{ value: '', label: COPY.manual }], '', value => { if (value) { draft.model = value; render(); } });
        modelList.hidden = true; modelList.setAttribute('aria-label', COPY.pull);
        const networkActions = element('div', null, 'text-api-inline');
        async function connect(action) {
            if (networkBusy) return;
            networkBusy = true;
            networkActions.querySelectorAll('button').forEach(node => { node.disabled = true; });
            root.insertBefore(status, fields);
            const stamp = revision; feedback(action === 'models' ? COPY.pulling : COPY.testing);
            try {
            const result = await request(action, { preset: structuredClone(draft) });
            if (stamp !== revision) return;
            if (action === 'models') {
                modelList.replaceChildren(...[{ value: '', label: COPY.manual }, ...result.map(value => ({ value, label: value }))].map(option => {
                    const node = element('option', option.label); node.value = option.value; return node;
                })); modelList.hidden = false; feedback('已获取 ' + COPY.modelCount(result.length));
            } else feedback(({embedding:'嵌入测试成功',rerank:'重排测试成功'})[draft.kind] || COPY.testOk);
            } catch (error) {
                if (stamp === revision) feedback(error.message, true);
            } finally {
                networkBusy = false;
                fields.querySelectorAll('[data-network]').forEach(node => { node.disabled = false; });
            }
        }
        if (draft.provider !== HOST_PROVIDER) networkActions.append(button('获取模型列表', () => connect('models')));
        networkActions.append(button(({embedding:'测试嵌入',rerank:'测试重排'})[draft.kind] || '测试生成', () => connect('test'))); networkActions.querySelectorAll('button').forEach(node => { node.dataset.network = ''; node.disabled = networkBusy; }); networkActions.dataset.settingSection = modelList.dataset.settingSection = 'function'; configuration.append(networkActions, modelList);
        function renderParameters() {
            const existing = fields.querySelector('.text-api-parameters');
            const details = element('details', null, 'text-api-parameters'); details.open = existing?.open ?? parametersOpen;
            details.append(element('summary', COPY.sampling));
            const grid = element('div', null, 'text-api-grid');
            control(COPY.temperature, input('temperature', 'number'), grid); control(COPY.maxTokens, input('maxTokens', 'number'), grid);
            const stream = element('input'); stream.type = 'checkbox'; stream.checked = draft.stream;
            stream.onchange = () => { draft.stream = stream.checked; revision++; feedback(''); };
            control(COPY.stream, stream, details).classList.add('text-api-check'); details.append(grid);
            for (const parameter of samplingParametersFor(draft.provider === HOST_PROVIDER ? 'sillytavern-openai-compatible' : draft.provider)) {
                const value = input(parameter.key, 'number', { [parameter.key]: draft.sampling[parameter.key]?.enabled ? draft.sampling[parameter.key].value : null });
                value.min = parameter.min; if (parameter.max != null) value.max = parameter.max;
                value.oninput = () => { revision++; feedback(''); draft.sampling[parameter.key] = { enabled: value.value !== '', value: value.value === '' ? parameter.value : Number(value.value) }; };
                control(parameter.label, value, grid);
            }
            if (['openai-compatible', 'sillytavern-openai-compatible'].includes(draft.provider)) {
                control('工具调用方式', select(TOOL_MODE_OPTIONS, draft.toolMode || 'native', value => { draft.toolMode = value; }), details);
            }
            const capability = resolveReasoningCapability(draft);
            if (draft.provider !== HOST_PROVIDER) control(COPY.reasoning, select(getReasoningModeOptions(capability), draft.reasoning.mode || 'inherit', value => { draft.reasoning.mode = value; renderParameters(); }), details);
            if (draft.reasoning.mode === 'on') {
                const efforts = getReasoningEffortOptions(capability);
                if (efforts.length) control(COPY.effort, select([{ value: '', label: COPY.inherit }, ...efforts], draft.reasoning.effort, value => { draft.reasoning.effort = value; }), details);
                if (capability.intensity?.kind === 'budget') control(COPY.budget, input('budgetTokens', 'number', draft.reasoning), details);
            }
            details.dataset.settingSection = 'model';
            if (existing) existing.replaceWith(details); else configuration.append(details);
        }
        if ((draft.kind || 'text') === 'text') renderParameters();
    }
    let refreshId = 0;
    async function refresh() {
        if (busy) return;
        if (library) readStats();
        fields.disabled = true; retry.hidden = true; feedback(COPY.load);
        const id = ++refreshId;
        try {
            const loaded = await request('load');
            if (destroyed || id !== refreshId) return;
            settings = loaded;
            const previous = loaded.presets.some(p => p.id === selected) ? selected : loaded.presets[0]?.id;
            choose(library ? previous : loaded.bindings[feature]);
            feedback('');
        }
        catch (error) { feedback(error.message, true); retry.hidden = false; }
        finally { fields.disabled = !settings; }
    }
    retry.onclick = () => refresh();
    return { refresh() { refresh().catch(error => feedback(error.message, true)); }, destroy() { destroyed = true; revision++; cancelRequests(); saveFeedback.destroy(); win.removeEventListener('focus', readStats); win.removeEventListener('message', receive); for (const pending of requests.values()) { win.clearTimeout(pending.timer); pending.reject(new Error(COPY.cancelled)); } requests.clear(); } };
}
