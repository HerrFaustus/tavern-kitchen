import { acceptsProfile, PROFILE_FEATURES } from '../modules/text-api/profiles.js';
import { HOST_BINDING } from '../modules/text-api/model.js';

const bindings = {clues:['summary'],planner:['planner'],opening:['opening'],people:['world'],situation:['world'],map:['world'],memory:['summary','embedding','rerank','l0'],proofreading:['memory','summary']};

const loadRepository = async () => (await import('../modules/text-api/repository.js')).getTextApiRepository();

export function mountPanelControls(id, bar, getRepository = loadRepository, sections) {
    const keys = bindings[id] || [];
    if (!keys.length) return;
    bar.hidden = false;
    const doc = bar.ownerDocument, group = doc.createElement('div');
    group.className = 'tk-panel-controls';
    (sections?.model || bar).append(group);
    const status = doc.createElement('small'); status.setAttribute('role','status');
    const field = (parent,label,control) => {
        const row = doc.createElement('label'); row.append(doc.createTextNode(label),control); parent.append(row);
    };
    const api = doc.createElement('div'); api.className = 'tk-api-fields'; group.append(api); api.textContent = '正在读取 API 配置…';
    const load = async () => {
        const repository = await getRepository(), config = await repository.load();
        api.replaceChildren();
        let openingNote;
        const recall = doc.createElement('section');
        const title = doc.createElement('h5'); title.textContent = '召回模型'; recall.append(title);
        for (const key of keys) {
            const select = doc.createElement('select'); select.className = 'text_pole';
            const selected = config.bindings[key] ?? (key === 'opening' ? config.bindings.world : '');
            const choices = config.presets.filter(p => acceptsProfile(key,p));
            const items = [{id:'',name:'选择 API 配置'},...(key === 'summary' ? [{id:HOST_BINDING,name:'跟随酒馆主 API'}] : []),...choices];
            for (const {id:value,name} of items) {
                const option = doc.createElement('option'); option.value = value; option.textContent = name;
                option.disabled = !value; option.selected = value === (selected || ''); select.append(option);
            }
            const parent = ['embedding','rerank','l0'].includes(key) ? recall : api;
            if (parent === recall && !recall.parentElement) api.append(recall);
            const modelLabel = id === 'proofreading' && key === 'summary'
                ? '篇目和章节总结模型' : (PROFILE_FEATURES[key] || key)+'模型';
            field(parent,modelLabel,select);
            let saved = select.value;
            select.onchange = async () => {
                select.disabled = true;
                try { await repository.mutate(key,select.value === HOST_BINDING ? {type:'select-host'} : {type:'select',id:select.value});
                    saved = select.value; status.textContent = '已切换到' + items.find(item => item.id === saved)?.name;
                    if (openingNote) openingNote.textContent = '世界生成使用单独选择的模型。'; }
                catch (error) { select.value = saved; status.textContent = error.message; }
                finally { select.disabled = false; }
            };
        }
        if (['people', 'map', 'situation'].includes(id)) {
            const note = doc.createElement('small');
            note.textContent = '人物、地图和局势共用此模型，在任一处更改会同步到其他两处。';
            api.append(note);
        }
        if (id === 'opening') {
            openingNote = doc.createElement('small');
            openingNote.textContent = config.bindings.opening
                ? '世界生成使用单独选择的模型。' : '世界生成未单独选择时，跟随世界与地图后台模型。';
            api.append(openingNote);
        }
    };
    load().catch(error => { api.textContent = error.message; });
    group.append(status);
}
