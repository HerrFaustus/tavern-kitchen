import { promptsForPanel } from './panel-policy.js';
import { acceptsProfile, PROFILE_FEATURES } from '../modules/text-api/profiles.js';
import { HOST_BINDING } from '../modules/text-api/model.js';

const bindings = {planner:['planner'],opening:['opening'],people:['world'],situation:['world'],map:['world'],memory:['summary'],
    'memory-settings':['summary','embedding','rerank','l0'],proofreading:['memory','summary']};

const loadRepository = async () => (await import('../modules/text-api/repository.js')).getTextApiRepository();

export function mountPanelControls(id, bar, settings, savePrompt, getRepository = loadRepository) {
    const keys = bindings[id] || [], prompts = promptsForPanel(id);
    if (!keys.length && !prompts.length) return;
    bar.hidden = false;
    const doc = bar.ownerDocument, group = doc.createElement('div');
    group.className = 'tk-panel-controls'; bar.append(group);
    const status = doc.createElement('small'); status.setAttribute('role','status');
    const field = (parent,label,control) => {
        const row = doc.createElement('label'); row.append(doc.createTextNode(label),control); parent.append(row);
    };
    if (keys.length) {
        const api = doc.createElement('div'); group.append(api); api.textContent = '正在读取 API 配置…';
        const load = async () => {
            const repository = await getRepository(), config = await repository.load();
            api.replaceChildren();
            for (const key of keys) {
                const select = doc.createElement('select');
                const selected = config.bindings[key] ?? (key === 'opening' ? config.bindings.world : '');
                const choices = config.presets.filter(p => acceptsProfile(key,p));
                const items = [{id:'',name:'选择 API 配置'},...(key === 'summary' ? [{id:HOST_BINDING,name:'跟随酒馆当前模型'}] : []),...choices];
                for (const {id:value,name} of items) {
                    const option = doc.createElement('option'); option.value = value; option.textContent = name;
                    option.disabled = !value; option.selected = value === (selected || ''); select.append(option);
                }
                field(api,(PROFILE_FEATURES[key] || key)+' API',select);
                let saved = select.value;
                select.onchange = async () => {
                    select.disabled = true;
                    try { await repository.mutate(key,select.value === HOST_BINDING ? {type:'select-host'} : {type:'select',id:select.value});
                        saved = select.value; status.textContent = 'API 配置已保存'; }
                    catch (error) { select.value = saved; status.textContent = error.message; }
                    finally { select.disabled = false; }
                };
            }
        };
        load().catch(error => { api.textContent = error.message; });
    }
    if (prompts.length) {
        const details = doc.createElement('details'), summary = doc.createElement('summary');
        summary.textContent = '提示词'; details.append(summary); group.append(details);
        const protocols = doc.createElement('details'), title = doc.createElement('summary');
        title.textContent = '工具说明'; protocols.append(title);
        for (const entry of prompts) {
            const section = entry.validate ? protocols : details;
            const input = doc.createElement('textarea'); input.rows = 5; input.className = 'text_pole';
            input.value = settings.panelPrompts?.[entry.key] ?? entry.template;
            field(section,entry.label,input);
            const controls = doc.createElement('div');
            for (const reset of [false,true]) {
                const button = doc.createElement('button'); button.type = 'button'; button.className = 'menu_button';
                button.textContent = reset ? '恢复默认并保存' : '保存';
                button.onclick = async () => {
                    try { if (!reset) entry.validate?.(input.value);
                        await savePrompt(entry.key,reset ? undefined : input.value); if (reset) input.value = entry.template;
                        status.textContent = entry.label+'已保存'; }
                    catch (error) { status.textContent = error.message; }
                };
                controls.append(button);
            }
            section.append(controls);
        }
        if (protocols.childElementCount > 1) details.append(protocols);
    }
    group.append(status);
}
