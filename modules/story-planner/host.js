import { extension_prompts, extension_prompt_roles, extension_prompt_types } from '../../../../../../script.js';
import { createModuleEvents, event_types } from '../../core/event-manager.js';
import { GENERATE_INTERCEPTOR_ORDER, registerGenerateInterceptor, unregisterGenerateInterceptor } from '../../shared/common/generate-interceptor.js';
import { generateFeatureText, resolveTextApi } from '../text-api/host.js';
import { getTextApiRepository } from '../text-api/repository.js';
import { acceptsProfile } from '../text-api/profiles.js';
import { createPlanner } from './runtime.js';
import { createNoteStore } from './storage.js';
import { assertPlannerPresetReady } from './preset.js';

const ID = 'kitchen-chapter-note';
export function installPlanner({snapshot, getContext, settings, saveSettings}) {
    let message = '等待正文生成', statusNode, view = 0;
    const status = text => { message = text; if (statusNode?.isConnected) statusNode.textContent = text; };
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
    events.on(event_types.CHAT_CHANGED, () => { reset(); view++; statusNode = null; message = '等待正文生成'; });
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
            const el = (tag,text) => Object.assign(document.createElement(tag),text ? {textContent:text} : {});
            const panel = el('section'); panel.style.cssText='display:grid;gap:1em;max-width:42rem;margin:1rem auto;padding:1rem';
            const modelLabel = el('label','后台作家模型 '), model = el('select');
            model.append(new Option('选择独立模型配置',''));
            for (const preset of api.presets.filter(p=>acceptsProfile('planner',p))) model.append(new Option(preset.name,preset.id));
            model.value = api.bindings.planner;
            modelLabel.append(model);
            const prefLabel = el('label','创作偏好'), pref = el('textarea');
            pref.rows = 4; pref.maxLength = 3000; pref.value = settings.preference || ''; pref.style.width='100%';
            prefLabel.append(pref);
            const save = el('button','保存配置'), retry = el('button','下次正文重试'), state = el('p',message);
            statusNode = state; state.setAttribute('role','status');
            save.onclick = async () => {
                if (!model.value) { status('请先在 API 设置中创建并选择独立文本配置'); return; }
                save.disabled = true;
                const before = settings.preference;
                try {
                    await repository.mutate('planner',{type:'select',id:model.value});
                    settings.preference = pref.value.trim(); await saveSettings();
                    reset(); writer.retry(); status('配置已保存，下次审稿使用');
                } catch { settings.preference = before; status('保存失败，请重新打开核对配置'); }
                finally { save.disabled = false; }
            };
            retry.onclick = () => { writer.retry(); status('将在下次需要审稿时重试'); };
            panel.append(modelLabel,prefLabel,save,retry,state); root.replaceChildren(panel);
        },
        dispose() { reset(); view++; events.cleanup(); unregisterGenerateInterceptor(ID); },
    };
}
