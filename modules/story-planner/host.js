import { extension_prompts, extension_prompt_roles, extension_prompt_types } from '../../../../../../script.js';
import { createModuleEvents, event_types } from '../../core/event-manager.js';
import { GENERATE_INTERCEPTOR_ORDER, registerGenerateInterceptor, unregisterGenerateInterceptor } from '../../shared/common/generate-interceptor.js';
import { generateFeatureText, resolveTextApi } from '../text-api/host.js';
import { getTextApiRepository } from '../text-api/repository.js';
import { acceptsProfile } from '../text-api/profiles.js';
import { createPlanner } from './runtime.js';
import { createNoteStore } from './storage.js';
import { assertPlannerPresetReady } from './preset.js';

import { createPlannerSettings } from './settings-view.js';

const ID = 'kitchen-chapter-note';
export function installPlanner({snapshot, getContext, settings, saveSettings}) {
    let message = '等待正文生成', canRetry = false, renderStatus, view = 0;
    const status = (text, retryable = false) => {
        message = text;
        canRetry = retryable;
        renderStatus?.(message, canRetry);
    };
    const writer = createPlanner({snapshot, store:createNoteStore(), preference:()=>settings.preference || '', status,
        async write(messages,signal) {
            const preset = await resolveTextApi('planner');
            assertPlannerPresetReady(preset);
            return (await generateFeatureText('planner',{messages,signal,timeoutMs:90000},preset)).text;
        }});
    const clear = () => { delete extension_prompts[ID]; };
    let generation = 0;
    const reset = () => { generation++; writer.cancel(); clear(); };
    const events = createModuleEvents(ID);
    events.on(event_types.GENERATION_STARTED, (_type,_options,dryRun) => { if (!dryRun) reset(); });
    events.on(event_types.CHAT_CHANGED, () => { reset(); view++; status('等待正文生成'); });
    for (const event of [event_types.GENERATION_STOPPED,event_types.GENERATION_ENDED]) events.on(event,reset);
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
        async open(root) {
            const token = ++view;
            const repository = await getTextApiRepository();
            const api = await repository.load();
            if (view !== token) return;
            renderStatus = createPlannerSettings(root, {
                presets: api.presets.filter(preset => acceptsProfile('planner', preset)),
                selected: api.bindings.planner,
                preference: settings.preference,
                async save(model, preference) {
                    if (!model) {
                        status('请先在 API 设置中创建并选择独立文本配置', canRetry);
                        return;
                    }
                    const before = settings.preference;
                    try {
                        await repository.mutate('planner', { type: 'select', id: model });
                        settings.preference = preference;
                        await saveSettings();
                        reset();
                        writer.retry();
                        status('配置已保存，下次审稿使用');
                    } catch {
                        settings.preference = before;
                        status('保存失败，请重新打开核对配置', canRetry);
                    }
                },
                retry() {
                    writer.retry();
                    status('将在下次需要审稿时重试');
                },
            });
            renderStatus(message, canRetry);
        },
        dispose() { renderStatus = null; reset(); view++; events.cleanup(); unregisterGenerateInterceptor(ID); },
    };
}
