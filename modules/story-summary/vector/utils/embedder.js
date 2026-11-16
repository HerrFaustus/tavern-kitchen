// ═══════════════════════════════════════════════════════════════════════════
// Story Summary - Embedder
// ═══════════════════════════════════════════════════════════════════════════

import { embed as sfEmbed } from '../llm/siliconflow.js';
import { isVectorApiConfigured } from '../llm/api-config-policy.js';
import { getDefaultApiPrefix, resolveApiBaseUrl } from '../../../../shared/common/openai-url-utils.js';
// ═══════════════════════════════════════════════════════════════════════════
// 统一 embed 接口
// ═══════════════════════════════════════════════════════════════════════════

function looksLikeVectorConfig(value) {
    if (!value || typeof value !== 'object') return false;
    return 'embeddingApi' in value
        || 'l0Api' in value
        || 'rerankApi' in value
        || 'enabled' in value
        || 'engine' in value;
}

export async function embed(texts, configOrOptions, maybeOptions = {}) {
    const hasVectorConfig = looksLikeVectorConfig(configOrOptions);
    const vectorConfig = hasVectorConfig ? configOrOptions : null;
    const options = hasVectorConfig ? maybeOptions : (configOrOptions || {});

    return await sfEmbed(texts, {
        ...options,
        ...(vectorConfig?.embeddingApi ? { apiConfig: vectorConfig.embeddingApi } : {}),
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// 指纹（简化版）
// ═══════════════════════════════════════════════════════════════════════════

export function getEngineFingerprint(config, { dims } = {}) {
    const api = config?.embeddingApi || {};
    const provider = String(api.provider || 'siliconflow').trim().toLowerCase() || 'siliconflow';
    const model = String(api.model || 'BAAI/bge-m3').trim() || 'BAAI/bge-m3';
    const rawUrl = String(api.url || (provider === 'siliconflow' ? ONLINE_PROVIDERS.siliconflow.baseUrl : '')).trim();
    let urlSeg = 'default';
    if (rawUrl) {
        try {
            urlSeg = resolveApiBaseUrl(rawUrl, getDefaultApiPrefix(provider)).replace(/\/+$/, '').toLowerCase() || 'default';
        } catch {
            urlSeg = rawUrl.replace(/\/+$/, '').toLowerCase();
        }
    }
    const explicitDims = Number(dims ?? api.dims ?? api.dimensions ?? config?.vectorDims);
    const hasExplicitDims = Number.isInteger(explicitDims) && explicitDims > 0;
    const dimsSeg = hasExplicitDims ? String(explicitDims) : 'auto';
    // WHY: 保留 0.2.34 默认 SiliconFlow BAAI/bge-m3 历史指纹串，保障老库与 v2 备份包无损兼容；
    // 一旦切换非官方地址、其它模型或显式指定维度（如 384/768/1536/3072），立即产出含规范化 URL 与维度的唯一指纹。
    if (
        provider === 'siliconflow'
        && urlSeg === 'https://api.siliconflow.cn/v1'
        && model === 'BAAI/bge-m3'
        && (!hasExplicitDims || explicitDims === 1024)
    ) {
        return 'siliconflow:BAAI/bge-m3:1024';
    }
    // DO NOT: 对 auto 模式拼入仅存在于内存的临时实测维度，否则会导致构建/修复前后的指纹自相矛盾；服务端悄然换维度由 dimsMismatch 检测。
    return `${provider}:${urlSeg}:${model}:${dimsSeg}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 状态检查（简化版）
// ═══════════════════════════════════════════════════════════════════════════

export async function checkLocalModelStatus() {
    // 不再支持本地模型
    return { status: 'not_supported', message: '请使用在线服务' };
}

export function isLocalModelLoaded() {
    return false;
}

export async function downloadLocalModel() {
    throw new Error('本地模型已移除，请使用在线服务');
}

export function cancelDownload() { }

export async function deleteLocalModelCache() { }

// ═══════════════════════════════════════════════════════════════════════════
// 在线服务测试
// ═══════════════════════════════════════════════════════════════════════════

export async function testOnlineService(_provider, config = {}, { signal } = {}) {
    if (!isVectorApiConfigured(config)) {
        throw new Error('请配置 Embedding API Key 或无 Key 本地接口');
    }

    try {
        const [vec] = await sfEmbed(['测试连接'], { apiConfig: config, signal });
        return { success: true, dims: vec?.length || 0 };
    } catch (e) {
        throw new Error(`连接失败: ${e.message}`, { cause: e });
    }
}

export async function fetchOnlineModels() {
    return ['BAAI/bge-m3'];
}

// ═══════════════════════════════════════════════════════════════════════════
// 兼容旧接口
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_LOCAL_MODEL = 'bge-m3';

export const LOCAL_MODELS = {};

export const ONLINE_PROVIDERS = {
    siliconflow: {
        id: 'siliconflow',
        name: '硅基流动',
        baseUrl: 'https://api.siliconflow.cn/v1',
    },
};
