import { extension_prompts, extension_prompt_roles, extension_prompt_types } from '../../../../../../script.js';
import { createModuleEvents, event_types } from '../../core/event-manager.js';
import { GENERATE_INTERCEPTOR_ORDER, registerGenerateInterceptor, unregisterGenerateInterceptor } from '../../shared/common/generate-interceptor.js';
import { observeBackgroundTask } from '../../shared/common/async-errors.js';
import { generateFeatureText, resolveTextApi } from '../text-api/host.js';
import { createPlanner } from './runtime.js';
import { createNoteStore } from './storage.js';
import { assertPlannerPresetReady } from './preset.js';
import { subscribeWorldBridge } from '../world-records/bridge.js';
import { subscribeWorldSources } from '../world-records/sources.js';

import { createPlannerSettings } from './settings-view.js';

const ID = 'kitchen-chapter-note';
export function installPlanner({snapshot, loadSnapshot, isVisible = () => true, getContext}) {
    let message = '', canRetry = false, view, viewVersion = 0, queued = false, loading = 0, refreshPending = false, disposed = false;
    const status = (text, retryable = false) => {
        message = text;
        canRetry = retryable;
        view?.status(message, canRetry);
        scheduleRefresh();
    };
    const writer = createPlanner({snapshot, store:createNoteStore(), status,
        async write(messages,signal) {
            const preset = await resolveTextApi('planner');
            assertPlannerPresetReady(preset);
            return (await generateFeatureText('planner',{messages,signal,timeoutMs:90000},preset)).text;
        }});
    async function refreshView(load = false) {
        const currentView = view;
        if (disposed || !currentView || !isVisible()) return;
        const ticket = ++viewVersion;
        const current = () => !disposed && view === currentView && viewVersion === ticket && isVisible();
        try {
            if (load && loadSnapshot) {
                loading++;
                try { await loadSnapshot(); } finally { loading--; }
            }
            if (!current()) return;
            const result = await writer.inspect();
            if (current()) currentView.note(result);
        } catch (error) {
            if (current()) currentView.note({ state:'error' });
            else console.warn({ source:import.meta.url, operation:'planner-note-read' }, error);
        }
    }
    function scheduleRefresh() {
        if (disposed || !view || !isVisible() || queued) return;
        if (loading) { refreshPending = true; return; }
        queued = true;
        queueMicrotask(() => {
            queued = false;
            if (loading) refreshPending = true;
            else observeBackgroundTask(refreshView(), {source:import.meta.url,operation:'planner-note-read'});
        });
    }
    const unsubscribeBridge = subscribeWorldBridge(scheduleRefresh);
    const unsubscribeSources = subscribeWorldSources(scheduleRefresh);
    const clear = () => { delete extension_prompts[ID]; };
    let generation = 0;
    const reset = () => { generation++; writer.cancel(); clear(); };
    const events = createModuleEvents(ID);
    events.on(event_types.GENERATION_STARTED, (_type,_options,dryRun) => { if (!dryRun) reset(); });
    events.on(event_types.CHAT_CHANGED, () => { viewVersion++; view?.note({state:'loading'}); reset(); status(''); });
    for (const event of [event_types.GENERATION_STOPPED,event_types.GENERATION_ENDED]) events.on(event,() => { reset(); scheduleRefresh(); });
    registerGenerateInterceptor(ID, async (_chat,contextSize,_abort,type,run) => {
        clear();
        if (!['','normal','continue','regenerate','swipe'].includes(type || '')) return;
        const epoch = ++generation;
        try {
            const text = await writer.prepare(run?.signal);
            if (!text || generation !== epoch || run?.signal?.aborted) return;
            const ctx = getContext();
            const block = '【本章札记】\n' + text;
            const limit = Number(contextSize || ctx.maxContext);
            const cost = ctx.getTokenCountAsync ? await ctx.getTokenCountAsync(block) : new TextEncoder().encode(block).length;
            if (!(cost <= limit * 0.25)) { status('章节稿超过札记预算，本轮已略过'); return; }
            if (generation === epoch && !run?.signal?.aborted) extension_prompts[ID] = {
                value:block, position:extension_prompt_types.IN_CHAT, depth:1, role:extension_prompt_roles.SYSTEM,
            };
        } catch { status('本轮未读取到札记，正文继续'); }
    }, GENERATE_INTERCEPTOR_ORDER.STORY_PLANNER);
    return {
        async open(root, controlsRoot) {
            viewVersion++;
            view = createPlannerSettings(root, {
                controlsRoot,
                retry() {
                    writer.retry();
                    status('将在下次需要审稿时重试');
                },
            });
            view.status(message, canRetry);
            view.note({state:'loading'});
            loading++;
            try { await refreshView(true); }
            finally {
                loading--;
                if (!loading && refreshPending) { refreshPending = false; scheduleRefresh(); }
            }
        },
        dispose() { disposed = true; viewVersion++; view = null; unsubscribeBridge(); unsubscribeSources(); reset(); events.cleanup(); unregisterGenerateInterceptor(ID); },
    };
}
