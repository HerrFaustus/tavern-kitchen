import { protagonistIdentity } from '../story-state/protagonist-identity.js';
import { projectPersonalAgendas } from '../story-state/records.js';
import { renderWorldAttributes, renderPersonalAgendas, renderPersonState, renderThreads } from '../story-state/view.js';
import { buildCharacterIdentity } from './data/character-aliases.js';
import { WORKSPACE_COPY } from './workspace-copy.js';
// story-summary-ui.js
// iframe 内 UI 逻辑

import { ARCHIVE_COPY, createSummaryArchive, getArchiveCharacters } from './archive-view.js';
import { DEFAULT_SUMMARY_DELAY_FLOORS } from './data/summary-delay.js';
import { normalizeSummaryWorkflow, SUMMARY_BATCH_FLOORS } from './data/summary-workflow.js';
import { DEFAULT_RECALL_TIMEOUT_SEC, MAX_RECALL_TIMEOUT_SEC, normalizeRecallTimeoutSec } from './data/recall-settings.js';
import { RELATION_TRENDS } from './data/fact-predicates.js';
import { createMemoryMaintenancePage } from './maintenance/ui.js';
import { MEMORY_COPY } from './maintenance/copy.js';
import { MEMORY_CHAT_MESSAGES } from './maintenance/chat-contract.js';
import { DEFAULT_MEMORY_MAINTENANCE_ENABLED, normalizeProofreading } from './maintenance/settings.js';
import { SUMMARY_FEEDBACK_COPY } from './feedback-copy.js';
import { SUMMARY_CONFIG_LOCAL_STORAGE_KEY } from './data/config-local-cache.js';

const UNANNOTATED_LABEL = '未标注';

(function () {
    'use strict';
    let memoryMaintenancePage;
    let archiveView;
    let settingsDirty = false;
    const dirtyFields = new Set();
    let settingsSnapshot;
    let settingsSaving = false;
    // ═══════════════════════════════════════════════════════════════════════════
    // DOM Helpers
    // ═══════════════════════════════════════════════════════════════════════════

    const $ = id => document.getElementById(id);
    const $$ = sel => document.querySelectorAll(sel);
    const h = v => String(v ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
    const setHtml = (el, html) => {
        if (!el) return;
        const range = document.createRange();
        range.selectNodeContents(el);
        // eslint-disable-next-line no-unsanitized/method -- Callers supply this UI's templates and escape interpolated data with h().
        const fragment = range.createContextualFragment(String(html ?? ''));
        el.replaceChildren(fragment);
    };
    

    // ═══════════════════════════════════════════════════════════════════════════
    // Constants
    // ═══════════════════════════════════════════════════════════════════════════

    const PARENT_ORIGIN = (() => {
        try { return new URL(document.referrer).origin; }
        catch { return window.location.origin; }
    })();

    const VECTOR_PROVIDER_DEFAULTS = {
        siliconflow: { url: 'https://api.siliconflow.cn/v1', needKey: true, canFetch: true },
        openrouter: { url: 'https://openrouter.ai/api/v1', needKey: true, canFetch: true },
        custom: { url: '', needKey: true, canFetch: true }
    };

    const VECTOR_API_SUPPORTED_PROVIDERS = {
        l0: ['siliconflow', 'openrouter', 'custom'],
        embedding: ['siliconflow', 'custom'],
        rerank: ['siliconflow', 'custom'],
    };

    const VECTOR_API_DEFAULT_MODELS = {
        l0: 'Qwen/Qwen3-8B',
        embedding: 'BAAI/bge-m3',
        rerank: 'BAAI/bge-reranker-v2-m3',
    };

    

    function setStatusText(el, message, kind = '') {
        if (!el) return;
        el.textContent = message || '';
        el.style.color = kind === 'error'
            ? '#ef4444'
            : kind === 'success'
                ? '#22c55e'
                : kind === 'loading'
                    ? '#f59e0b'
                    : '';
    }

    

    function createDefaultProviderProfile(provider, model = '') {
        const pv = VECTOR_PROVIDER_DEFAULTS[provider] || VECTOR_PROVIDER_DEFAULTS.custom;
        return {
            url: pv.url || '',
            key: '',
            model: model || '',
            modelCache: [],
        };
    }

    function normalizeProviderProfiles(prefix, apiCfg = {}) {
        const supported = VECTOR_API_SUPPORTED_PROVIDERS[prefix] || ['custom'];
        const model = apiCfg.model || VECTOR_API_DEFAULT_MODELS[prefix] || '';
        const out = {};
        supported.forEach(provider => {
            const raw = apiCfg.providers?.[provider] || {};
            const defaults = createDefaultProviderProfile(provider, model);
            out[provider] = {
                url: String(raw.url || defaults.url || '').trim(),
                key: String(raw.key || '').trim(),
                model: String(raw.model || defaults.model || '').trim(),
                modelCache: Array.isArray(raw.modelCache) ? raw.modelCache.filter(Boolean) : [],
            };
        });

        const currentProvider = String(apiCfg.provider || supported[0] || 'custom').toLowerCase();
        if (out[currentProvider]) {
            const saved = apiCfg.providers?.[currentProvider] || {};
            if (apiCfg.url && !String(saved.url || '').trim()) out[currentProvider].url = String(apiCfg.url).trim();
            if (apiCfg.key && !out[currentProvider].key) out[currentProvider].key = String(apiCfg.key).trim();
            if (apiCfg.model && !String(saved.model || '').trim()) out[currentProvider].model = String(apiCfg.model).trim();
            if (Array.isArray(apiCfg.modelCache) && !out[currentProvider].modelCache.length) {
                out[currentProvider].modelCache = apiCfg.modelCache.filter(Boolean);
            }
        }

        return out;
    }

    const SECTION_META = {
        characters: { title: '编辑人物关系', hint: '编辑时，每个要素都应完整' },
        facts: { title: '编辑事实图谱', hint: '每行一条：主体|谓词|值|趋势(可选)。删除用：主体|谓词|（留空值）' },
    };

    const TREND_CLASS = {
        '破裂': 'trend-broken', '厌恶': 'trend-hate', '反感': 'trend-dislike',
        '陌生': 'trend-stranger', '投缘': 'trend-click', '亲密': 'trend-close', '交融': 'trend-merge'
    };

    const DEFAULT_FILTER_RULES = [
        { start: '<think>', end: '</think>' },
        { start: '<thinking>', end: '</thinking>' },
        { start: '```', end: '```' },
    ];
    const VALID_TRIGGER_TIMINGS = new Set(['after_ai', 'before_user']);

    // ═══════════════════════════════════════════════════════════════════════════
    // State
    // ═══════════════════════════════════════════════════════════════════════════

    const config = {
        ...normalizeSummaryWorkflow(),
        memoryMaintenanceEnabled: DEFAULT_MEMORY_MAINTENANCE_ENABLED,
        ...normalizeProofreading(),
        trigger: { enabled: true, interval: 1, delayFloors: DEFAULT_SUMMARY_DELAY_FLOORS, timing: 'after_ai', role: 'system', maxPerRun: 100, forceInsertAtEnd: false },
        ui: { hideSummarized: true, keepVisibleCount: 5, windowUnit: "turn", recallEarlyOriginal: false, useVectorBoundary: false },
        textFilterRules: [...DEFAULT_FILTER_RULES],
        vector: {
            enabled: true,
            engine: 'online',
            l0Concurrency: 10,
            recallTimeoutSec: DEFAULT_RECALL_TIMEOUT_SEC,
            l0Api: {
                provider: 'siliconflow', url: 'https://api.siliconflow.cn/v1', key: '', model: 'Qwen/Qwen3-8B', modelCache: [],
                providers: {
                    siliconflow: createDefaultProviderProfile('siliconflow', 'Qwen/Qwen3-8B'),
                    openrouter: createDefaultProviderProfile('openrouter', 'Qwen/Qwen3-8B'),
                    custom: createDefaultProviderProfile('custom', 'Qwen/Qwen3-8B'),
                }
            },
            embeddingApi: {
                provider: 'siliconflow', url: 'https://api.siliconflow.cn/v1', key: '', model: 'BAAI/bge-m3', modelCache: [],
                providers: {
                    siliconflow: createDefaultProviderProfile('siliconflow', 'BAAI/bge-m3'),
                    custom: createDefaultProviderProfile('custom', 'BAAI/bge-m3'),
                }
            },
            rerankApi: {
                provider: 'siliconflow', url: 'https://api.siliconflow.cn/v1', key: '', model: 'BAAI/bge-reranker-v2-m3', modelCache: [],
                providers: {
                    siliconflow: createDefaultProviderProfile('siliconflow', 'BAAI/bge-reranker-v2-m3'),
                    custom: createDefaultProviderProfile('custom', 'BAAI/bge-reranker-v2-m3'),
                }
            }
        }
    };

    let summaryData = { rounds: [], characters: { main: [], relationships: [] }, facts: [], characterAliases: [] };
    let localGenerating = false;
    let vectorGenerating = false;
    let currentEditSection = null;
    let currentEditBaseline = null;
    let currentCharacterId = null;
    let lastRecallLogText = '';
    let recallHistoryEntries = [];
    let selectedRecallRoundId = '';
    let configSaveSeq = 0;
    let currentTimelineChatId = '';
    let tlUnfilteredPage = null;
    const TL_PAGE_SIZE = 20;
    const TL_PAGING_KEY = 'xb-tl-paging';
    const TL_PAGE_KEY = 'xb-tl-page';
    let tlPagingEnabled = false;
    let tlCurrentPage = -1;
    let tlRootCount = 0;
    let settingsSaveTimeoutId = null;
    let currentChatSummaryState = { hasChat: false, chatEnabled: true, effectiveEnabled: false, changing: true };
    let summaryStatusId = 0;
    let panelConfigLoad = { status: 'loading', error: '' };
    let settingsOpenedWithServerConfig = false;
    const pendingConfigSaveRequests = new Map();

    // ═══════════════════════════════════════════════════════════════════════════
    // Messaging
    // ═══════════════════════════════════════════════════════════════════════════

    function postMsg(type, data = {}) {
        window.parent.postMessage({ source: 'TavernKitchen-StoryFrame', type, ...data }, PARENT_ORIGIN);
    }

    function nextConfigSaveRequestId() {
        configSaveSeq += 1;
        return `summary-config-save-${Date.now()}-${configSaveSeq}`;
    }

    function resetSettingsSaveUi() {
        if (settingsSaveTimeoutId) {
            clearTimeout(settingsSaveTimeoutId);
            settingsSaveTimeoutId = null;
        }
        const btn = $('settings-save');
        if (btn) {
            btn.disabled = panelConfigLoad.status !== 'ready';
            btn.textContent = panelConfigLoad.status === 'loading' ? SUMMARY_FEEDBACK_COPY.configLoad.waiting : MEMORY_COPY.settingsSave;
        }
    }

    function showPanelConfigLoadState(status, error = '') {
        panelConfigLoad = { status, error };
        const notice = $('settings-config-status');
        notice.hidden = status === 'ready';
        notice.dataset.state = status;
        $('settings-config-message').textContent = status === 'error'
            ? `${SUMMARY_FEEDBACK_COPY.configLoad.failed} ${error}`.trim()
            : SUMMARY_FEEDBACK_COPY.configLoad.loading;
        const retry = $('settings-config-retry');
        retry.textContent = SUMMARY_FEEDBACK_COPY.configLoad.retry;
        retry.hidden = status !== 'error';
        resetSettingsSaveUi();
    }

    function retryPanelConfigLoad() {
        if (panelConfigLoad.status !== 'error') return;
        showPanelConfigLoadState('loading');
        postMsg('REQUEST_PANEL_CONFIG');
    }

    function normalizeVectorConfigUI(raw = null) {
        const base = JSON.parse(JSON.stringify(config.vector));
        base.enabled = true;
        const legacyOnline = raw?.online || {};
        const sharedKey = String(legacyOnline.key || '').trim();
        const sharedUrl = String(legacyOnline.url || '').trim();

        if (raw) {
            base.engine = 'online';
            base.l0Concurrency = Math.max(1, Math.min(50, Number(raw.l0Concurrency) || 10));
            base.recallTimeoutSec = normalizeRecallTimeoutSec(raw.recallTimeoutSec);
            Object.assign(base.l0Api, {
                provider: raw.l0Api?.provider || legacyOnline.provider || base.l0Api.provider,
                url: raw.l0Api?.url || sharedUrl || base.l0Api.url,
                key: raw.l0Api?.key || sharedKey || base.l0Api.key,
                model: raw.l0Api?.model || base.l0Api.model,
                modelCache: Array.isArray(raw.l0Api?.modelCache) ? raw.l0Api.modelCache : [],
                providers: normalizeProviderProfiles('l0', raw.l0Api || {}),
            });
            Object.assign(base.embeddingApi, {
                provider: raw.embeddingApi?.provider || base.embeddingApi.provider,
                url: raw.embeddingApi?.url || sharedUrl || base.embeddingApi.url,
                key: raw.embeddingApi?.key || sharedKey || base.embeddingApi.key,
                model: raw.embeddingApi?.model || legacyOnline.model || base.embeddingApi.model,
                modelCache: Array.isArray(raw.embeddingApi?.modelCache) ? raw.embeddingApi.modelCache : [],
                providers: normalizeProviderProfiles('embedding', raw.embeddingApi || {}),
            });
            Object.assign(base.rerankApi, {
                provider: raw.rerankApi?.provider || base.rerankApi.provider,
                url: raw.rerankApi?.url || sharedUrl || base.rerankApi.url,
                key: raw.rerankApi?.key || sharedKey || base.rerankApi.key,
                model: raw.rerankApi?.model || base.rerankApi.model,
                modelCache: Array.isArray(raw.rerankApi?.modelCache) ? raw.rerankApi.modelCache : [],
                providers: normalizeProviderProfiles('rerank', raw.rerankApi || {}),
            });
        }

        return base;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Config Management
    // ═══════════════════════════════════════════════════════════════════════════

    function normalizeTriggerTiming(value) {
        return VALID_TRIGGER_TIMINGS.has(value) ? value : 'after_ai';
    }

    function normalizeTriggerConfig() {
        config.inlineSummary = { enabled: false, review: config.inlineSummary?.review === true };
        if (config.trigger.timing === 'manual') {
            config.trigger.timing = 'after_ai';
            config.trigger.enabled = false;
        } else {
            config.trigger.timing = normalizeTriggerTiming(config.trigger.timing);
        }
    }

    function canUseCurrentChatControls() {
        const { hasChat, effectiveEnabled, changing } = currentChatSummaryState;
        return hasChat && effectiveEnabled && !changing;
    }

    function syncCurrentChatSummaryControls() {
        const { hasChat, chatEnabled, effectiveEnabled, changing } = currentChatSummaryState;
        $('archive-chat-state').textContent = chatEnabled ? '' : ARCHIVE_COPY.disabledChat;
        $('archive-chat-state').hidden = chatEnabled;
        const controlsEnabled = canUseCurrentChatControls();
        const copy = SUMMARY_FEEDBACK_COPY.summaryControls;

        const generateButton = $('btn-generate');
        if (generateButton) {
            generateButton.textContent = localGenerating ? copy.stop : currentChatSummaryState.recovery ? '从断点重记' : copy.generate;
            generateButton.disabled = !localGenerating && !controlsEnabled;
            generateButton.title = localGenerating ? '' : !hasChat ? copy.noChat
                : changing ? copy.changing : !effectiveEnabled ? copy.disabled : '';
        }
    }

    function renderSummaryStatus(data) {
        const status = $('summary-status');
        const isError = data.type === 'SUMMARY_ERROR';
        summaryStatusId = data.statusId;
        status.classList.toggle('is-error', isError);
        status.setAttribute('role', isError ? 'alert' : 'status');
        status.setAttribute('aria-live', isError ? 'assertive' : 'polite');
        status.tabIndex = isError ? 0 : -1;
        status.textContent = String((isError ? data.message : data.statusText) || '');
        $('summary-notice').hidden = !status.textContent;
        $('btn-dismiss-summary').hidden = !isError;
        if (!status.textContent && document.activeElement === $('btn-dismiss-summary')) $('btn-generate').focus();
    }

    function bindSummaryActions() {
        $('btn-dismiss-summary').textContent = SUMMARY_FEEDBACK_COPY.summaryControls.dismiss;
        $('btn-dismiss-summary').onclick = () => postMsg('DISMISS_SUMMARY_STATUS', { statusId: summaryStatusId });
        $('btn-generate').onclick = async () => {
            if (localGenerating) {
                postMsg('REQUEST_CANCEL');
                return;
            }
            const recovery = currentChatSummaryState.recovery;
            if (recovery) {
                const start = recovery.fromFloor + 1;
                const prefix = recovery.fromFloor ? `保留前 ${recovery.fromFloor} 楼的有效总结。` : '没有可以单独保留的完整摘要批次。';
                if (!await showConfirm('按当前原文重新补记', `${prefix}从第 ${start} 楼起清除旧摘要、草稿和检索缓存，再分批补记到最近已完成的回复。`, '从断点重记')) return;
                if (!canUseCurrentChatControls() || localGenerating || recovery.token !== currentChatSummaryState.recovery?.token
                    || recovery.scope !== currentChatSummaryState.recovery?.scope) return;
            }
            localGenerating = true;
            syncCurrentChatSummaryControls();
            postMsg('REQUEST_GENERATE', { config: { trigger: config.trigger }, ...(recovery && { recovery }) });
        };
    }

    function loadConfig() {
        try {
            const s = localStorage.getItem(SUMMARY_CONFIG_LOCAL_STORAGE_KEY);
            if (s) {
                const p = JSON.parse(s);
                const workflow = normalizeSummaryWorkflow(p);
                config.summaryWorkflowVersion = workflow.summaryWorkflowVersion;
                config.inlineSummary = workflow.inlineSummary;
                Object.assign(config, normalizeProofreading(p));
                config.memoryMaintenanceEnabled = true;
                Object.assign(config.trigger, workflow.trigger);
                Object.assign(config.ui, p.ui || {});
                config.ui.useVectorBoundary = p.ui?.useVectorBoundary === true;
                config.textFilterRules = Array.isArray(p.textFilterRules)
                    ? p.textFilterRules
                    : (Array.isArray(p.vector?.textFilterRules) ? p.vector.textFilterRules : [...DEFAULT_FILTER_RULES]);
                if (p.vector) config.vector = normalizeVectorConfigUI(p.vector);
                normalizeTriggerConfig();
            }
        } catch (caughtError) { console.warn({ source: import.meta.url, operation: "loadConfig" }, caughtError); }
    }

    function applyConfig(cfg) {
        if (!cfg) return;
        const workflow = normalizeSummaryWorkflow(cfg);
        config.summaryWorkflowVersion = workflow.summaryWorkflowVersion;
        config.inlineSummary = workflow.inlineSummary;
        Object.assign(config, normalizeProofreading(cfg));
        config.memoryMaintenanceEnabled = true;
        if (!settingsDirty) memoryMaintenancePage?.setEnabled(true, config);
        Object.assign(config.trigger, workflow.trigger);
        Object.assign(config.ui, cfg.ui || {});
        config.ui.useVectorBoundary = cfg.ui?.useVectorBoundary === true;
        config.textFilterRules = Array.isArray(cfg.textFilterRules)
            ? cfg.textFilterRules
            : (Array.isArray(cfg.vector?.textFilterRules)
                ? cfg.vector.textFilterRules
                : (Array.isArray(config.textFilterRules) ? config.textFilterRules : [...DEFAULT_FILTER_RULES]));
        if (cfg.vector) config.vector = normalizeVectorConfigUI(cfg.vector);
        normalizeTriggerConfig();
    }


    function saveConfig(options = {}) {
        if (panelConfigLoad.status !== 'ready') return Promise.resolve(false);
        try {
            const settingsOpen = $('settings-modal')?.classList.contains('active');
            if (settingsOpen) {
                config.vector = getVectorConfig();
            }
            if (!config.vector) {
                config.vector = {
                    enabled: true,
                    engine: 'online',
                    l0Concurrency: 10,
                    l0Api: { provider: 'siliconflow', url: 'https://api.siliconflow.cn/v1', key: '', model: 'Qwen/Qwen3-8B', modelCache: [] },
                    embeddingApi: { provider: 'siliconflow', url: 'https://api.siliconflow.cn/v1', key: '', model: 'BAAI/bge-m3', modelCache: [] },
                    rerankApi: { provider: 'siliconflow', url: 'https://api.siliconflow.cn/v1', key: '', model: 'BAAI/bge-reranker-v2-m3', modelCache: [] }
                };
            }
            const requestId = nextConfigSaveRequestId();
            const statusId = options.statusId || 'api-connect-status';
            const statusEl = $(statusId);
            const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 0;
            if (statusEl && options.loadingMessage) {
                setStatusText(statusEl, options.loadingMessage, 'loading');
            }

            return new Promise(resolve => {
                let timeoutId = null;
                if (timeoutMs > 0) {
                    timeoutId = setTimeout(() => {
                        pendingConfigSaveRequests.delete(requestId);
                        setStatusText(statusEl, `${options.errorPrefix || '保存失败：'}请求超时（>${Math.round(timeoutMs / 1000)}s）`, 'error');
                        resolve(false);
                    }, timeoutMs);
                }
                pendingConfigSaveRequests.set(requestId, {
                    resolve,
                    statusId,
                    successMessage: options.successMessage || '配置已保存',
                    errorPrefix: options.errorPrefix || '保存失败：',
                    timeoutId,
                });
                postMsg('SAVE_PANEL_CONFIG', { config, requestId });
            });
        } catch (e) {
            console.error('saveConfig error:', e);
            return Promise.resolve(false);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Vector Config UI
    // ═══════════════════════════════════════════════════════════════════════════

    function getVectorApiConfig(prefix) {
        return structuredClone(config.vector?.[prefix + 'Api'] || {});
    }

    function getVectorConfig() {
        return {
            enabled: true,
            engine: 'online',
            l0Concurrency: Math.max(1, Math.min(50, Number(config.vector?.l0Concurrency) || 10)),
            recallTimeoutSec: normalizeRecallTimeoutSec($('vector-recall-timeout')?.value),
            l0Api: getVectorApiConfig('l0'),
            embeddingApi: getVectorApiConfig('embedding'),
            rerankApi: getVectorApiConfig('rerank'),
        };
    }

    function loadVectorConfig(cfg) {
        if (!cfg) return;
        const timeoutEl = $('vector-recall-timeout');
        if (timeoutEl) {
            timeoutEl.max = String(MAX_RECALL_TIMEOUT_SEC);
            timeoutEl.value = String(normalizeRecallTimeoutSec(cfg.recallTimeoutSec));
        }
    }

    function updateVectorStats(stats) {
        if ($('vector-atom-count')) $('vector-atom-count').textContent = stats.stateVectors || 0;
        if ($('vector-chunk-count')) $('vector-chunk-count').textContent = stats.chunkCount || 0;
    }

    function syncMemoryActionButtons() {
        const busy = vectorGenerating;
        for (const id of ['btn-repair-vectors', 'btn-gen-vectors', 'btn-clear-vectors']) {
            if ($(id)) $(id).disabled = busy;
        }
    }

    function updateVectorProgress({ current, total, phase, message }) {
        const progress = $('vector-gen-progress');
        vectorGenerating = current >= 0;
        progress.classList.toggle('hidden', !vectorGenerating);
        for (const id of ['btn-repair-vectors', 'btn-gen-vectors', 'btn-clear-vectors']) {
            $(id).classList.toggle('hidden', vectorGenerating);
        }
        const cancel = $('btn-cancel-vectors');
        cancel.classList.toggle('hidden', !vectorGenerating);
        if (!vectorGenerating) {
            cancel.disabled = false;
            cancel.textContent = '取消';
        } else {
            progress.querySelector('.progress-inner').style.width = (total > 0 ? Math.round(current / total * 100) : 0) + '%';
            progress.querySelector('.progress-text').textContent = message || `${phase || ''}: ${current}/${total}`;
        }
        syncMemoryActionButtons();
    }

    function initVectorUI() {
        $('btn-gen-vectors').onclick = () => {
            if (vectorGenerating) return;
            updateVectorProgress({ current: 0, total: 0, message: '准备重建向量...' });
            postMsg('VECTOR_GENERATE', { config: getVectorConfig() });
        };

        $('btn-repair-vectors').onclick = () => {
            if (vectorGenerating) return;
            updateVectorProgress({ current: 0, total: 0, message: '检查向量缺漏...' });
            postMsg('VECTOR_REPAIR', { config: getVectorConfig() });
        };

        $('btn-clear-vectors').onclick = async () => {
            if (vectorGenerating) return;
            if (await showConfirm('清空原文向量', '确定清空此聊天的原文向量？之后可重新生成。')) {
                postMsg('VECTOR_CLEAR');
            }
        };

        $('btn-cancel-vectors').onclick = () => {
            $('btn-cancel-vectors').disabled = true;
            $('btn-cancel-vectors').textContent = '停止中...';
            postMsg('VECTOR_CANCEL_GENERATE');
        };
    }

    function updateVectorOnlineStatus(target, status, message) {
        const prefix = target || 'embedding';
        const btn = $(`${prefix}-btn-test`);
        if (btn) btn.disabled = status === 'downloading';
        setStatusText(
            $(`${prefix}-api-connect-status`),
            message || '',
            status === 'error' ? 'error' : status === 'success' ? 'success' : 'loading'
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Settings Workspace (设置 → 剧情与召回)
    // ═══════════════════════════════════════════════════════════════════════════

    function markSettingsDirty(field = null) {
        dirtyFields.add(field);
        settingsDirty = true;
        $('api-connect-status').textContent = WORKSPACE_COPY.dirty;
    }

    function openSettings() {
        document.documentElement.dataset.kitchenView = 'settings';
        settingsDirty = false;
        dirtyFields.clear();
        settingsSnapshot = structuredClone(config);
        memoryMaintenancePage.setEnabled(true, config);
        $('api-connect-status').textContent = '';
        $('hide-summarized').checked = !!config.ui.hideSummarized;
        $('keep-visible-count').value = config.ui.keepVisibleCount;
        $('recall-early-original').checked = !!config.ui.recallEarlyOriginal;
        if (config.vector) loadVectorConfig(config.vector);
        settingsOpenedWithServerConfig = panelConfigLoad.status === 'ready';
        showPanelConfigLoadState(panelConfigLoad.status, panelConfigLoad.error);

        $('settings-modal').classList.add('active');
        document.querySelector('.archive').inert = true;
        postMsg('MEMORY_MAINTENANCE_QUERY');
        postMsg('SETTINGS_OPENED');
    }

    function collectSettingsFormToConfig() {
        config.inlineSummary.enabled = false;
        config.memoryMaintenanceEnabled = true;
        config.ui.hideSummarized = $('hide-summarized').checked;
        const parsedKeep = Number.parseInt($('keep-visible-count').value, 10);
        config.ui.keepVisibleCount = Number.isFinite(parsedKeep) ? Math.max(0, Math.min(50, parsedKeep)) : 5;
        config.ui.recallEarlyOriginal = $('recall-early-original').checked;
        config.ui.useVectorBoundary = false;
        Object.assign(config, memoryMaintenancePage.getPreferences());
        config.trigger = {
            enabled: true,
            notifyOnComplete: false,
            interval: 1,
            delayFloors: 0,
            timing: 'after_ai',
            role: 'system',
            maxPerRun: SUMMARY_BATCH_FLOORS,
            forceInsertAtEnd: false,
        };
        if (!Array.isArray(config.textFilterRules)) {
            config.textFilterRules = [...DEFAULT_FILTER_RULES];
        }
        config.vector = getVectorConfig();
    }

    async function saveSettings() {
        if (settingsSaving) return false;
        if (!settingsOpenedWithServerConfig) {
            retryPanelConfigLoad();
            return false;
        }
        const previousConfig = structuredClone(config);
        collectSettingsFormToConfig();
        settingsSaving = true;
        $('settings-modal').querySelector('.workspace-layout').inert = true;
        $('settings-cancel').disabled = true;
        const btn = $('settings-save');
        const statusEl = $('api-connect-status');
        resetSettingsSaveUi();
        if (btn) {
            btn.disabled = true;
            btn.textContent = '保存中...';
        }
        if (statusEl) setStatusText(statusEl, '保存中...', 'loading');
        const savePromise = saveConfig({
            statusId: 'api-connect-status',
            loadingMessage: '保存中...',
            successMessage: '配置已保存',
            timeoutMs: 5000,
        });
        const saved = await savePromise;
        if (saved) {
            settingsDirty = false;
            dirtyFields.clear();
            settingsSnapshot = structuredClone(config);
        }
        else Object.assign(config, previousConfig);
        settingsSaving = false;
        $('settings-modal').querySelector('.workspace-layout').inert = false;
        $('settings-cancel').disabled = false;
        resetSettingsSaveUi();
        return saved;
    }

    function tlTotalPages() {
        return Math.max(1, Math.ceil(tlRootCount / TL_PAGE_SIZE));
    }

    function clampTlPage(page) {
        return Math.min(Math.max(0, Math.trunc(page)), tlTotalPages() - 1);
    }

    const timelinePageKey = () => summaryData.branchId ? JSON.stringify([currentTimelineChatId, summaryData.branchId]) : currentTimelineChatId;
    function tlLoadPage() {
        const v = JSON.parse(localStorage.getItem(TL_PAGE_KEY))?.[timelinePageKey()];
        return Number.isFinite(v) ? v : -1;
    }

    function tlSavePage() {
        if (!currentTimelineChatId) return;
        const pages = JSON.parse(localStorage.getItem(TL_PAGE_KEY)) || {};
        if (tlCurrentPage < 0) {
            if (!Object.hasOwn(pages, timelinePageKey())) return;
            delete pages[timelinePageKey()];
        } else {
            if (pages[timelinePageKey()] === tlCurrentPage) return;
            pages[timelinePageKey()] = tlCurrentPage;
        }
        localStorage.setItem(TL_PAGE_KEY, JSON.stringify(pages));
    }

    function tlItemHtml(e) {
        return archiveView.timelineItem(e);
    }

    function revealTlCurrentPage() {
        const strip = $('tl-pg-strip');
        const cur = strip.querySelector('[aria-current="page"]');
        if (!cur || !strip.clientWidth) return;
        const left = cur.offsetLeft;
        if (left < strip.scrollLeft || left + cur.offsetWidth > strip.scrollLeft + strip.clientWidth) {
            strip.scrollLeft = left - (strip.clientWidth - cur.offsetWidth) / 2;
        }
    }

    function updateTlPager(visible, syncPageNumber = false) {
        const pager = $('tl-pager');
        if (!pager) return;
        pager.classList.toggle('hidden', !visible);
        if (!visible) return;
        const total = tlTotalPages();
        const strip = $('tl-pg-strip');
        const focused = document.activeElement;
        const hadPagerFocus = pager.contains(focused);
        // Keep existing buttons so selecting or refreshing a page retains keyboard focus.
        while (strip.children.length > total) strip.lastElementChild.remove();
        for (let i = strip.children.length; i < total; i++) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'tl-pg-btn';
            button.dataset.page = i;
            button.textContent = i + 1;
            strip.append(button);
        }
        Array.from(strip.children).forEach((button, i) => {
            button.classList.toggle('cur', i === tlCurrentPage);
            if (i === tlCurrentPage) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        });
        const num = $('tl-pg-num');
        num.max = total;
        if (syncPageNumber || document.activeElement !== num) num.value = tlCurrentPage + 1;
        const atStart = tlCurrentPage <= 0;
        const atEnd = tlCurrentPage >= total - 1;
        $('tl-pg-first').disabled = atStart;
        $('tl-pg-prev').disabled = atStart;
        $('tl-pg-next').disabled = atEnd;
        $('tl-pg-last').disabled = atEnd;
        if (hadPagerFocus && (!focused.isConnected || focused.disabled)) {
            strip.children[tlCurrentPage].focus({ preventScroll: true });
        }
        revealTlCurrentPage();
    }

    function renderTimeline(ev, options = {}) {
        summaryData.rounds = ev || [];
        archiveView.refreshIndexes();
        const filtered = archiveView.hasTimelineFilter();
        if (filtered && tlUnfilteredPage === null) {
            tlUnfilteredPage = tlCurrentPage;
        } else if (!filtered && tlUnfilteredPage !== null) {
            tlCurrentPage = Math.max(0, tlUnfilteredPage);
            options = { ...options, page: tlCurrentPage };
            tlUnfilteredPage = null;
        }
        const events = archiveView.timelineEvents();
        tlRootCount = events.length;
        const container = $('timeline-list');
        if (!events.length) {
            setHtml(container, summaryData.rounds.length
                ? `<div class="archive-empty">${ARCHIVE_COPY.noResults}</div>`
                : `<div class="archive-empty"><h2>${ARCHIVE_COPY.noEvents}</h2><p>${ARCHIVE_COPY.noEventsHint}</p></div>`);
            updateTlPager(false);
            return;
        }
        if (tlPagingEnabled) {
            tlCurrentPage = clampTlPage(options.page ?? Math.max(0, tlCurrentPage));
            // Search and type filters are temporary, not a saved reading position.
            if (!filtered) tlSavePage();
            const start = tlCurrentPage * TL_PAGE_SIZE;
            setHtml(container, events.slice(start, start + TL_PAGE_SIZE).map(tlItemHtml).join(''));
            updateTlPager(true, options.page != null);
        } else {
            setHtml(container, events.map(tlItemHtml).join(''));
            updateTlPager(false);
        }
    }

    function getCharName(character) {
        return typeof character === 'string' ? character : character.name;
    }

    function updateRelationships(data) {
        summaryData.characters = data || { main: [], relationships: [] };
    }

    function selectCharacter(id) {
        const character = getArchiveCharacters(summaryData).find(entry => entry.id === id);
        currentCharacterId = character?.id || null;
        renderCharacterProfile();
        archiveView.refreshRoster();

    }

    function updateCharacterSelector() {
        const characters = getArchiveCharacters(summaryData);
        const identity = buildCharacterIdentity(summaryData.entities, summaryData.characterAliases);
        const selected = characters.find(character => character.id === currentCharacterId)
            || (!identity.isAmbiguous(currentCharacterId) && characters.find(character => character.name === identity.resolveName(currentCharacterId)));
        selectCharacter(selected?.id || characters[0]?.id || null);
    }

    function renderCharacterProfile() {
        const c = $('profile-content');
        const knownNames = new Set(getArchiveCharacters(summaryData).map(character => character.name));
        for (const alias of summaryData.characterAliases || []) knownNames.add(alias.from);
        const agendas = projectPersonalAgendas(summaryData.storyRecords || [], knownNames);
        const renderUnassigned = () => {
            const pending = agendas.filter(record => record.kind === 'plan' && !record.holders?.length);
            if (!pending.length) return;
            const group = document.createElement('details');
            const label = document.createElement('summary');
            label.textContent = '待归属的旧计划（' + pending.length + '）';
            group.append(label);
            renderThreads(group, pending, ['plan']);
            c.append(group);
        };

        const identity = buildCharacterIdentity(summaryData.entities, summaryData.characterAliases);
        const rels = summaryData.characters?.relationships || [];

        if (!currentCharacterId) {
            c.replaceChildren();
            renderUnassigned();
            return;
        }

        const character = getArchiveCharacters(summaryData).find(entry => entry.id === currentCharacterId);
        const name = character.name;
        const resolve = value => identity.isAmbiguous(value) ? null : identity.resolveName(value);
        const outRels = rels.filter(r => resolve(r.from) === name);
        const inRels = rels.filter(r => resolve(r.to) === name);

        setHtml(c, `
            <div class="prof-name">${h(name)}</div>
            ${[[outRels,'对','to'],[inRels,'来自','from']].filter(([items]) => items.length).map(([items,label,target]) => `
                <div class="prof-rels"><div class="rels-group">
                    <div class="rels-group-title">${label === '对' ? h(name) + '对别人的羁绊' : '别人对' + h(name) + '的羁绊'}</div>
                    ${items.map(r => `<div class="rel-item"><span class="rel-target">${label}${h(r[target])}：</span>
                        <span class="rel-label">${h(r.label || '—')}</span>
                        ${r.trend ? `<span class="rel-trend ${TREND_CLASS[r.trend] || ''}">${h(r.trend)}</span>` : ''}
                    </div>`).join('')}
                </div></div>`).join('')}
        `);
        const entities = summaryData.entities || [];
        const person = entities.find(entity => entity.id === character.id) || identity.entityFor(name);
        const records = summaryData.storyRecords || [];
        const state = renderPersonState(c, records, name, resolve);
        renderPersonalAgendas(c, agendas, holder => resolve(holder) === name);
        renderUnassigned();
        const attributes = document.createElement('section');
        renderWorldAttributes(attributes,entities,person,identity.aliasesFor(name,person),true,person?.id === protagonistIdentity(entities,summaryData.playerName).hero?.id);
        const title = c.querySelector('.prof-name');
        if (state) title.after(state);
        if (attributes.childElementCount) title.after(attributes);
        if (c.childElementCount === 1) { const hint = document.createElement('p'); hint.textContent = '目前只记下了姓名，尚无其他资料。'; c.append(hint); }
    }

    function updateStats(s) {
        if (!s) return;
        $('stat-summarized').textContent = s.summarizedUpTo ?? 0;
        $('stat-events').textContent = s.roundCount ?? 0;
        const p = s.pendingFloors ?? 0;
        $('stat-pending').textContent = p;
        $('pending-warning').classList.toggle('hidden', p !== -1);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Modals
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * 显示通用确认弹窗
     * @returns {Promise<boolean>}
     */
    function showConfirm(title, message, okText = '执行', cancelText = '取消') {
        return new Promise(resolve => {
            const modal = $('confirm-modal');
            const titleEl = $('confirm-title');
            const msgEl = $('confirm-message');
            const actionList = $('confirm-action-list');
            const okBtn = $('confirm-ok');
            const cancelBtn = $('confirm-cancel');
            const closeBtn = $('confirm-close');
            const backdrop = $('confirm-backdrop');

            titleEl.textContent = title;
            msgEl.textContent = message;
            actionList.classList.add('hidden');
            okBtn.classList.remove('hidden');
            okBtn.textContent = okText;
            cancelBtn.textContent = cancelText;

            const doc = typeof document === 'undefined' ? null : document;
            const previousFocus = doc?.activeElement;
            const onKeyDown = (event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                close(false);
            };

            const close = (result) => {
                doc?.removeEventListener?.('keydown', onKeyDown);
                modal.classList.remove('active');
                postMsg('CONFIRM_CLOSED');
                okBtn.onclick = null;
                cancelBtn.onclick = null;
                if (closeBtn) closeBtn.onclick = null;
                backdrop.onclick = null;
                if (previousFocus?.isConnected !== false) previousFocus?.focus?.();
                resolve(result);
            };

            okBtn.onclick = () => close(true);
            cancelBtn.onclick = () => close(false);
            if (closeBtn) closeBtn.onclick = () => close(false);
            backdrop.onclick = () => close(false);
            doc?.addEventListener?.('keydown', onKeyDown);

            modal.classList.add('active');
            cancelBtn.focus?.();
            postMsg('CONFIRM_OPENED');
        });
    }

    const RECALL_STATUS_LABELS = {
        success: '命中成功',
        degraded: '降级完成',
        empty: '无注入',
        reused: '复用本轮',
        failed: '召回失败',
    };
    const RECALL_MODE_LABELS = {
        hybrid: '向量 + 关键词',
        keyword: '关键词检索',
        'focus-only': '仅状态背景',
        canonical: '常规摘要',
        reused: '复用缓存',
        none: '未检索',
    };
    const RECALL_TYPE_LABELS = {
        normal: '正常生成',
        continue: '续写',
        regenerate: '重生成',
        swipe: '重新生成回复',
    };

    function setRecallLog(text) {
        lastRecallLogText = text || '';
        renderRecallHistory();
    }

    function setRecallHistory(entries = []) {
        recallHistoryEntries = Array.isArray(entries) ? entries : [];
        if (!recallHistoryEntries.some(item => item.id === selectedRecallRoundId)) {
            selectedRecallRoundId = recallHistoryEntries[0]?.id || '';
        }
        renderRecallHistory();
    }

    function makeRecallPill(text, tone = '') {
        const span = document.createElement('span');
        span.className = `recall-pill${tone ? ` is-${tone}` : ''}`;
        span.textContent = text;
        return span;
    }

    function renderRecallHistory() {
        const emptyEl = $('recall-empty');
        const detailEl = $('recall-detail');
        const selectEl = $('recall-round-select');
        const diagWrap = $('recall-diagnostics-wrap');
        const diagLog = $('recall-diagnostics-log');
        if (!emptyEl || !detailEl || !selectEl) return;

        selectEl.replaceChildren();
        recallHistoryEntries.forEach((entry, index) => {
            const opt = document.createElement('option');
            opt.value = entry.id;
            const floorText = entry.targetFloor >= 0 ? `第 ${entry.targetFloor + 1} 楼` : '最新对话';
            const modeText = RECALL_MODE_LABELS[entry.mode] || entry.mode || '未知';
            const roundLabel = `最近第 ${index + 1} 次 · ${floorText} · ${modeText} (${entry.includedCount || 0}/${entry.chunks?.length || 0})`;
            opt.textContent = roundLabel;
            selectEl.append(opt);
        });
        selectEl.disabled = !recallHistoryEntries.length;
        if (selectedRecallRoundId) selectEl.value = selectedRecallRoundId;

        const selected = recallHistoryEntries.find(item => item.id === selectEl.value) || recallHistoryEntries[0] || null;
        const diagText = selected?.diagnosticsText || lastRecallLogText || '';
        if (diagWrap && diagLog) {
            diagLog.textContent = diagText;
            diagWrap.hidden = !diagText;
        }

        if (!selected) {
            emptyEl.hidden = false;
            emptyEl.textContent = '暂无本聊天每轮召回记录。AI 生成回复时，将在此按轮展示检索模式、关注角色、命中片段、得分与预算截断情况。';
            detailEl.hidden = true;
            detailEl.replaceChildren();
            return;
        }

        emptyEl.hidden = true;
        detailEl.hidden = false;
        detailEl.replaceChildren();

        const metaGrid = document.createElement('div');
        metaGrid.className = 'recall-meta-grid';
        const statusTone = selected.status === 'success' ? 'good'
            : (selected.status === 'degraded' || selected.status === 'failed') ? 'warn'
                : 'muted';
        const floorText = selected.targetFloor >= 0 ? `第 ${selected.targetFloor + 1} 楼` : '最新对话';
        const typeText = RECALL_TYPE_LABELS[selected.type] || selected.type || 'normal';
        metaGrid.append(
            makeRecallPill(`目标：${floorText} (${typeText})`),
            makeRecallPill(RECALL_STATUS_LABELS[selected.status] || selected.status, statusTone),
            makeRecallPill(`模式：${RECALL_MODE_LABELS[selected.mode] || selected.mode}`),
            makeRecallPill(selected.reranked ? '重排：已开启' : '重排：未启用', selected.reranked ? 'good' : 'muted'),
            makeRecallPill(`耗时：${selected.elapsedMs || 0} ms`),
            makeRecallPill(`原文：入选 ${selected.includedCount || 0} · 截断 ${selected.trimmedCount || 0} · 预算 ${selected.rawBudgetUsed || 0}/${selected.rawBudgetMax || 3000} tok`),
            makeRecallPill(selected.hiddenThrough >= 0 ? `隐藏边界 ≤ #${selected.hiddenThrough + 1}` : '尚无隐藏边界'),
        );
        detailEl.append(metaGrid);

        if (selected.reason || selected.fallbacks?.length) {
            const noteBox = document.createElement('div');
            noteBox.className = 'recall-query-box';
            const label = document.createElement('div');
            label.className = 'recall-query-label';
            label.textContent = '质量与降级说明';
            noteBox.append(label);
            if (selected.reason) {
                const p = document.createElement('div');
                p.textContent = `说明：${selected.reason}`;
                noteBox.append(p);
            }
            for (const fb of selected.fallbacks || []) {
                const p = document.createElement('div');
                p.textContent = `降级 [${fb.stage}]：${fb.detail}`;
                noteBox.append(p);
            }
            detailEl.append(noteBox);
        }

        if (selected.focusCharacters?.length) {
            const focusRow = document.createElement('div');
            focusRow.className = 'recall-focus-list';
            const title = document.createElement('span');
            title.textContent = '关注角色：';
            focusRow.append(title);
            for (const name of selected.focusCharacters) {
                focusRow.append(makeRecallPill(name, 'good'));
            }
            detailEl.append(focusRow);
        }

        if (selected.queryPreview) {
            const queryBox = document.createElement('div');
            queryBox.className = 'recall-query-box';
            const label = document.createElement('div');
            label.className = 'recall-query-label';
            label.textContent = '查询条件摘录';
            const body = document.createElement('div');
            body.textContent = selected.queryPreview;
            queryBox.append(label, body);
            detailEl.append(queryBox);
        }

        const chunksWrap = document.createElement('div');
        chunksWrap.className = 'recall-chunks';
        const chunks = selected.chunks || [];
        if (!chunks.length) {
            const emptyChunks = document.createElement('div');
            emptyChunks.className = 'recall-empty';
            emptyChunks.textContent = '本轮未命中使用早期原文片段（可能仅注入当前状态或常规摘要）。';
            chunksWrap.append(emptyChunks);
        } else {
            for (const chunk of chunks) {
                const card = document.createElement('article');
                card.className = `recall-chunk${chunk.included ? '' : ' is-trimmed'}`;
                const head = document.createElement('div');
                head.className = 'recall-chunk-head';
                const statusBadge = chunk.included
                    ? makeRecallPill('已注入', 'good')
                    : makeRecallPill(chunk.filterReason === 'above_boundary' ? '保留区未注入' : '超出预算截断', 'warn');
                const title = document.createElement('span');
                title.className = 'recall-chunk-title';
                title.textContent = `#${chunk.floor >= 0 ? chunk.floor + 1 : '?'} · ${chunk.speaker || '未知角色'}`;
                head.append(statusBadge, title);
                if (chunk.score != null) head.append(makeRecallPill(`检索得分 ${chunk.score}`));
                if (chunk.rerankScore != null) head.append(makeRecallPill(`重排 ${chunk.rerankScore}`, 'good'));
                const body = document.createElement('p');
                body.className = 'recall-chunk-text';
                body.textContent = chunk.text || '';
                card.append(head, body);
                chunksWrap.append(card);
            }
        }
        detailEl.append(chunksWrap);
    }


    // ═══════════════════════════════════════════════════════════════════════════
    // Editor
    // ═══════════════════════════════════════════════════════════════════════════

    function preserveAddedAt(n, o) {
        if (o?._addedAt != null) n._addedAt = o._addedAt;
        return n;
    }

    function createDelBtn() {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-sm btn-del';
        b.textContent = '删除';
        return b;
    }

    function addDeleteHandler(item) {
        const del = createDelBtn();
        (item.querySelector('.struct-actions') || item).appendChild(del);
        del.onclick = () => item.remove();
    }

    function relationTrendOptions(trend = '') {
        return [{ value: '', label: UNANNOTATED_LABEL }, ...RELATION_TRENDS.map(value => ({ value, label: value }))]
            .map(({ value, label }) => `<option value="${h(value)}"${trend === value ? ' selected' : ''}>${h(label)}</option>`).join('');
    }

    function renderCharactersEditor(data) {
        const d = data || { main: [], relationships: [] };
        const main = (d.main || []).map(getCharName);
        const rels = d.relationships || [];

        const es = $('editor-struct');
        setHtml(es, `
            <div class="struct-item">
                <div class="struct-row"><strong>角色列表</strong></div>
                <div id="char-main-list">
                    ${(main.length ? main : ['']).map(n => `<div class="struct-row char-main-item"><input type="text" class="char-main-name" placeholder="角色名" value="${h(n || '')}"></div>`).join('')}
                </div>
                <div style="margin-top:8px"><button type="button" class="btn btn-sm" id="char-main-add">＋ 新增角色</button></div>
            </div>
            <div class="struct-item">
                <div class="struct-row"><strong>人物关系</strong></div>
                <div id="char-rel-list">
                    ${(rels.length ? rels : [{ from: '', to: '', label: '', trend: '' }]).map(r => `
                        <div class="struct-row char-rel-item">
                            <input type="text" class="char-rel-from" placeholder="角色 A" value="${h(r.from || '')}">
                            <input type="text" class="char-rel-to" placeholder="角色 B" value="${h(r.to || '')}">
                            <input type="text" class="char-rel-label" placeholder="关系" value="${h(r.label || '')}">
                            <select class="char-rel-trend">${relationTrendOptions(r.trend)}</select>
                        </div>
                    `).join('')}
                </div>
                <div style="margin-top:8px"><button type="button" class="btn btn-sm" id="char-rel-add">＋ 新增关系</button></div>
            </div>
        `);

        es.querySelectorAll('.char-main-item,.char-rel-item').forEach(addDeleteHandler);

        $('char-main-add').onclick = () => {
            const div = document.createElement('div');
            div.className = 'struct-row char-main-item';
            setHtml(div, '<input type="text" class="char-main-name" placeholder="角色名">');
            addDeleteHandler(div);
            $('char-main-list').appendChild(div);
        };

        $('char-rel-add').onclick = () => {
            const div = document.createElement('div');
            div.className = 'struct-row char-rel-item';
            setHtml(div, `
                <input type="text" class="char-rel-from" placeholder="角色 A">
                <input type="text" class="char-rel-to" placeholder="角色 B">
                <input type="text" class="char-rel-label" placeholder="关系">
                <select class="char-rel-trend">${relationTrendOptions()}</select>
            `);
            addDeleteHandler(div);
            $('char-rel-list').appendChild(div);
        };
    }

    let editorReturnFocus = null;
    let editorEscHandler = null;

    function openEditor(section) {
        archiveView.closeDialogs();
        editorReturnFocus = typeof document === 'undefined' ? null : document.activeElement;
        currentEditSection = section;
        currentEditBaseline = structuredClone(summaryData[section]);
        if (section === 'facts') currentEditBaseline = currentEditBaseline.filter(fact => !fact.retracted);
        const meta = SECTION_META[section];
        const es = $('editor-struct');
        const ta = $('editor-ta');

        $('editor-title').textContent = meta.title;
        $('editor-hint').textContent = meta.hint;
        $('editor-err').classList.remove('visible');
        $('editor-err').textContent = '';
        es.classList.add('hidden');
        ta.classList.remove('hidden');

        if (section === 'facts') {
            // 按人物首次出现的插入顺序分组，同一人物的事实保持相邻
            const grouped = new Map();
            for (const f of (summaryData.facts || []).filter(f => !f.retracted)) {
                if (!grouped.has(f.s)) grouped.set(f.s, []);
                grouped.get(f.s).push(f);
            }
            ta.value = [...grouped.values()].flat()
                .map(f => [f.s, f.p, f.o].concat(f.trend ? [f.trend] : []).join('|'))
                .join('\n');
        } else {
            ta.classList.add('hidden');
            es.classList.remove('hidden');
            if (section === 'characters') renderCharactersEditor(summaryData.characters || { main: [], relationships: [] });
        }

        // Compare the same editable projection at open and save, not hidden
        // metadata or defaults introduced by the editor's serializer.
        currentEditBaseline = readEditorData();
        const doc = typeof document === 'undefined' ? null : document;
        const modal = $('editor-modal');
        modal.classList.add('active');
        doc?.removeEventListener?.('keydown', editorEscHandler);
        editorEscHandler = (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            closeEditor();
        };
        doc?.addEventListener?.('keydown', editorEscHandler);
        const focusTarget = (section === 'facts' ? ta : es.querySelector?.('input, textarea, button')) || $('editor-close');
        focusTarget?.focus?.();
        postMsg('EDITOR_OPENED');
    }

    function closeEditor() {
        const doc = typeof document === 'undefined' ? null : document;
        doc?.removeEventListener?.('keydown', editorEscHandler);
        editorEscHandler = null;
        $('editor-modal').classList.remove('active');
        currentEditSection = null;
        currentEditBaseline = null;
        const previous = editorReturnFocus;
        editorReturnFocus = null;
        if (previous?.isConnected !== false) previous?.focus?.();
        postMsg('EDITOR_CLOSED');
    }

    function readEditorData() {
        const section = currentEditSection;
        const es = $('editor-struct');
        const ta = $('editor-ta');
        let parsed;

        if (section === 'characters') {
            const oldMainMap = new Map(currentEditBaseline.main.map(m => [getCharName(m), m]));
            const mainNames = Array.from(es.querySelectorAll('.char-main-name')).map(i => i.value.trim()).filter(Boolean);
            const main = mainNames.map(n => preserveAddedAt({ name: n }, oldMainMap.get(n)));

            const oldRelMap = new Map(currentEditBaseline.relationships.map(r => [`${r.from}->${r.to}`, r]));
            const rels = Array.from(es.querySelectorAll('.char-rel-item')).map(it => {
                const from = it.querySelector('.char-rel-from').value.trim();
                const to = it.querySelector('.char-rel-to').value.trim();
                return preserveAddedAt({
                    from, to,
                    label: it.querySelector('.char-rel-label').value.trim(),
                    trend: it.querySelector('.char-rel-trend').value
                }, oldRelMap.get(`${from}->${to}`));
            }).filter(r => r.from && r.to);

            parsed = { main, relationships: rels };
        } else if (section === 'facts') {
            const oldMap = new Map(currentEditBaseline.map(f => [`${f.s}::${f.p}`, f]));
            parsed = ta.value
                .split('\n')
                .map(l => l.trim())
                .filter(Boolean)
                .map(line => {
                    const parts = line.split('|').map(s => s.trim());
                    const s = parts[0];
                    const p = parts[1];
                    const o = parts[2];
                    const trend = parts[3];
                    if (!s || !p) return null;
                    if (!o) return null;
                    const key = `${s}::${p}`;
                    const old = oldMap.get(key);
                    const fact = {
                        s, p, o,
                        since: old?.since ?? 0,
                        _addedAt: old?._addedAt ?? 0,
                    };
                    if (/^对.+的/.test(p) && trend) {
                        fact.trend = trend;
                    }
                    return fact;
                })
                .filter(Boolean);
        }
        return parsed;
    }

    function saveEditor() {
        const section = currentEditSection;
        let parsed;
        try {
            parsed = readEditorData();
        } catch (e) {
            $('editor-err').textContent = `格式错误: ${e.message}`;
            $('editor-err').classList.add('visible');
            return;
        }

        postMsg('UPDATE_SECTION', { section, previous: currentEditBaseline, data: parsed });

        if (section === 'characters') updateRelationships(parsed);
        else if (section === 'facts') renderFacts(parsed);

        closeEditor();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Message Handler
    // ═══════════════════════════════════════════════════════════════════════════

    function handleParentMessage(e) {
        if (e.origin !== PARENT_ORIGIN || e.source !== window.parent) return;

        const d = e.data;
        if (!d || d.source !== 'TavernKitchen') return;

        switch (d.type) {
            case 'KITCHEN_CARD_INFO_RESULT':
                $('kitchen-card-counts').textContent = d.counts.rounds + ' 轮总结 · ' + d.counts.people + ' 个人物 · ' + d.counts.notes + ' 份札记';
                break;
            case 'KITCHEN_CARD_RESULT':
                $('kitchen-card-status').textContent = d.message;
                $('btn-export-kitchen-card').disabled = $('btn-import-kitchen-card').disabled = false;
                if (d.success) postMsg('KITCHEN_CARD_INFO');
                break;
            case 'WORLD_EVOLUTION_RECORDS': {
                const container = $(d.section === 'people' ? 'people-developments' : 'situation-developments');
                container.replaceChildren();
                const news = d.news || [];
                container.hidden = !news.length && !d.overview;
                if (container.hidden) break;
                const heading = document.createElement('h4');
                heading.textContent = d.section === 'people' ? '幕后人物动向' : '幕后局势进展';
                container.append(heading);
                if (d.overview) {
                    const overview = document.createElement('p'); overview.textContent = d.overview;
                    container.append(overview);
                }
                for (const item of news) {
                    const row = document.createElement('article'), title = document.createElement('strong');
                    title.textContent = item.title;
                    const body = document.createElement('p'); body.textContent = item.body;
                    row.append(title, body);
                    if (item.progress) {
                        const proof = document.createElement('details'), label = document.createElement('summary');
                        label.textContent = '推进依据 · 第 ' + (item.progress.floor + 1) + ' 楼';
                        const text = document.createElement('p');
                        text.textContent = item.progress.reason + ' · ' + item.progress.quote;
                        proof.append(label, text); row.append(proof);
                    }
                    container.append(row);
                }
                break;
            }
            case 'KITCHEN_MEMORY_VIEW': {
                const modal = $('settings-modal');
                const viewName = d.view || 'memory';
                const dataView = viewName === 'relations' ? 'people'
                    : ['settings', 'settings-memory'].includes(viewName) ? 'settings'
                        : viewName;
                document.documentElement.dataset.kitchenView = dataView;
                $('data-page').hidden = viewName !== 'data';
                $('recall-page').hidden = viewName !== 'recall';
                $('proofreading-page').hidden = viewName !== 'proofreading';
                document.querySelector('.archive').inert = ['data', 'recall', 'proofreading', 'settings'].includes(dataView);
                if (viewName !== 'proofreading') memoryMaintenancePage?.close();
                if (viewName === 'data') postMsg('KITCHEN_CARD_INFO');
                if (viewName === 'recall') postMsg('REQUEST_RECALL_HISTORY');
                if (viewName === 'proofreading') memoryMaintenancePage?.open();
                if (['world', 'people', 'relations'].includes(viewName)) postMsg('WORLD_EVOLUTION_REQUEST');
                if (dataView === 'settings') {
                    openSettings();
                } else {
                    modal.classList.remove('active');
                    const archiveTab = { memory: 'story', world: 'world', lore: 'world', people: 'people', relations: 'people' }[viewName];
                    if (archiveTab) archiveView.switchView(archiveTab, { notify: false });
                }
                break;
            }
            case 'CHAT_SUMMARY_STATE':
                currentChatSummaryState = d.state;
                syncCurrentChatSummaryControls();
                break;

            case 'GENERATION_STATE':
                localGenerating = !!d.isGenerating;
                syncCurrentChatSummaryControls();
                break;

            case 'SUMMARY_BASE_DATA':
                if (d.stats) {
                    updateStats(d.stats);
                    $('summarized-count').textContent = d.stats.hiddenCount ?? 0;
                }
                if (d.hideSummarized !== undefined) {
                    if (!settingsDirty) $('hide-summarized').checked = d.hideSummarized;
                    config.ui.hideSummarized = d.hideSummarized;
                }
                if (d.keepVisibleCount !== undefined) {
                    config.ui.keepVisibleCount = d.keepVisibleCount;
                    if (!settingsDirty) $('keep-visible-count').value = d.keepVisibleCount;
                }
                if (d.useVectorBoundary !== undefined) config.ui.useVectorBoundary = d.useVectorBoundary === true;
                config.vector.enabled = true;
                syncCurrentChatSummaryControls();
                break;

            case 'SUMMARY_FULL_DATA':
                if (d.payload) {
                    const p = d.payload;
                    summaryData.narrativeUnits = p.narrativeUnits || [];
                    const nextChatId = typeof p.chatId === 'string' ? p.chatId : '';
                    memoryMaintenancePage.setChat(nextChatId);
                    if (nextChatId !== currentTimelineChatId || (p.branchId || '') !== (summaryData.branchId || '')) {
                        currentTimelineChatId = nextChatId; summaryData.branchId = p.branchId || '';
                        tlUnfilteredPage = null;
                        archiveView.reset();
                        currentCharacterId = null;
                        tlCurrentPage = tlLoadPage();
                    }
                    summaryData.chatId = nextChatId;
                    summaryData.branchId = p.branchId || '';
                    summaryData.storyRecords = p.storyRecords || [];
                    if (p.rounds) renderTimeline(p.rounds);
                    if (p.characters) summaryData.characters = p.characters;
                    summaryData.entities = p.entities || [];
                    summaryData.playerName = p.playerName || '';
                    summaryData.legacyCharacterNames = p.legacyCharacterNames || [];
                    if (p.facts) renderFacts(p.facts);
                    if (p.characterAliases) summaryData.characterAliases = p.characterAliases;
                    updateRelationships(summaryData.characters);
                    $('stat-events').textContent = p.rounds?.length || 0;
                    if (p.lastSummarizedMesId != null) $('stat-summarized').textContent = p.lastSummarizedMesId + 1;
                    if (p.stats) updateStats(p.stats);
                    updateCharacterSelector();
                    archiveView.refresh();
                }
                break;

            case 'SUMMARY_STATUS':
            case 'SUMMARY_ERROR':
                renderSummaryStatus(d);
                break;

            case MEMORY_CHAT_MESSAGES.state:
                memoryMaintenancePage.renderChat(d.payload);
                break;
            case 'MEMORY_MAINTENANCE_RESULTS':
                memoryMaintenancePage.render(d.payload);
                break;
            case 'WORLD_FIELD_SOURCE_RESULT': archiveView.showFieldSource(d.payload); break;
            case 'MEMORY_MAINTENANCE_SOURCE_RESULT':
                memoryMaintenancePage.renderSource(d.payload);
                break;

            case 'SUMMARY_CLEARED': {
                const t = d.payload?.totalFloors || 0;
                $('stat-events').textContent = 0;
                $('stat-summarized').textContent = 0;
                $('stat-pending').textContent = t;
                $('summarized-count').textContent = 0;
                summaryData = { rounds: [], characters: { main: [], relationships: [] }, facts: [], characterAliases: [] };
                currentTimelineChatId = d.payload?.chatId || '';
                summaryData.chatId = currentTimelineChatId; summaryData.branchId = d.payload?.branchId || '';
                tlUnfilteredPage = null;
                currentCharacterId = null;
                archiveView.reset();
                        renderTimeline([]);
                updateRelationships(null);
                updateCharacterSelector();
                renderFacts([]);
                archiveView.refresh();
                break;
            }

            case 'LOAD_PANEL_CONFIG':
                showPanelConfigLoadState('ready');
                if (d.config) applyConfig(d.config);
                if ($('settings-modal')?.classList.contains('active') && !settingsOpenedWithServerConfig) {
                    openSettings({ preserveTab: true });
                }
                break;

            case 'PANEL_CONFIG_LOAD_ERROR':
                settingsOpenedWithServerConfig = false;
                showPanelConfigLoadState('error', d.message || '');
                break;

            case 'PANEL_CONFIG_SAVE_RESULT': {
                if (document.documentElement.dataset.kitchenView === 'settings') memoryMaintenancePage.settingsSaved(d.success);
                const pending = pendingConfigSaveRequests.get(d.requestId || '');
                if (pending) {
                    pendingConfigSaveRequests.delete(d.requestId || '');
                    if (pending.timeoutId) clearTimeout(pending.timeoutId);
                    const statusEl = $(pending.statusId);
                    if (d.success) {
                        if (d.config) applyConfig(d.config);
                        setStatusText(statusEl, pending.successMessage, 'success');
                        pending.resolve(true);
                    } else {
                        setStatusText(statusEl, `${pending.errorPrefix}${d.error || '未知错误'}`, 'error');
                        pending.resolve(false);
                    }
                } else if (d.success && d.config) {
                    applyConfig(d.config);
                }
                break;
            }

            case 'VECTOR_CONFIG':
                if (d.config && !settingsDirty) loadVectorConfig(d.config);
                break;

            case 'VECTOR_ONLINE_STATUS':
                updateVectorOnlineStatus(d.target, d.status, d.message);
                break;

            case 'VECTOR_STATS':
                updateVectorStats(d.stats);
                break;

            case 'VECTOR_INTEGRITY':
                $('vector-integrity-status').textContent = d.message || '';
                break;

            case 'VECTOR_GEN_PROGRESS':
                updateVectorProgress(d);
                break;

            case 'RECALL_LOG':
                setRecallLog(d.text || '');
                break;

            case 'RECALL_HISTORY':
                setRecallHistory(d.entries || []);
                break;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Event Bindings
    // ═══════════════════════════════════════════════════════════════════════════

    function bindEvents() {
        const setCardBusy = () => {
            $('btn-export-kitchen-card').disabled = $('btn-import-kitchen-card').disabled = true;
            $('kitchen-card-status').textContent = '正在处理后厨卡…';
        };
        $('btn-export-kitchen-card').onclick = () => { setCardBusy(); postMsg('KITCHEN_CARD_EXPORT'); };
        $('btn-import-kitchen-card').onclick = () => $('kitchen-card-file').click();
        $('kitchen-card-file').onchange = async event => {
            const file = event.target.files?.[0]; if (!file) return;
            try {
                if (file.size > 50 * 1024 * 1024) throw new Error('后厨卡超过 50 MB');
                const text = await file.text(), card = JSON.parse(text);
                if (card.type !== 'TavernKitchenCard' || card.version !== 1) throw new Error('不支持的后厨卡格式');
                if (!await showConfirm('导入后厨卡', '导入后将采用卡内数据，替换当前聊天的后厨数据。', '导入', '取消')) return;
                setCardBusy(); postMsg('KITCHEN_CARD_IMPORT', { text });
            } catch (error) { $('kitchen-card-status').textContent = error.message; }
            finally { event.target.value = ''; }
        };

        // Section edit buttons
        $$('.sec-btn[data-section]').forEach(b => b.onclick = () => openEditor(b.dataset.section));

        // Editor modal
        $('editor-backdrop').onclick = closeEditor;
        $('editor-close').onclick = closeEditor;
        $('editor-cancel').onclick = closeEditor;
        $('editor-save').onclick = saveEditor;

        // Settings workspace (设置 → 剧情与召回)
        $('settings-cancel').onclick = () => {
            Object.assign(config, settingsSnapshot);
            openSettings();
        };
        $('settings-config-retry').onclick = retryPanelConfigLoad;
        $('settings-save').onclick = saveSettings;
        $('settings-modal').addEventListener('input', event => { markSettingsDirty(event.target); });

        if ($('recall-round-select')) {
            $('recall-round-select').onchange = e => {
                selectedRecallRoundId = e.target.value;
                renderRecallHistory();
            };
        }

        bindSummaryActions();

        $('keep-visible-count').onchange = e => {
            const parsedCount = Number.parseInt(e.target.value, 10);
            const c = Number.isFinite(parsedCount) ? Math.max(0, Math.min(50, parsedCount)) : 5;
            e.target.value = c;
        };

        // Vector UI
        initVectorUI();

        // Timeline pager
        const tlPagingToggle = $('tl-paging-toggle');
        tlPagingToggle.setAttribute('aria-pressed', String(tlPagingEnabled));
        tlPagingToggle.onclick = () => {
            localStorage.setItem(TL_PAGING_KEY, tlPagingEnabled ? '0' : '1');
            tlPagingEnabled = !tlPagingEnabled;
            tlPagingToggle.setAttribute('aria-pressed', String(tlPagingEnabled));
            renderTimeline(summaryData.rounds);
        };
        $('tl-pg-first').onclick = () => renderTimeline(summaryData.rounds, { page: 0 });
        $('tl-pg-prev').onclick = () => renderTimeline(summaryData.rounds, { page: tlCurrentPage - 1 });
        $('tl-pg-next').onclick = () => renderTimeline(summaryData.rounds, { page: tlCurrentPage + 1 });
        $('tl-pg-last').onclick = () => renderTimeline(summaryData.rounds, { page: tlTotalPages() - 1 });
        const tlPgStrip = $('tl-pg-strip');
        new ResizeObserver(revealTlCurrentPage).observe(tlPgStrip);
        tlPgStrip.addEventListener('click', (e) => {
            const btn = e.target.closest('.tl-pg-btn');
            if (btn) renderTimeline(summaryData.rounds, { page: parseInt(btn.dataset.page, 10) });
        });
        tlPgStrip.addEventListener('wheel', (e) => {
            if (tlPgStrip.scrollWidth <= tlPgStrip.clientWidth) return;
            if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
            e.preventDefault();
            tlPgStrip.scrollLeft += e.deltaY;
        }, { passive: false });
        const tlPgNum = $('tl-pg-num');
        const tlPgJump = () => {
            const v = parseInt(tlPgNum.value, 10);
            if (Number.isNaN(v)) {
                tlPgNum.value = tlCurrentPage + 1;
                return;
            }
            renderTimeline(summaryData.rounds, { page: v - 1 });
        };
        tlPgNum.addEventListener('change', tlPgJump);
        tlPgNum.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                tlPgJump();
            }
        });

        // Parent messages
        window.onmessage = handleParentMessage;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Init
    // ═══════════════════════════════════════════════════════════════════════════

    function init() {
        archiveView = createSummaryArchive({
            getData: () => summaryData,
            hasChat: () => !!currentTimelineChatId,
            getSelectedCharacter: () => currentCharacterId,
            onSelectCharacter: selectCharacter,
            onTimelineChange: options => renderTimeline(summaryData.rounds, options),
            onFactsChange: () => renderFacts(summaryData.facts),
            onEdit: openEditor, postMsg, setHtml, h,
        });
        $('settings-save').textContent = MEMORY_COPY.settingsSave;
        memoryMaintenancePage = createMemoryMaintenancePage($('proofreading-page'), postMsg, { settingsHost: $('proofreading-settings-host') });
        loadConfig();
        tlPagingEnabled = localStorage.getItem(TL_PAGING_KEY) === '1';

        // Initial state
        $('stat-events').textContent = '—';
        $('stat-summarized').textContent = '—';
        $('stat-pending').textContent = '—';
        $('summarized-count').textContent = '0';

        renderTimeline([]);
        updateCharacterSelector();
        renderFacts([]);
        renderRecallHistory();

        bindEvents();
        syncCurrentChatSummaryControls();

        // The host is the only appearance source; legacy local theme choices are ignored.
        document.documentElement.dataset.kitchenTheme = 'host';
        document.documentElement.classList.add('tk-follow-host');




        // Notify parent
        postMsg('FRAME_READY');
        document.body.classList.remove('xb-frame-loading');
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }


    function renderFacts(facts) {
        summaryData.facts = facts || [];

        const container = $('facts-list');
        if (!container) return;
        container.parentElement.querySelector('.tk-story-situations')?.remove();
        const situationPage = document.documentElement.dataset.kitchenView === 'world';
        container.hidden = false;
        if (situationPage) {
            const situations = document.createElement('div'); situations.className = 'tk-story-situations';
            const records = summaryData.storyRecords || [];
            for (const [scenery, title] of [[false, '事态'], [true, '风物']]) {
                const group = document.createElement('div');
                group.dataset.situationGroup = scenery ? 'scenery' : 'affairs';
                const filtered = records.filter(record => record.kind !== 'situation' || scenery === ['scenery','encounter'].includes(record.flavor));
                renderThreads(group, filtered, ['situation'], Infinity, { title });
                situations.append(group);
            }
            container.before(situations);
        }

        archiveView.refreshIndexes();
        const stateFacts = archiveView.filteredFacts();
        if (situationPage) {
            $('archive-world-index').hidden = true;
            $('archive-world-heading').hidden = true;
            $('archive-world-hint').hidden = true;
            container.hidden = stateFacts.length === 0;
        }

        if (!stateFacts.length) {
            setHtml(container, `<div class="archive-empty">${archiveView.worldFacts().length ? ARCHIVE_COPY.noResults : document.documentElement.dataset.kitchenView === 'lore' ? '暂无设定记录' : ARCHIVE_COPY.noFacts}</div>`);
            return;
        }

        const grouped = new Map();
        for (const f of stateFacts) {
            if (!grouped.has(f.s)) grouped.set(f.s, []);
            grouped.get(f.s).push(f);
        }

        let html = '';
        for (const [subject, items] of grouped) {
            html += `<div class="fact-group">
            <div class="fact-group-title">${h(subject)}</div>
            ${items.map(f => `
                <div class="fact-item">
                    <span class="fact-predicate">${h(f.p)}</span>
                    <span class="fact-object">${h(f.o)}</span>
                    <span class="fact-since">#${(f.since || 0) + 1}</span>
                </div>
            `).join('')}
        </div>`;
        }

        setHtml(container, html);
    }

})();
