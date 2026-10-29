import { TEXT_API_COPY } from './copy.js';
import { createPreset, HOST_PROVIDER, TEXT_API_VERSION } from './model.js';

// Compatibility: the three deployed per-feature API records. Only upgrade/import
// calls this conversion; current settings never carry these field names.
const channels = { st: HOST_PROVIDER, openai: 'sillytavern-openai-compatible', custom: 'sillytavern-openai-compatible',
    google: 'sillytavern-google', gemini: 'sillytavern-google', claude: 'sillytavern-claude', anthropic: 'sillytavern-claude' };
function migrateProvider(channel) {
    if (!channels[channel]) throw new Error(TEXT_API_COPY.invalid);
    return channels[channel];
}
const samplingKeys = { top_p: 'topP', top_k: 'topK', presence_penalty: 'presencePenalty', frequency_penalty: 'frequencyPenalty' };
const present = value => value !== undefined && value !== null && value !== '';
const numeric = value => present(value) ? Number(value) : null;

function samplingFromLegacy(source, { skipZeroTopK = false } = {}) {
    return Object.fromEntries(Object.entries(samplingKeys)
        .filter(([key]) => present(source[key]) && !(skipZeroTopK && key === 'top_k' && Number(source[key]) === 0))
        .map(([key, name]) => [name, { enabled: true, value: Number(source[key]) }]));
}

export function migrateLegacySettings({ summary = {}, planner = {} }) {
    const api = summary.api || {};
    const gen = summary.gen || {};
    const presets = [createPreset('summary-default', '默认1', {
        provider: migrateProvider(api.provider || 'st'), baseUrl: api.url, apiKey: api.key, model: api.model,
        stream: summary.trigger?.useStream, maxTokens: numeric(gen.max_tokens), temperature: numeric(gen.temperature), sampling: samplingFromLegacy(gen),
    })];
    const bindings = { summary: presets[0].id, planner: null };
    const planning = planner.api || {};
    if (['baseUrl', 'apiKey', 'model', 'customPrefix'].some(key => String(planning[key] || '').trim())
        || (planning.channel && planning.channel !== 'openai')
        || ['max_tokens', 'presence_penalty', 'frequency_penalty'].some(key => present(planning[key]))
        || (present(planning.temperature) && Number(planning.temperature) !== 1)
        || (present(planning.top_p) && Number(planning.top_p) !== 1)
        || (present(planning.top_k) && Number(planning.top_k) !== 0)) {
        const preset = createPreset('planner-default', '默认2', {
            provider: migrateProvider(planning.channel || 'openai'), baseUrl: planning.baseUrl, apiKey: planning.apiKey,
            model: planning.model, prefixMode: planning.prefixMode, customPrefix: planning.customPrefix,
            stream: planning.stream, temperature: numeric(planning.temperature), maxTokens: numeric(planning.max_tokens),
            sampling: samplingFromLegacy(planning, { skipZeroTopK: true }),
        });
        presets.push(preset); bindings.planner = preset.id;
    }
    return { version: TEXT_API_VERSION, presets, bindings };
}

export function withoutLegacySummaryApi(config) {
    const next = structuredClone(config);
    delete next.api; delete next.gen;
    if (next.trigger) delete next.trigger.useStream;
    return next;
}
export function withoutLegacyPlannerApi(config) {
    const next = structuredClone(config); delete next.api; return next;
}
