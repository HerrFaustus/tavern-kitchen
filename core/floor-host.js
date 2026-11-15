import { watchChapterSaves } from '../modules/story-summary/maintenance/notification.js';
import { createModuleEvents, event_types } from './event-manager.js';
import { requireAgent } from './panel-controls.js';
import { registerGenerateInterceptor, unregisterGenerateInterceptor } from '../shared/common/generate-interceptor.js';
import { getChatIdentity } from '../modules/story-summary/data/chat-identity.js';
import { getSummarySourceEnd } from '../modules/story-summary/generate/source-boundary.js';
import { createFloorProcessing } from '../modules/world-records/turn-processing.js';
import { paidPrice, taskDefinitions } from '../modules/world-records/turn-actions.js';
import { generateFeatureText } from '../modules/text-api/host.js';
import { createChapterProcessing } from './chapter-processing.js';

export function floorTasks(settings) {
    const world = settings?.xiaobaiOs?.apps?.world || {};
    const tasks = [];
    const add = (key, group, label = taskDefinitions[key]?.[0]) => tasks.push({ key, group, label });
    for (const key of ['memory', 'overview', 'people', 'places', 'situation', 'suspense', 'clues']) add(key, 'update');
    for (const key of ['peopleEvolution', 'subscribed', 'sceneryEvolution']) add(key, 'simulation');
    const frequency = world.encounterFrequency ?? 'occasional';
    if (['occasional', 'lively'].includes(frequency)) {
        tasks.push({ key: 'encounter', group: 'simulation', label: taskDefinitions.encounter[0], frequency });
    }
    add('mapEvolution', 'simulation');
    add('review', 'review', '校对');
    add('chapter', 'chapter', '章节整理');
    return tasks;
}

export function installFloorHost({ settings, getContext, memory, archive, planner, workspace }) {
    let streamStart = null, statusNode, failure, batch = 0;
    const read = () => {
        const ctx = getContext(), chat = ctx.chat || [];
        return { owner: getChatIdentity(ctx), playerName:ctx.name1, chat, end: getSummarySourceEnd(chat, Math.min(chat.length - 1, streamStart ?? Infinity)) };
    };
    const plannerEnabled = () => true;
    const chapter = createChapterProcessing({read, memory, requireUpdate:() => requireAgent('update'),
        reviewEnabled:() => true, plannerEnabled,
        writeChapter:(source, signal) => planner().onChapter(signal, source.end)});
    function render(info) {
        failure = info?.error ? info : null;
        statusNode?.remove(); statusNode = null;
        if (!info) return;
        statusNode = document.createElement('div'); statusNode.id = 'tk-floor-status'; statusNode.setAttribute('role', info.error ? 'alert' : 'status');
        const hasChat = (getContext().chat || []).length > 0;
        const title = document.createElement('span');
        title.textContent = hasChat ? `后厨 · 第 ${info.floor + 1} 楼 · ${info.message}` : `后厨 · ${info.message}`;
        statusNode.append(title);
        const button = (label, action) => { const b = document.createElement('button'); b.type='button'; b.className='menu_button'; b.textContent=label;
            b.addEventListener('click', () => { Promise.resolve().then(action).catch(e => { title.textContent=e.message; }); }); statusNode.append(b); };
        if (info.error) {
            button('重试本楼', () => queue.settle());
            button(info.error.agent ? '前往设置' : '查看恢复', () => info.error.agent ? workspace.visitBinding(info.error.agent) : workspace.open('data'));
            const entry = memory.getPublishedSummaryStore()?.floorWork?.[info.floor];
            for (const [id, item] of Object.entries(entry?.review || {})) {
                if (entry.decisions?.[id] === 'rejected') continue;
                const corrections = item.rows.filter(r => r.type === 'trade' && paidPrice(r.paymentQuote) !== null && r.price !== paidPrice(r.paymentQuote));
                const why = document.createElement('span');
                why.textContent = item.rows.map(r => r.type === 'trade' ? `${r.quote} · 模型价 ${r.price} 金币 · 收付依据「${r.paymentQuote}」` : `${r.quote}（${r.field || r.type}）`).join('、');
                statusNode.append(why);
                const accept = corrections.length ? '按原文价确认（' + corrections.map(r => paidPrice(r.paymentQuote) + ' 金币').join('、') + '）' : '确认该组';
                for (const [value,label] of [['accepted',accept],['rejected','拒绝该组']]) button(label, async () => {
                    const owner=read().owner;
                    await memory.saveFloorWork(entry.source, () => { if (read().owner !== owner || failure !== info) throw new Error('请重新核对本楼'); },
                        (record) => { (record.decisions ??= {})[id]=value; });
                    await queue.settle();
                });
            }
        }
        (document.querySelector('#send_form') || document.querySelector('#tk-workspace'))?.prepend(statusNode);
    }
    const queue = createFloorProcessing({ read, tasks:() => floorTasks(settings), store:() => memory.getPublishedSummaryStore() || {},
        save: memory.saveFloorWork, getService: () => archive().service, requireAgent, generate:generateFeatureText,
        review:memory.floorReview, chapter, status:render });
    const kick = () => { const ticket=++batch; queueMicrotask(() => { if (ticket === batch && !failure && archive() && streamStart === null) queue.settle().catch(error => { if (error.name !== 'AbortError' && !failure) console.warn('[TavernKitchen] 逐楼处理已中断',error); }); }); };
    const settingsChanged = () => { failure = null; statusNode?.remove(); statusNode = null; queue.invalidate(); kick(); };
    const events = createModuleEvents('ordered-floors');
    registerGenerateInterceptor('ordered-floors', async (_chat, _size, abort, type) => {
        if (!['normal','continue','regenerate','swipe','group'].includes(type || 'normal')) return;
        // WHY: Check required agents before queue.beforeGeneration so an unconfigured-agent block
        // fails closed immediately instead of pausing generation indefinitely while waiting to resume.
        try {
            await requireAgent('update');
            await requireAgent('simulation');
        } catch (error) {
            const floor = Math.max(0, (getContext().chat || []).length - 1);
            render({ floor, message: error.message, error });
            abort();
            return;
        }
        let aborted = false;
        await queue.beforeGeneration(() => { aborted = true; abort(); });
        if (aborted) return;
    }, 0);
    events.on(event_types.GENERATION_STARTED, (type,_params,dry) => {
        if (dry || ['quiet','impersonate'].includes(type)) return;
        const end = (getContext().chat || []).length - 1;
        streamStart = ['regenerate','swipe'].includes(type) ? end - 1 : end;
    });
    for (const event of ['MESSAGE_RECEIVED','GENERATION_ENDED','GROUP_WRAPPER_FINISHED']) if (event_types[event]) events.on(event_types[event], () => {
        if (event !== 'MESSAGE_RECEIVED' || !document.body?.dataset?.generating) streamStart = null;
        kick();
    });
    for (const event of ['MESSAGE_EDITED','MESSAGE_SWIPED','MESSAGE_DELETED','CHAT_CHANGED']) events.on(event_types[event], () => {
        if (event === 'CHAT_CHANGED') { queue.cancelGeneration(); streamStart = null; }
        queue.invalidate(); kick();
    });
    events.on(event_types.GENERATION_STOPPED, () => { queue.cancelGeneration(); });
    window.addEventListener('tavernKitchen:floor-settings', settingsChanged);
    const stopChapter = watchChapterSaves({ enabled:() => true, changed:kick });
    window.addEventListener('tavernKitchen:summary-saved', kick);
    kick();
    return { settingsChanged, dispose() { queue.cancelGeneration(); queue.invalidate(); batch++; events.cleanup();
        unregisterGenerateInterceptor('ordered-floors'); stopChapter(); window.removeEventListener('tavernKitchen:summary-saved',kick); window.removeEventListener('tavernKitchen:floor-settings',settingsChanged); } };
}
