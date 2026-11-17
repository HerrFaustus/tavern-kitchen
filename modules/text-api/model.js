import { parseRequestExtras, supportsRequestExtras } from '../../shared/common/request-extras.js';
import { PROVIDER_OPTIONS } from '../agent-core/provider-resolution.js';
import { normalizeModelListAuth } from '../agent-core/model-list-auth.js';
import { TEXT_API_COPY as COPY } from './copy.js';

export const TEXT_API_SETTINGS_KEY = 'textApiPresets';
export const TEXT_API_VERSION = 1;
export const TEXT_API_FEATURES = Object.freeze(['summary', 'planner', 'world', 'opening', 'l0', 'embedding', 'rerank']);
export const HOST_BINDING = '@host';
export const HOST_PROVIDER = 'sillytavern-current';

export const AGENT_BINDINGS = Object.freeze({
    update: { name: '更新', features: ['summary', 'opening'] },
    simulation: { name: '推演', features: ['world'] },
    planner: { name: '编剧', features: ['planner'] },
});

export function usableAgentConnection(preset) {
    return !!preset && (preset.kind || 'text') === 'text' && preset.provider !== HOST_PROVIDER && !!preset.model?.trim() && !!preset.baseUrl?.trim();
}

export function featureBinding(settings, key) {
    const id = settings.bindings[key];
    // Older installations stored null to inherit the world connection. Explicitly clearing the update Agent also disconnects opening.
    if (key === 'opening' && id == null && settings.openingInheritsWorld !== false) return settings.bindings.world;
    return id;
}

export function readAgentBinding(settings, agent) {
    const { features } = AGENT_BINDINGS[agent];
    const ids = features.map(key => featureBinding(settings, key));
    const distinct = [...new Set(ids)];
    const preset = distinct.length === 1 && settings.presets.find(item => item.id === distinct[0]);
    const id = usableAgentConnection(preset, agent) ? preset.id : '';
    return { id, previous: ids, conflict: !id && ids.some(Boolean) };
}

export function createPreset(id, name, input = {}) {
    return {
        id, name, ...(input.requestExtras && supportsRequestExtras(input.provider) && {requestExtras: structuredClone(input.requestExtras)}), kind: input.kind || 'text', toolMode: input.toolMode || 'native', provider: input.provider ?? HOST_PROVIDER,
        baseUrl: input.baseUrl ?? '', apiKey: input.apiKey ?? '', model: input.model ?? '',
        prefixMode: input.prefixMode ?? 'auto', customPrefix: input.customPrefix ?? '',
        stream: input.stream ?? true, temperature: input.temperature ?? null,
        maxTokens: input.maxTokens ?? null, sampling: structuredClone(input.sampling ?? {}),
        reasoning: structuredClone(input.reasoning ?? {}), modelListAuth: normalizeModelListAuth(input.modelListAuth, input.provider),
    };
}

export function assertPreset(preset) {
    const providers = [HOST_PROVIDER, ...PROVIDER_OPTIONS.map(option => option.value)];
    if (!preset || !['text', 'embedding', 'rerank'].includes(preset.kind || 'text') || !providers.includes(preset.provider)
        || !['baseUrl', 'apiKey', 'model', 'customPrefix'].every(key => typeof preset[key] === 'string')
        || !['auto', 'custom'].includes(preset.prefixMode)
        || typeof preset.stream !== 'boolean'
        || [preset.temperature, preset.maxTokens].some(value => value != null && !Number.isFinite(value))
        || (preset.maxTokens != null && (!Number.isInteger(preset.maxTokens) || preset.maxTokens <= 0))
        || Object.values(preset.sampling || {}).some(entry => entry?.enabled && !Number.isFinite(entry.value))) {
        throw new Error(COPY.invalid);
    }
    if (preset.requestExtras) parseRequestExtras(preset);
    return preset;
}

export function assertSettings(value) {
    if (value?.version !== TEXT_API_VERSION || !Array.isArray(value.presets) || !value.presets.length
        || !value.bindings || new Set(value.presets.map(preset => preset.id)).size !== value.presets.length
        || value.presets.some(preset => !preset.id || !preset.name)) throw new Error(COPY.invalid);
    for (const preset of value.presets) assertPreset(preset);
    for (const feature of TEXT_API_FEATURES) {
        const id = value.bindings[feature];
        if (id != null && id !== HOST_BINDING && !value.presets.some(preset => preset.id === id)) throw new Error(COPY.invalid);
    }
    return structuredClone(value);
}

export function resolveBoundPreset(settings, feature) {
    const agent = Object.keys(AGENT_BINDINGS).find(key => AGENT_BINDINGS[key].features.includes(feature));
    if (agent && !readAgentBinding(settings, agent).id) throw new Error('请先在设置中配置' + AGENT_BINDINGS[agent].name + 'agent');
    return resolveFeaturePreset(settings, feature);
}

export function resolveFeaturePreset(settings, feature) {
    const id = featureBinding(settings, feature);
    if (id === HOST_BINDING) return createPreset(HOST_BINDING, COPY.host);
    const preset = settings.presets.find(item => item.id === id);
    if (!preset) throw new Error(COPY.unset);
    return structuredClone(preset);
}

export function applyPresetAction(settings, feature, action) {
    if (feature !== 'library' && !TEXT_API_FEATURES.includes(feature)) throw new Error(COPY.invalid);
    const next = assertSettings(settings);
    const index = next.presets.findIndex(preset => preset.id === action.id);
    if (action.type === 'bind-agent') {
        const group = Object.hasOwn(AGENT_BINDINGS, action.agent) && AGENT_BINDINGS[action.agent];
        if (feature !== 'library' || !group || (action.id && !usableAgentConnection(next.presets[index], action.agent))) throw new Error('请选择已填写地址和模型的独立文本连接');
        for (const key of group.features) next.bindings[key] = action.id || null;
        if (action.agent === 'update') next.openingInheritsWorld = false;
        return next;
    }
    if (action.type === 'clear' && ['embedding', 'rerank', 'l0'].includes(feature)) {
        next.bindings[feature] = null; return next;
    }
    if (action.type === 'select') {
        if (index === -1) throw new Error(COPY.missing);
        next.bindings[feature] = action.id; return next;
    }
    if (action.type === 'select-host') { next.bindings[feature] = HOST_BINDING; return next; }
    if (action.type === 'save' || action.type === 'add' || action.type === 'rename') {
        const name = String(action.type === 'save' ? next.presets[index]?.name ?? '' : action.name ?? action.preset?.name ?? '').trim();
        if (!name) throw new Error(COPY.emptyName);
        if (next.presets.some(preset => preset.name === name && preset.id !== action.id)) throw new Error(COPY.duplicate);
        if (action.type === 'add') {
            if (index !== -1) throw new Error(COPY.duplicate);
            const afterIndex = next.presets.findIndex(preset => preset.id === action.afterId);
            next.presets.splice(afterIndex === -1 ? next.presets.length : afterIndex + 1, 0, createPreset(action.id, name, action.preset));
            if (feature !== 'library') next.bindings[feature] = action.id;
        } else {
            if (index === -1) throw new Error(COPY.missing);
            if (action.type === 'rename') next.presets[index].name = name;
            else {
                next.presets[index] = createPreset(action.id, name, action.preset);
                if (feature !== 'library') next.bindings[feature] = action.id;
            }
        }
    } else if (action.type === 'delete') {
        if (index === -1) throw new Error(COPY.missing);
        if (feature === 'library' && Object.values(next.bindings).includes(action.id)) throw new Error('此配置仍被模块使用，请先更换对应模块的配置');
        if (next.presets.length === 1) throw new Error(COPY.last);
        next.presets.splice(index, 1);
        const replacement = next.presets[Math.min(index, next.presets.length - 1)].id;
        for (const key of TEXT_API_FEATURES) if (next.bindings[key] === action.id) next.bindings[key] = replacement;
    } else throw new Error(COPY.invalid);
    return assertSettings(next);
}
