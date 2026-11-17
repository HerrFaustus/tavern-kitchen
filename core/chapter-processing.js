import { planNextCompression, summaryLayers } from '../modules/story-summary/data/summary-layers.js';
import { runRecursiveCompressionCascade } from '../modules/story-summary/generate/layer-cascade.js';
import { memoryDigest } from '../modules/story-summary/data/memory-policy.js';
import { featureCalls } from '../modules/text-api/call-stats.js';

export function createChapterProcessing({read, memory, requireUpdate, reviewEnabled = () => true, plannerEnabled, writeChapter}) {
    const historyFor = (data, end) => (data.summaryHistory || []).filter(row => row.endMesId <= end);
    function chapterAt(source, data) {
        const history = historyFor(data, source.end);
        const batch = history.find(row => row.endMesId === source.end);
        const nodes = [...(batch?.compressionNodes || []), ...(batch?.reviewLayers || [])];
        const chapter = batch?.pendingPlannerChapter && nodes.findLast(n => n.level === 'chapter' && n.sourceId === batch.pendingPlannerChapter);
        return chapter && memoryDigest([chapter.start, chapter.end, chapter.sourceId, chapter.text]);
    }
    return {
        pending(source, data) {
            const node = chapterAt(source, data);
            return (reviewEnabled() && !!planNextCompression(historyFor(data, source.end), {chat:read().chat}))
                || !!(node && plannerEnabled() && data.floorWork?.[source.end]?.chapter !== node);
        },
        async run(source, signal, check) {
            const data = memory.getPublishedSummaryStore();
            const history = historyFor(data,source.end), chat = read().chat;
            if (reviewEnabled() && planNextCompression(history, {chat})) {
                await requireUpdate(); check();
                const agentTask = featureCalls.task('summary');
                const nodes = await runRecursiveCompressionCascade({summaryHistory:history}, { chat, signal,
                    summarizeLayer: request => memory.generateReviewedLayer({...request,agentTask}) });
                if (!nodes.length) throw new Error('跨章总结未生成，请重试');
                await memory.saveFloorWork(source,check,(_entry,store) => {
                    const current = historyFor(store,source.end), valid = summaryLayers(current,nodes,{chat:read().chat});
                    if (!nodes.every(n => valid.parents.includes(n))) throw new Error('章节来源已变化，请重试');
                    const targetBatch = current.at(-1);
                    (targetBatch.compressionNodes ??= []).push(...nodes);
                    // WHY: Mark newly minted chapter node so planner.onChapter immediately triggers below without needing removed review stage.
                    const chapter = nodes.findLast(n => n.level === 'chapter');
                    if (chapter) targetBatch.pendingPlannerChapter = chapter.sourceId;
                });
            }
            const fresh = memory.getPublishedSummaryStore();
            const node = chapterAt(source,fresh);
            if (node && plannerEnabled() && fresh.floorWork?.[source.end]?.chapter !== node) {
                await writeChapter(source, signal);
                await memory.saveFloorWork(source,check,entry => { entry.chapter = node; });
            }
        },
    };
}
