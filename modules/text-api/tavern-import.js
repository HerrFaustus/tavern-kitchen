import { createPreset } from './model.js';
const SOURCES = {
    openai: ['sillytavern-openai-compatible', 'https://api.openai.com/v1', 'OPENAI'],
    custom: ['sillytavern-openai-compatible', '', 'CUSTOM'],
    claude: ['sillytavern-claude', 'https://api.anthropic.com/v1', 'CLAUDE'],
    makersuite: ['sillytavern-google', 'https://generativelanguage.googleapis.com/v1beta', 'MAKERSUITE'],
    openrouter: ['sillytavern-openai-compatible', 'https://openrouter.ai/api/v1', 'OPENROUTER'],
    deepseek: ['sillytavern-openai-compatible', 'https://api.deepseek.com/beta', 'DEEPSEEK'],
    groq: ['sillytavern-openai-compatible', 'https://api.groq.com/openai/v1', 'GROQ'],
    siliconflow: ['sillytavern-openai-compatible', 'https://api.siliconflow.com/v1', 'SILICONFLOW'],
    mistralai: ['sillytavern-openai-compatible', 'https://api.mistral.ai/v1', 'MISTRALAI'],
    xai: ['sillytavern-openai-compatible', 'https://api.x.ai/v1', 'XAI'],
};
export async function snapshotTavernApi({ mainApi, settings, model, findSecret, secretKeys }, connectionOnly = false) {
    if (mainApi !== 'openai') throw new Error('当前酒馆主接口不是聊天补全接口，请手动创建配置');
    const source = settings.chat_completion_source;
    const mapping = SOURCES[source];
    if (!mapping) throw new Error('暂不支持自动复制此酒馆渠道，请手动创建配置：' + source);
    const [provider, defaultUrl, secretName] = mapping;
    const proxy = ['openai', 'claude', 'makersuite'].includes(source) && settings.reverse_proxy;
    const baseUrl = source === 'custom' ? settings.custom_url : proxy || (source === 'siliconflow' && settings.siliconflow_endpoint === 'cn' ? 'https://api.siliconflow.cn/v1' : defaultUrl);
    if (!String(baseUrl || '').trim()) throw new Error('酒馆主接口尚未配置地址');
    const apiKey = proxy ? String(settings.proxy_password || '') : String(await findSecret(secretKeys[secretName]) || '');
    const sampling = {};
    if (!connectionOnly) {
        for (const [field, key] of Object.entries({ top_p_openai: 'topP', top_k_openai: 'topK', freq_pen_openai: 'frequencyPenalty', pres_pen_openai: 'presencePenalty' })) {
            if (Number.isFinite(settings[field])) sampling[key] = { enabled: true, value: settings[field] };
        }
    }
    const preset = createPreset('', '', { provider, baseUrl, apiKey,
        model: connectionOnly ? '' : String(model || ''),
        temperature: connectionOnly ? null : settings.temp_openai,
        maxTokens: connectionOnly ? null : settings.openai_max_tokens,
        stream: settings.stream_openai !== false, sampling,
    });
    return { preset, message: [connectionOnly ? '连接已复制，请选择模型并保存。' : '已复制酒馆主接口的连接、模型与生成参数。',
        !apiKey ? '宿主未返回可复制的密钥，请补填 API Key（无鉴权本地接口可留空）。' : '',
        source === 'custom' && (settings.custom_include_headers || settings.custom_include_body || settings.custom_exclude_body) ? '自定义请求头和请求体扩展未复制，请检查此接口是否依赖这些设置。' : '',
    ].filter(Boolean).join(' ') };
}
export async function importCurrentTavernApi(connectionOnly = false) {
    const [{ main_api }, { oai_settings, getChatCompletionModel }, { findSecret, SECRET_KEYS }] = await Promise.all([
        import('../../../../../../script.js'), import('../../../../../openai.js'), import('../../../../../secrets.js'),
    ]);
    return snapshotTavernApi({ mainApi: main_api, settings: structuredClone(oai_settings),
        model: getChatCompletionModel(), findSecret, secretKeys: SECRET_KEYS }, connectionOnly);
}
