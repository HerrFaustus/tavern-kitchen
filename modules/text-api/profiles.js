import { createPreset, resolveFeaturePreset, HOST_PROVIDER, HOST_BINDING } from './model.js';
import { normalizeAgentSettings, DEFAULT_MODEL_CONFIGS } from '../agent-core/config.js';
import { resolveApiBaseUrl } from '../../shared/common/openai-url-utils.js';

export const PROFILE_FEATURES = Object.freeze({
    summary: '剧情总结', planner: '剧情规划', memory: '剧情助手',
    world: '世界与地图后台', l0: '召回语义整理', embedding: '向量嵌入', rerank: '召回重排',
});
export function acceptsProfile(feature, preset) {
    const kind = preset.kind || 'text';
    if (['embedding', 'rerank'].includes(feature)) return kind === feature && preset.provider === 'openai-compatible';
    if (kind !== 'text') return false;
    if (feature === 'l0') return preset.provider === 'openai-compatible';
    return feature === 'summary' || preset.provider !== HOST_PROVIDER;
}
export function assertProfileBinding(feature, preset) {
    if (!acceptsProfile(feature, preset)) throw new Error('此配置的接口类型不适用于' + (PROFILE_FEATURES[feature] || feature));
}
export function upgradeProfiles(settings, agent, vector = {}) {
    if (settings.profilesVersion === 1) return settings;
    const next = structuredClone(settings);
    const names = new Set(next.presets.map(p => p.name));
    const unique = base => { let name = base, n = 2; while (names.has(name)) name = base + ' ' + n++; names.add(name); return name; };
    const ids = new Set(next.presets.map(p => p.id));
    const uniqueId = base => { let id = base, n = 2; while (ids.has(id)) id = base + '-' + n++; ids.add(id); return id; };
    const old = normalizeAgentSettings(agent || {});
    for (const [name, preset] of Object.entries(old.presets)) {
        const id = uniqueId('agent-' + next.presets.length);
        const config = preset.modelConfigs[preset.provider];
        next.presets.push(createPreset(id, unique('后台 · ' + name), {
            ...config, provider: preset.provider, temperature: config.sendTemperature === false ? null : config.temperature,
        }));
        if (name === old.currentPresetName) next.bindings.world = next.bindings.memory = id;
        for (const [provider, alternate] of Object.entries(preset.modelConfigs)) {
            if (provider === preset.provider) continue;
            const defaults = DEFAULT_MODEL_CONFIGS[provider];
            if (!alternate.apiKey && alternate.baseUrl === defaults.baseUrl && alternate.model === defaults.model) continue;
            next.presets.push(createPreset(uniqueId('agent-' + next.presets.length), unique('后台 · ' + name + ' · ' + provider), {
                ...alternate, provider, temperature: alternate.sendTemperature === false ? null : alternate.temperature,
            }));
        }
    }
    const defaults = { l0: 'Qwen/Qwen3-8B', embedding: 'BAAI/bge-m3', rerank: 'BAAI/bge-reranker-v2-m3' };
    for (const feature of ['l0', 'embedding', 'rerank']) {
        const config = vector[feature + 'Api'] || {};
        const id = uniqueId('recall-' + feature);
        next.presets.push(createPreset(id, unique(PROFILE_FEATURES[feature]), {
            kind: feature === 'l0' ? 'text' : feature, provider: 'openai-compatible',
            baseUrl: config.url || 'https://api.siliconflow.cn/v1', apiKey: config.key || '', model: config.model || defaults[feature],
        }));
        next.bindings[feature] = id;
        for (const [provider, alternate] of Object.entries(config.providers || {})) {
            if (provider === config.provider || !alternate?.key) continue;
            next.presets.push(createPreset(uniqueId('recall-' + feature + '-' + provider), unique(PROFILE_FEATURES[feature] + ' · ' + provider), {
                kind: feature === 'l0' ? 'text' : feature, provider: 'openai-compatible',
                baseUrl: alternate.url || '', apiKey: alternate.key, model: alternate.model || defaults[feature],
            }));
        }
    }
    next.profilesVersion = 1;
    return next;
}
export function vectorProfiles(settings, fallback) {
    if (!settings?.profilesVersion) return fallback;
    const result = structuredClone(fallback);
    for (const feature of ['l0', 'embedding', 'rerank']) {
        const preset = resolveFeaturePreset(settings, feature);
        assertProfileBinding(feature, preset);
        const connection = { ...preset, baseUrl: resolveApiBaseUrl(preset.baseUrl, preset.prefixMode === 'custom' ? preset.customPrefix : '/v1') };
        result[feature + 'Api'] = { provider: 'custom', url: connection.baseUrl,
            key: connection.apiKey, model: connection.model };
    }
    return result;
}
export function profileChoices(settings, feature) {
    return settings.presets.filter(preset => acceptsProfile(feature, preset))
        .map(preset => ({ value: preset.id, label: preset.name }));
}
export function isHostSelection(id) { return id === HOST_BINDING; }
