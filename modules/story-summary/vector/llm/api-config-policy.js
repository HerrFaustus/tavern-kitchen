import { getDefaultApiPrefix, resolveApiBaseUrl } from '../../../../shared/common/openai-url-utils.js';

/**
 * 解析逗号、分号、竖线或换行分隔的多 Key 配置。
 * @param {string} [rawKey]
 * @returns {string[]}
 */
export function parseVectorApiKeys(rawKey) {
    try {
        return String(rawKey || '')
            .split(/[,;|\n]+/)
            .map(k => k.trim())
            .filter(k => k.length > 0);
    } catch {
        return [];
    }
}

/**
 * 判断向量 / Rerank / L0 端点配置是否可用。
 * 支持常规 API Key，以及显式配置了非默认公共域名且带模型名的无 Key 本地/内网 OpenAI 兼容网关（如 Ollama/vLLM）。
 */
export function isVectorApiConfigured(apiCfg = {}, { defaultPublicHost = 'api.siliconflow.cn' } = {}) {
    if (!apiCfg || typeof apiCfg !== 'object') return false;
    if (parseVectorApiKeys(apiCfg.key).length > 0) return true;
    const rawUrl = String(apiCfg.url || '').trim();
    const rawModel = String(apiCfg.model || '').trim();
    if (!rawUrl || !rawModel) return false;
    try {
        const resolved = resolveApiBaseUrl(rawUrl, getDefaultApiPrefix(apiCfg.provider || 'siliconflow'));
        const parsed = new URL(resolved);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
        // WHY: 默认 SiliconFlow 公共网关始终要求鉴权；无 Key 放行仅适用于显式指向本地或自建兼容端点，
        // 避免未配置 Key 的默认预设也发起必然 401 的无效请求。
        return parsed.hostname.toLowerCase() !== String(defaultPublicHost || '').toLowerCase();
    } catch {
        return false;
    }
}
