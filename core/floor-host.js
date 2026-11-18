import { createModuleEvents, event_types } from './event-manager.js';
import { requireAgent } from './panel-controls.js';
import { registerGenerateInterceptor, unregisterGenerateInterceptor } from '../shared/common/generate-interceptor.js';
import { getChatIdentity } from '../modules/story-summary/data/chat-identity.js';
import { getUpdateAndSimulationBounds } from '../modules/story-summary/data/turn-bounds.js';
import { isNarrativeReply } from '../modules/story-summary/data/turn-source.js';
import { createFloorProcessing } from '../modules/world-records/turn-processing.js';
import { turnById } from '../modules/world-records/turn-ledger.js';
import { taskDefinitions } from '../modules/world-records/turn-actions.js';
import { generateFeatureText } from '../modules/text-api/host.js';
import { createChapterProcessing } from './chapter-processing.js';
import { preflightOrderedFloorAgents, resolveFailureRoute } from './floor-status.js';
import { askOpening, openingGateNeeded, OPENING_GATE_TYPES, OPENING_SKIP_KEY } from './opening-gate.js';
import { clearAgentNotice, setAgentIdleStatus, showAgentNotice } from './agent-status.js';

export { preflightOrderedFloorAgents, resolveFailureRoute };

export function floorTasks(settings) {
    const world = settings?.xiaobaiOs?.apps?.world || {};
    const tasks = [];
    const add = (key, group, label = taskDefinitions[key]?.[0]) => tasks.push({ key, group, label });
    for (const key of ['memory', 'overview', 'people', 'places', 'situation', 'suspense']) add(key, 'update');
    const frequency = world.encounterFrequency ?? 'occasional';
    tasks.push({ key: 'simulation', group: 'simulation', label: taskDefinitions.simulation[0], frequency });
    add('chapter', 'chapter', '章节整理');
    return tasks;
}

export function installFloorHost({ settings, getContext, memory, archive, planner, workspace }) {
    let streamStart = null, failure, batch = 0, openingGate = null;
    const retrySend = () => document.querySelector('#send_but')?.click();
    const notifyFailure = (message, error) => {
        // WHY: a later empty-queue kick must not erase a blocking failure: the
        // latch also suppresses status(null) until the user retries or settings change.
        failure = { message, error };
        showAgentNotice({ level:'error', message, error, pinned:true, retry:retrySend });
    };
    const isFloorSettled = (store, floor) => {
        const updateKeys = floorTasks(settings).filter(task => task.group === 'update').map(task => task.key);
        const work = store?.floorWork?.[floor];
        if (work) return updateKeys.every(key => (work.done || []).includes(key));
        return (store?.summaryHistory || []).some(entry =>
            entry?.kind === 'batch' && !entry.floorEntry?.deleted
            && (entry.sourceReceipt?.source?.start ?? entry.roundSource?.start ?? (entry.previousEndMesId ?? -1) + 1) <= floor
            && entry.endMesId >= floor
            && entry.endMesId <= (store?.lastSummarizedMesId ?? -1),
        );
    };
    const syncIdleStatus = () => {
        const ctx = getContext(), chat = ctx?.chat || [];
        const store = memory?.getPublishedSummaryStore?.() || {};
        const bounds = getUpdateAndSimulationBounds(chat);
        let totalReplies = 0, settledCount = 0;
        for (let i = 0; i <= bounds.updateEnd; i++) {
            if (!isNarrativeReply(chat[i])) continue;
            totalReplies++;
            if (isFloorSettled(store, i)) settledCount++;
        }
        const pendingCount = Math.max(0, totalReplies - settledCount);
        const openKitchen = () => workspace?.open?.('memory');
        if (!totalReplies) {
            setAgentIdleStatus({
                message: '后厨待命 · 等待角色回复后推演，发送下一轮前自动总结',
                actions: workspace?.open ? [{ label: '打开后厨', callback: openKitchen }] : [],
            });
            return;
        }
        if (pendingCount > 0) {
            setAgentIdleStatus({
                message: `后厨待命 · 已总结 ${settledCount} 楼，待总结 ${pendingCount} 楼（发送下轮前自动总结）`,
                actions: [
                    { label: '手动总结', callback: () => settleManual() },
                    ...(workspace?.open ? [{ label: '打开后厨', callback: openKitchen }] : []),
                ],
            });
            return;
        }
        setAgentIdleStatus({
            message: `后厨待命 · 已总结全部 ${settledCount} 楼，世界状态已同步`,
            actions: workspace?.open ? [{ label: '打开后厨', callback: openKitchen }] : [],
        });
    };
    async function ensureOpening(type) {
        if (!OPENING_GATE_TYPES.has(type || 'normal')) return true;
        const ctx = getContext();
        if (!ctx?.chat?.length) return true;
        const world = archive();
        if (!world?.service || typeof world.initialize !== 'function') {
            notifyFailure('世界档案尚未就绪，本轮未发送。输入已保留，请稍后重试。', new Error('世界档案尚未就绪'));
            return false;
        }
        let state;
        try { state = await world.service.read(); }
        catch (error) {
            notifyFailure(`读取世界档案失败，本轮未发送：${error?.message || error}。输入已保留。`, error);
            return false;
        }
        if (!openingGateNeeded(state, ctx)) return true;
        if (!openingGate) openingGate = (async () => {
            try {
                const outcome = await askOpening({
                    context: ctx,
                    initialize: () => world.initialize({ manual:true }),
                    saveSkip: async () => {
                        if (!ctx.chatMetadata) throw new Error('当前聊天不支持保存跳过标记');
                        ctx.chatMetadata[OPENING_SKIP_KEY] = true;
                        if (typeof ctx.saveMetadata !== 'function') throw new Error('当前酒馆无法保存跳过标记，请完成世界初始化');
                        await ctx.saveMetadata();
                    },
                    onProgress: message => showAgentNotice({ message, pinned:true }),
                });
                if (outcome === 'cancel') {
                    notifyFailure('已取消世界初始化，本轮未发送，输入已保留。需要重试时点击「重试」。', new Error('世界初始化已取消'));
                    return false;
                }
                if (outcome === 'initialized') {
                    const id = showAgentNotice({ message:'世界初始化完成，继续发送…', pinned:true });
                    setTimeout(() => clearAgentNotice(id), 3000);
                }
                return true;
            } catch (error) {
                notifyFailure(`世界初始化失败，本轮未发送：${error?.message || error}。输入已保留。`, error);
                return false;
            } finally { openingGate = null; }
        })();
        return openingGate;
    }
    const read = () => {
        const ctx = getContext(), chat = ctx.chat || [];
        const requestedEnd = Math.min(chat.length - 1, streamStart ?? Infinity);
        const bounds = getUpdateAndSimulationBounds(chat, requestedEnd);
        return {
            owner: getChatIdentity(ctx),
            playerName: ctx.name1,
            chat,
            end: bounds.stableEnd,
            simulationEnd: bounds.simulationEnd,
            updateEnd: bounds.updateEnd,
        };
    };
    const plannerEnabled = () => true;
    const chapter = createChapterProcessing({read, memory, requireUpdate:() => requireAgent('update'),
        reviewEnabled:() => true, plannerEnabled,
        writeChapter:(source, signal) => planner().onChapter(signal, source.end)});
    function render(info) {
        failure = info?.error ? info : null;
        if (!info) {
            syncIdleStatus();
            clearAgentNotice();
            return;
        }
        const hasChat = (getContext().chat || []).length > 0;
        showAgentNotice({
            message: hasChat && Number.isInteger(info.floor) ? `第 ${info.floor + 1} 楼 · ${info.message}` : info.message,
            level: info.error ? 'error' : 'info',
            agent: info.agent || null,
            error: info.error || null,
            retry: info.error ? () => queue.settle({ update: info.group !== 'simulation' }) : null,
            recoveryRoute: info.error ? resolveFailureRoute(info.error) : null,
            pinned: !!info.error,
        });
    }
    const queue = createFloorProcessing({ read, tasks:() => floorTasks(settings), store:() => memory.getPublishedSummaryStore() || {},
        save: memory.saveFloorWork, saveSim: memory.saveFloorSimulation, getService: () => archive().service, requireAgent, generate:generateFeatureText,
        chapter, onUpdateSettled: floor => { syncIdleStatus(); return memory.reconcileSettledFloorChunks?.(floor); }, status:render });
    // WHY: a finished reply immediately gets its background simulation only.
    // The structured summary is settled before the next new send so a swipe or
    // regenerate never replaces the latest floor after it was already summarized.
    const kick = () => { const ticket=++batch; queueMicrotask(() => { if (ticket === batch && !failure && archive() && streamStart === null) queue.settle({ update:false }).catch(error => { if (error.name !== 'AbortError' && !failure) console.warn('[TavernKitchen] 逐楼处理已中断',error); }); }); };
    const settingsChanged = () => { failure = null; syncIdleStatus(); clearAgentNotice(); queue.invalidate(); kick(); };
    const events = createModuleEvents('ordered-floors');
    const replacingTypes = new Set(['swipe', 'regenerate']);
    registerGenerateInterceptor('ordered-floors', async (_chat, _size, abort, type) => {
        if (!['normal','continue','regenerate','swipe','group'].includes(type || 'normal')) return;
        if (!await ensureOpening(type)) { abort(true); return; }
        const floor = Math.max(0, (getContext().chat || []).length - 1);
        if (!await preflightOrderedFloorAgents({ floor, checkAgent: requireAgent, render, abort })) return;
        // Replaced floors are never settled here: the selected swipe will be
        // simulated and summarized on the following new send.
        if (replacingTypes.has(type || 'normal')) return;
        let aborted = false;
        await queue.beforeGeneration((immediately = true) => { aborted = true; abort(immediately); });
        if (aborted) return;
    }, 0);
    events.on(event_types.GENERATION_STARTED, (type,_params,dry) => {
        if (dry || ['quiet','impersonate'].includes(type)) return;
        const end = (getContext().chat || []).length - 1;
        streamStart = ['regenerate','swipe'].includes(type) ? end - 1 : end;
    });
    for (const event of ['MESSAGE_RECEIVED','GENERATION_ENDED','GROUP_WRAPPER_FINISHED']) if (event_types[event]) events.on(event_types[event], () => {
        if (event !== 'MESSAGE_RECEIVED' || !document.body?.dataset?.generating) streamStart = null;
        syncIdleStatus();
        kick();
    });
    for (const event of ['MESSAGE_EDITED','MESSAGE_SWIPED','MESSAGE_DELETED','CHAT_CHANGED']) events.on(event_types[event], () => {
        if (event === 'CHAT_CHANGED') { queue.cancelGeneration(); streamStart = null; }
        syncIdleStatus();
        queue.invalidate(); kick();
    });
    events.on(event_types.GENERATION_STOPPED, () => { streamStart = null; queue.cancelGeneration(); syncIdleStatus(); kick(); });
    window.addEventListener('tavernKitchen:floor-settings', settingsChanged);
    const onSummarySaved = () => {
        // WHY: executeRollback may finish deleting stale floorWork slightly after MESSAGE_SWIPED's microtask kick latched a source-change failure;
        // clearing that stale error once on summary-saved lets floor processing either settle or advance to world-conflict recovery.
        if (failure?.message?.includes('原文或候选已改变')) {
            failure = null;
            clearAgentNotice();
        }
        syncIdleStatus();
        kick();
    };
    window.addEventListener('tavernKitchen:summary-saved', onSummarySaved);
    syncIdleStatus();
    kick();
    async function settleManual() {
        if (!archive()) throw new Error('世界档案尚未就绪，请先打开对话或完成开局初始化。');
        if (streamStart !== null) throw new Error('正在生成正文，请等待本轮输出完成后再手动补齐总结。');
        const floor = Math.max(0, (getContext().chat || []).length - 1);
        await preflightOrderedFloorAgents({ floor, checkAgent: requireAgent, render, throwOnRequired: true });
        if (failure) {
            failure = null;
            clearAgentNotice();
            queue.invalidate();
        }
        await queue.settle();
        syncIdleStatus();
    }
    function cancelManual() {
        batch++;
        queue.invalidate();
    }
    const eventFloor = (world, event) => {
        const origins = [event?.origin, ...(event?.origins || [])].filter(Boolean);
        return origins.length ? Math.max(...origins.map(origin => turnById(world, origin.sourceId)?.source.end ?? Infinity)) : null;
    };
    async function assertNoLaterHistory(floor, store) {
        const laterHistory = (store.summaryHistory || []).some(entry => entry?.kind === 'batch' && entry.endMesId > floor);
        const laterWork = Object.entries(store.floorWork || {}).some(([k, row]) => Number(k) > floor
            && ((row?.done?.length || 0) > 0 || row?.reviewed || Object.keys(row?.pending || {}).length > 0));
        const worldService = archive()?.service;
        const world = worldService ? await worldService.read() : null;
        const eventsList = world?.events || [];
        const laterWorld = world ? eventsList.some(event => {
            const at = eventFloor(world, event);
            return at !== null && at > floor;
        }) : false;
        const firstFloorIdx = world ? eventsList.findIndex(event => eventFloor(world, event) === floor) : -1;
        const hasLaterManual = world && firstFloorIdx >= 0 && eventsList.slice(firstFloorIdx).some(event =>
            eventFloor(world, event) === null && event.effects?.some(effect => ['entity', 'claim', 'module'].includes(effect.type)),
        );
        if (laterHistory || laterWork || laterWorld || hasLaterManual) {
            throw new Error(`第 ${floor + 1} 楼之后已有后续楼层或手工世界修订记录；请先在「数据」中回退到对应位置后再重跑。`);
        }
        return { worldService, world, eventsList, firstFloorIdx };
    }
    async function rerunFloor(floor) {
        if (!archive()) throw new Error('世界档案尚未就绪，请先打开对话或完成开局初始化。');
        if (streamStart !== null) throw new Error('正在生成正文，请等待本轮输出完成后再重跑本楼。');
        await preflightOrderedFloorAgents({ floor, checkAgent: requireAgent, render, throwOnRequired: true });
        const store = memory.getPublishedSummaryStore() || {};
        const { worldService, world, eventsList, firstFloorIdx } = await assertNoLaterHistory(floor, store);
        await memory.resetFloorForRerun(floor);
        if (firstFloorIdx >= 0 && worldService) {
            const targetVersion = firstFloorIdx > 0 ? eventsList[firstFloorIdx - 1].version : 0;
            await worldService.rewind(world, targetVersion);
        }
        failure = null;
        clearAgentNotice();
        queue.invalidate();
        await queue.settle();
        syncIdleStatus();
    }
    async function summarizeFloor(floor) {
        if (!archive()) throw new Error('世界档案尚未就绪，请先打开对话或完成开局初始化。');
        if (streamStart !== null) throw new Error('正在生成正文，请等待本轮输出完成后再手动总结。');
        const chat = getContext().chat || [];
        if (!Number.isInteger(floor) || floor < 0 || !isNarrativeReply(chat[floor])) {
            throw new Error('只能总结叙事 AI 回复楼层。');
        }
        const store = memory.getPublishedSummaryStore() || {};
        if (isFloorSettled(store, floor)) return await rerunFloor(floor);
        // Unsettled floors keep any already-generated simulation prose intact and
        // settle directly through the ordered queue without wiping floorSimulations.
        await assertNoLaterHistory(floor, store);
        return await settleManual();
    }
    return { settingsChanged, settleManual, cancelManual, rerunFloor, summarizeFloor, dispose() { queue.cancelGeneration(); queue.invalidate(); batch++; events.cleanup();
        unregisterGenerateInterceptor('ordered-floors'); window.removeEventListener('tavernKitchen:summary-saved',onSummarySaved); window.removeEventListener('tavernKitchen:floor-settings',settingsChanged); } };
}
