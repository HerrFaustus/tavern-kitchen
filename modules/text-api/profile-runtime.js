import { resolveFeaturePreset } from './model.js';
import { assertProfileBinding } from './profiles.js';
import { resolveConnection } from './runtime.js';
import { normalizeAgentSettings } from '../agent-core/config.js';

export function resolveAgentProfile(settings, feature) {
    const preset = resolveFeaturePreset(settings, feature);
    assertProfileBinding(feature, preset);
    const config = resolveConnection(preset);
    if (!config.model.trim()) throw new Error('请为“' + preset.name + '”选择模型');
    return { ...config, sendTemperature: preset.temperature != null, toolMode: preset.toolMode || 'native' };
}
export function agentSettingsForProfile(settings, feature, legacy = {}) {
    const config = resolveAgentProfile(settings, feature);
    const name = '已绑定配置';
    return normalizeAgentSettings({ ...legacy, currentPresetName: name, presets: {
        [name]: { provider: config.provider, modelConfigs: { [config.provider]: config } },
    } });
}
