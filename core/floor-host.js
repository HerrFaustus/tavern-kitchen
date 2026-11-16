import { watchChapterSaves } from '../modules/story-summary/maintenance/notification.js';
import { createModuleEvents, event_types } from './event-manager.js';
import { requireAgent } from './panel-controls.js';
import { registerGenerateInterceptor, unregisterGenerateInterceptor } from '../shared/common/generate-interceptor.js';
import { getChatIdentity } from '../modules/story-summary/data/chat-identity.js';
import { getSummarySourceEnd } from '../modules/story-summary/generate/source-boundary.js';
import { createFloorProcessing } from '../modules/world-records/turn-processing.js';
import { taskDefinitions } from '../modules/world-records/turn-actions.js';
import { generateFeatureText } from '../modules/text-api/host.js';
import { createChapterProcessing } from './chapter-processing.js';
import { preflightOrderedFloorAgents, renderFloorStatus, resolveFailureRoute } from './floor-status.js';

export { preflightOrderedFloorAgents, resolveFailureRoute };

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
        statusNode?.remove();
        statusNode = renderFloorStatus({
            doc: document,
            info,
            hasChat: (getContext().chat || []).length > 0,
            entry: info ? memory.getPublishedSummaryStore()?.floorWork?.[info.floor] : null,
            readOwner: () => read().owner,
            isCurrentFailure: () => failure === info,
            onRetry: () => queue.settle(),
            onOpenAgent: agent => workspace.visitBinding(agent),
            onOpenRecovery: route => workspace.open(route),
            onSaveFloorWork: memory.saveFloorWork,
        });
        if (statusNode) (document.querySelector('#send_form') || document.querySelector('#tk-workspace'))?.prepend(statusNode);
    }
    const queue = createFloorProcessing({ read, tasks:() => floorTasks(settings), store:() => memory.getPublishedSummaryStore() || {},
        save: memory.saveFloorWork, getService: () => archive().service, requireAgent, generate:generateFeatureText,
        review:memory.floorReview, chapter, status:render });
    const kick = () => { const ticket=++batch; queueMicrotask(() => { if (ticket === batch && !failure && archive() && streamStart === null) queue.settle().catch(error => { if (error.name !== 'AbortError' && !failure) console.warn('[TavernKitchen] 逐楼处理已中断',error); }); }); };
    const settingsChanged = () => { failure = null; statusNode?.remove(); statusNode = null; queue.invalidate(); kick(); };
    const events = createModuleEvents('ordered-floors');
    registerGenerateInterceptor('ordered-floors', async (_chat, _size, abort, type) => {
        if (!['normal','continue','regenerate','swipe','group'].includes(type || 'normal')) return;
        const floor = Math.max(0, (getContext().chat || []).length - 1);
        if (!await preflightOrderedFloorAgents({ floor, checkAgent: requireAgent, render, abort })) return;
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
    const onSummarySaved = () => {
        // WHY: executeRollback may finish deleting stale floorWork slightly after MESSAGE_SWIPED's microtask kick latched a source-change failure;
        // clearing that stale error once on summary-saved lets floor processing either settle or advance to world-conflict recovery.
        if (failure?.message?.includes('原文或候选已改变')) {
            failure = null;
            statusNode?.remove();
            statusNode = null;
        }
        kick();
    };
    window.addEventListener('tavernKitchen:summary-saved', onSummarySaved);
    kick();
    async function settleManual() {
        if (!archive()) throw new Error('世界档案尚未就绪，请先打开对话或完成开局初始化。');
        if (streamStart !== null) throw new Error('正在生成正文，请等待本轮输出完成后再手动补齐总结。');
        const floor = Math.max(0, (getContext().chat || []).length - 1);
        await preflightOrderedFloorAgents({ floor, checkAgent: requireAgent, render, throwOnRequired: true });
        if (failure) {
            failure = null;
            statusNode?.remove();
            statusNode = null;
            queue.invalidate();
        }
        await queue.settle();
    }
    function cancelManual() {
        batch++;
        queue.invalidate();
    }
    async function rerunFloor(floor) {
        if (!archive()) throw new Error('世界档案尚未就绪，请先打开对话或完成开局初始化。');
        if (streamStart !== null) throw new Error('正在生成正文，请等待本轮输出完成后再重跑本楼。');
        await preflightOrderedFloorAgents({ floor, checkAgent: requireAgent, render, throwOnRequired: true });
        const store = memory.getPublishedSummaryStore() || {};
        const laterHistory = (store.summaryHistory || []).some(entry => entry?.kind === 'batch' && entry.endMesId > floor);
        const laterWork = Object.entries(store.floorWork || {}).some(([k, row]) => Number(k) > floor
            && ((row?.done?.length || 0) > 0 || row?.reviewed || Object.keys(row?.pending || {}).length > 0));
        const worldService = archive()?.service;
        const world = worldService ? await worldService.read() : null;
        const eventsList = world?.events || [];
        const laterWorld = eventsList.some(event => Number.isInteger(event.at) && event.at > floor);
        const firstFloorIdx = eventsList.findIndex(event => event.at === floor);
        const hasLaterManual = firstFloorIdx >= 0 && eventsList.slice(firstFloorIdx).some(event => event.at === null);
        if (laterHistory || laterWork || laterWorld || hasLaterManual) {
            throw new Error(`第 ${floor + 1} 楼之后已有后续楼层或手工世界修订记录；请先在「数据」中回退到对应位置后再重跑。`);
        }
        await memory.resetFloorForRerun(floor);
        if (firstFloorIdx >= 0 && worldService) {
            const targetVersion = firstFloorIdx > 0 ? eventsList[firstFloorIdx - 1].version : 0;
            await worldService.rewind(world.version, targetVersion);
        }
        failure = null;
        statusNode?.remove();
        statusNode = null;
        queue.invalidate();
        await queue.settle();
    }
    return { settingsChanged, settleManual, cancelManual, rerunFloor, dispose() { queue.cancelGeneration(); queue.invalidate(); batch++; events.cleanup();
        unregisterGenerateInterceptor('ordered-floors'); stopChapter(); window.removeEventListener('tavernKitchen:summary-saved',onSummarySaved); window.removeEventListener('tavernKitchen:floor-settings',settingsChanged); } };
}
