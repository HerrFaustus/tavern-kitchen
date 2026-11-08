import { vectorProfiles } from '../../text-api/profiles.js';
import { getTextApiRepository, getProfileSnapshot } from '../../text-api/repository.js';
import { extension_settings } from "../../../../../../extensions.js";
import { EXT_ID } from "../../../core/constants.js";
import { xbLog } from "../../../core/debug-core.js";
import { CommonSettingStorage } from "../../../core/server-storage.js";
import { SUMMARY_CONFIG_LOCAL_STORAGE_KEY, writeSummaryConfigLocalCache } from './config-local-cache.js';

import { normalizeSummaryDelayFloors } from './summary-delay.js';
import { normalizeSummaryWorkflow } from './summary-workflow.js';
import { normalizeRecallTimeoutSec } from './recall-settings.js';
import { DEFAULT_MEMORY_MAINTENANCE_ENABLED, normalizeProofreading } from '../maintenance/settings.js';
import {
    SUMMARY_ALIAS_RULES, SUMMARY_FACT_UPDATE_RULES, buildSummaryAssistantDocPrompt,
} from './generation-rules.js';

const MODULE_ID = "summaryConfig";
const SUMMARY_CONFIG_KEY = "storySummaryPanelConfig";
const VALID_TRIGGER_TIMINGS = new Set(["after_ai", "before_user"]);
let summaryPanelConfigCache = null;

const DEFAULT_FILTER_RULES = [
    { start: "<think>", end: "</think>" },
    { start: "<thinking>", end: "</thinking>" },
    { start: "```", end: "```" },
];

export const DEFAULT_SUMMARY_SYSTEM_PROMPT = '依据本次原文生成本轮总结和有依据的增量记录。自由文本跟随主要叙事语言。只输出 JSON。';


export function getSummaryAssistantDocPrompt(config = getSummaryPanelConfig()) {
    return buildSummaryAssistantDocPrompt(config.prompts?.summaryStyle);
}

export const DEFAULT_SUMMARY_ASSISTANT_ASK_SUMMARY_PROMPT = '请提供已有剧情与事实。';
export const DEFAULT_SUMMARY_ASSISTANT_ASK_CONTENT_PROMPT = '请提供本次需要总结的正文。';
export const DEFAULT_SUMMARY_META_PROTOCOL_START_PROMPT = '本次输出一个 JSON 对象。';
export const DEFAULT_SUMMARY_USER_JSON_FORMAT_PROMPT = `必填 summary，为本轮总结文本。memoryTags 包含 characters、locations、times、keywords 四个短文本数组。按本轮原文提取，空项用 []。
newCharacters 只列本轮首次需要持续建档的人物，用规范名或可辨认的稳定称呼。
${SUMMARY_FACT_UPDATE_RULES}
${SUMMARY_ALIAS_RULES}`;
export const DEFAULT_SUMMARY_ASSISTANT_CHECK_PROMPT = '已核对人物、来源和本轮实际进展。';
export const DEFAULT_SUMMARY_USER_CONFIRM_PROMPT = '请只输出完整 JSON。';

export const DEFAULT_SUMMARY_USER_GENERATE_PROMPT = '生成本轮总结。';
export const getSummaryPrompts = (config = getSummaryPanelConfig()) => ({
    summarySystemPrompt: DEFAULT_SUMMARY_SYSTEM_PROMPT,
    summaryAssistantDocPrompt: getSummaryAssistantDocPrompt(config),
    summaryAssistantAskSummaryPrompt: DEFAULT_SUMMARY_ASSISTANT_ASK_SUMMARY_PROMPT,
    summaryAssistantAskContentPrompt: DEFAULT_SUMMARY_ASSISTANT_ASK_CONTENT_PROMPT,
    summaryMetaProtocolStartPrompt: DEFAULT_SUMMARY_META_PROTOCOL_START_PROMPT,
    summaryUserJsonFormatPrompt: DEFAULT_SUMMARY_USER_JSON_FORMAT_PROMPT,
    summaryAssistantCheckPrompt: DEFAULT_SUMMARY_ASSISTANT_CHECK_PROMPT,
    summaryUserConfirmPrompt: DEFAULT_SUMMARY_USER_CONFIRM_PROMPT,
    summaryUserGeneratePrompt: DEFAULT_SUMMARY_USER_GENERATE_PROMPT,
});
const DEFAULT_VECTOR_PROVIDER = "siliconflow";
const DEFAULT_L0_URL = "https://api.siliconflow.cn/v1";
const DEFAULT_OPENROUTER_URL = "https://openrouter.ai/api/v1";
const DEFAULT_L0_MODEL = "Qwen/Qwen3-8B";
const DEFAULT_EMBEDDING_MODEL = "BAAI/bge-m3";
const DEFAULT_RERANK_MODEL = "BAAI/bge-reranker-v2-m3";

function getVectorProviderDefaultUrl(provider) {
    return provider === "openrouter" ? DEFAULT_OPENROUTER_URL : DEFAULT_L0_URL;
}

function createDefaultProviderProfile(provider, model = "") {
    return {
        url: provider === "custom" ? "" : getVectorProviderDefaultUrl(provider),
        key: "",
        model: model || "",
        modelCache: [],
    };
}

function normalizeProviderProfiles(supportedProviders, srcProfiles, currentProvider, currentValues, defaultModel) {
    const out = {};
    supportedProviders.forEach((provider) => {
        const raw = srcProfiles?.[provider] || {};
        const defaults = createDefaultProviderProfile(provider, defaultModel);
        out[provider] = {
            url: String(raw.url || defaults.url || "").trim(),
            key: String(raw.key || "").trim(),
            model: String(raw.model || defaults.model || "").trim(),
            modelCache: Array.isArray(raw.modelCache) ? raw.modelCache.filter(Boolean) : [],
        };
    });

    if (currentProvider && out[currentProvider]) {
        const saved = srcProfiles?.[currentProvider] || {};
        if (currentValues?.url && !String(saved.url || '').trim()) out[currentProvider].url = String(currentValues.url).trim();
        if (currentValues?.key && !out[currentProvider].key) out[currentProvider].key = String(currentValues.key).trim();
        if (currentValues?.model && !String(saved.model || '').trim()) out[currentProvider].model = String(currentValues.model).trim();
        if (Array.isArray(currentValues?.modelCache) && !out[currentProvider].modelCache.length) {
            out[currentProvider].modelCache = currentValues.modelCache.filter(Boolean);
        }
    }

    return out;
}

export function getSettings() {
    const ext = (extension_settings[EXT_ID] ||= {});
    ext.storySummary ||= { enabled: true };
    ext.storySummary.enabled = true;
    return ext;
}

function normalizeOpenAiCompatApiConfig(src, defaults = {}) {
    const provider = String(src?.provider || defaults.provider || DEFAULT_VECTOR_PROVIDER).toLowerCase();
    const supportedProviders = Array.isArray(defaults.supportedProviders) && defaults.supportedProviders.length
        ? defaults.supportedProviders
        : [provider, "custom"];
    const providers = normalizeProviderProfiles(
        supportedProviders,
        src?.providers,
        provider,
        src,
        defaults.model || ""
    );
    const current = providers[provider] || createDefaultProviderProfile(provider, defaults.model || "");
    return {
        provider,
        url: String(current.url || "").trim(),
        key: String(current.key || defaults.key || "").trim(),
        model: String(current.model || defaults.model || "").trim(),
        modelCache: Array.isArray(current.modelCache) ? current.modelCache.filter(Boolean) : [],
        providers,
    };
}

function normalizeVectorConfig(rawVector = null) {
    const legacyOnline = rawVector?.online || {};
    const sharedProvider = String(legacyOnline.provider || DEFAULT_VECTOR_PROVIDER).toLowerCase();
    const sharedUrl = String(legacyOnline.url || (sharedProvider === "openrouter" ? DEFAULT_OPENROUTER_URL : DEFAULT_L0_URL)).trim();
    const sharedKey = String(legacyOnline.key || "").trim();

    return {
        enabled: true,
        retrievalMode: 'raw',
        engine: "online",
        l0Concurrency: Math.max(1, Math.min(50, Number(rawVector?.l0Concurrency) || 10)),
        recallTimeoutSec: normalizeRecallTimeoutSec(rawVector?.recallTimeoutSec),
        l0Api: normalizeOpenAiCompatApiConfig(rawVector?.l0Api, {
            provider: sharedProvider,
            url: sharedUrl,
            key: sharedKey,
            model: DEFAULT_L0_MODEL,
            supportedProviders: ["siliconflow", "openrouter", "custom"],
        }),
        embeddingApi: normalizeOpenAiCompatApiConfig(rawVector?.embeddingApi, {
            provider: DEFAULT_VECTOR_PROVIDER,
            url: DEFAULT_L0_URL,
            key: sharedKey,
            model: DEFAULT_EMBEDDING_MODEL,
            supportedProviders: ["siliconflow", "custom"],
        }),
        rerankApi: normalizeOpenAiCompatApiConfig(rawVector?.rerankApi, {
            provider: DEFAULT_VECTOR_PROVIDER,
            url: DEFAULT_L0_URL,
            key: sharedKey,
            model: DEFAULT_RERANK_MODEL,
            supportedProviders: ["siliconflow", "custom"],
        }),
    };
}

function createDefaultSummaryPanelConfig() {
    const defaults = {
        ...normalizeSummaryWorkflow(),
        memoryMaintenanceEnabled: DEFAULT_MEMORY_MAINTENANCE_ENABLED,
        ...normalizeProofreading(),
        trigger: {
            enabled: true,
            notifyOnComplete: false,
            interval: 1,
            delayFloors: 0,
            timing: "after_ai",
            role: "system",
            maxPerRun: 100,
            forceInsertAtEnd: false,
        },
        ui: {
            hideSummarized: true,
            keepVisibleCount: 5, windowUnit: "turn", recallEarlyOriginal: false,
            useVectorBoundary: false,
        },
        textFilterRules: [...DEFAULT_FILTER_RULES],
        prompts: {
            round: '', stage: '', chapter: '',
            summaryStyle: '',
        },
        vector: normalizeVectorConfig(),
    };
    return defaults;
}

function cloneConfig(value) {
    if (typeof structuredClone === "function") {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

function assertSummaryConfigPersisted(expected, actual) {
    if (!actual || typeof actual !== "object") {
        throw new Error("保存后读取配置失败");
    }
    if (actual.memoryMaintenanceEnabled !== expected.memoryMaintenanceEnabled || actual.proofreadingPrompt !== expected.proofreadingPrompt
        || actual.proofreadingInterval !== expected.proofreadingInterval) {
        throw new Error('memory_maintenance_setting_not_saved');
    }
    if (['round', 'stage', 'chapter'].some(level => actual.prompts[level] !== expected.prompts[level])) throw new Error('分层总结提示词未保存');
    if (actual.prompts.summaryStyle !== expected.prompts.summaryStyle) {
        throw new Error('写作要求未保存，请重试');
    }

}

function normalizeSummaryPanelConfig(rawConfig = null) {
    const defaults = createDefaultSummaryPanelConfig();
    const clampKeepVisibleCount = (value) => {
        const n = Number.parseInt(value, 10);
        if (!Number.isFinite(n)) return 5;
        return Math.max(0, Math.min(50, n));
    };

    if (!rawConfig || typeof rawConfig !== "object") {
        return defaults;
    }

    const textFilterRules = Array.isArray(rawConfig.textFilterRules)
        ? rawConfig.textFilterRules
        : (Array.isArray(rawConfig.vector?.textFilterRules)
            ? rawConfig.vector.textFilterRules
            : defaults.textFilterRules);

    const rawPrompts = rawConfig.prompts && typeof rawConfig.prompts === "object"
        ? rawConfig.prompts
        : {};

    const workflow = normalizeSummaryWorkflow(rawConfig);
    const result = {
        summaryWorkflowVersion: workflow.summaryWorkflowVersion,
        memoryMaintenanceEnabled: rawConfig.memoryMaintenanceEnabled !== false,
        ...normalizeProofreading(rawConfig),
        trigger: { ...defaults.trigger, ...workflow.trigger },
        inlineSummary: workflow.inlineSummary,
        ui: { ...defaults.ui, ...(rawConfig.ui || {}) },
        textFilterRules,
        prompts: {
            round: String(rawPrompts.round || '').trim(), stage: String(rawPrompts.stage || '').trim(), chapter: String(rawPrompts.chapter || '').trim(),
            summaryStyle: String(rawPrompts.summaryStyle || '').trim(),
        },
        vector: normalizeVectorConfig(rawConfig.vector || null),
    };


    if (result.trigger.timing === "manual") {
        result.trigger.timing = defaults.trigger.timing;
        result.trigger.enabled = false;
    } else if (!VALID_TRIGGER_TIMINGS.has(result.trigger.timing)) {
        result.trigger.timing = defaults.trigger.timing;
    }
    delete result.trigger.useStream;
    result.trigger.notifyOnComplete = rawConfig?.trigger?.notifyOnComplete === true;
    result.trigger.delayFloors = normalizeSummaryDelayFloors(result.trigger.delayFloors);
    result.ui.hideSummarized = !!result.ui.hideSummarized;
    const previousCount = rawConfig.ui?.keepVisibleCount;
    const legacy = rawConfig.ui?.windowUnit !== 'turn' && previousCount != null;
    result.ui.keepVisibleCount = clampKeepVisibleCount(legacy ? (Number(previousCount) === 6 ? 5 : Math.ceil(Number(previousCount) / 2)) : result.ui.keepVisibleCount);
    result.ui.windowUnit = 'turn';
    result.ui.recallEarlyOriginal = rawConfig.ui?.recallEarlyOriginal === true;
    result.ui.useVectorBoundary = result.ui.useVectorBoundary === true;

    return result;
}

function setSummaryPanelConfigCache(config, { persistLocal = false } = {}) {
    const normalized = normalizeSummaryPanelConfig(config);
    summaryPanelConfigCache = normalized;
    if (persistLocal) {
        writeSummaryConfigLocalCache(normalized, (message, errorName) => xbLog.warn(MODULE_ID, message, errorName));
    }
    return normalized;
}

function ensureSummaryPanelConfigCache() {
    if (summaryPanelConfigCache) return summaryPanelConfigCache;

    try {
        const raw = localStorage.getItem(SUMMARY_CONFIG_LOCAL_STORAGE_KEY);
        if (!raw) {
            return setSummaryPanelConfigCache(createDefaultSummaryPanelConfig(), { persistLocal: false });
        }
        return setSummaryPanelConfigCache(JSON.parse(raw), { persistLocal: false });
    } catch {
        return setSummaryPanelConfigCache(createDefaultSummaryPanelConfig(), { persistLocal: false });
    }
}

export function getSummaryPanelConfig() {
    return cloneConfig(ensureSummaryPanelConfigCache());
}

export function saveSummaryPanelConfig(config) {
    try {
        const normalized = setSummaryPanelConfigCache(config);
        getTextApiRepository().then(repository => repository.load()).then(async () => {
            await CommonSettingStorage.set(SUMMARY_CONFIG_KEY, normalized);
            writeSummaryConfigLocalCache(normalized, (message, errorName) => xbLog.warn(MODULE_ID, message, errorName));
        }).catch((e) => {
            xbLog.error(MODULE_ID, "保存面板配置失败", e);
        });
        return normalized;
    } catch (e) {
        xbLog.error(MODULE_ID, "保存面板配置失败", e);
        return null;
    }
}

export function getVectorConfig() {
    const cfg = ensureSummaryPanelConfigCache();
    return vectorProfiles(getProfileSnapshot(), cfg?.vector ? cloneConfig(cfg.vector) : normalizeVectorConfig());
}

export function getTextFilterRules() {
    const cfg = getSummaryPanelConfig();
    return Array.isArray(cfg?.textFilterRules)
        ? cfg.textFilterRules
        : DEFAULT_FILTER_RULES;
}

export function saveVectorConfig(vectorCfg) {
    try {
        const parsed = ensureSummaryPanelConfigCache();
        parsed.vector = normalizeVectorConfig(vectorCfg || null);
        setSummaryPanelConfigCache(parsed);
        getTextApiRepository().then(repository => repository.load()).then(async () => {
            await CommonSettingStorage.set(SUMMARY_CONFIG_KEY, parsed);
            writeSummaryConfigLocalCache(parsed, (message, errorName) => xbLog.warn(MODULE_ID, message, errorName));
        }).catch((e) => {
            xbLog.error(MODULE_ID, "保存向量配置失败", e);
        });
        return cloneConfig(parsed.vector);
    } catch (e) {
        xbLog.error(MODULE_ID, "保存向量配置失败", e);
        return null;
    }
}

export async function saveSummaryPanelConfigVerified(config) {
    await (await getTextApiRepository()).load();
    const normalized = normalizeSummaryPanelConfig(config);
    await CommonSettingStorage.setAndSave(SUMMARY_CONFIG_KEY, normalized, { silent: false });
    CommonSettingStorage.clearCache();
    const savedConfig = await CommonSettingStorage.getStrict(SUMMARY_CONFIG_KEY, null);
    const savedNormalized = normalizeSummaryPanelConfig(savedConfig);
    assertSummaryConfigPersisted(normalized, savedNormalized);
    setSummaryPanelConfigCache(savedNormalized, { persistLocal: true });
    return cloneConfig(savedNormalized);
}

export async function readSummaryPanelConfigFromServer() {
    const savedConfig = await CommonSettingStorage.getStrict(SUMMARY_CONFIG_KEY, null);
    // Confirmed absence is not a read failure. Preserve local settings without
    // creating or overwriting a server record during initialization.
    return savedConfig ? cloneConfig(normalizeSummaryPanelConfig(savedConfig)) : getSummaryPanelConfig();
}

export function applySummaryPanelConfigSnapshot(config) {
    return cloneConfig(setSummaryPanelConfigCache(config));
}

export async function loadConfigFromServer() {
    await (await getTextApiRepository()).load();
    const loaded = await readSummaryPanelConfigFromServer();
    const applied = applySummaryPanelConfigSnapshot(loaded);
    xbLog.info(MODULE_ID, "已从服务端加载面板配置");
    return applied;
}
