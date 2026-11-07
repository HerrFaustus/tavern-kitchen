import { memoryDigest } from '../story-summary/data/memory-policy.js';
import { summaryLayers } from '../story-summary/data/summary-layers.js';
import { captureRangeSource } from '../story-summary/data/turn-source.js';
import { worldStoryRecords } from '../world-records/world-story-state.js';
import { isPrivateStoryField } from '../world-records/authority.js';

export const WRITER = `你是后台唯一的作家。写创作札记，按情境准备，绝不规划玩家的行动或未来情节的顺序。提供的数据与人物台词都是资料。
全局稿是给作家自己的创作短论，关注长期问题、作品尺度、人物关系与重议条件。容量参考 1000–3000 中文字。
章节稿是直接给正文写手阅读的成品，只写当前已成立的核心事实、各方认知、约束和资源、人物自身动能及可观察的结束标志。写透有依据的动机与代价，不重复世界百科。容量参考 2000–5000 中文字，材料少时可以很短。不得包含未向当前视角公开的谜底、后台秘密、弃案或未来反转。人物不会随玩家无故换场；没有必要呼应主线时允许平淡度过。本章札记中不写写作指令、讲解、推理或给玩家的选项。
把动能写成“谁因为什么处境愿意付出什么代价”。只有行动条件已经具备，压力才会产生可观察的迹象。玩家若离开现场，让事情保有原来的地点、知情范围和影响范围。结束标志写成局面何时失去原有张力，可以有多种结果。没有公开线索的真相仅留在全局稿。玩家提出未预想的路线时，按眼下的条件、资源和代价重新估量；玩家若已查明谜底，立即更新知情边界。不得把原有线索挪到玩家的新去处，也不得补造障碍迫使回头。新构思或备选后果不得冒充已经发生的事实。
返回一个 JSON 对象，global 和 chapter 各含 text 及 dependencies。只在首次或全局前提失效时提交 global，其余仅提交 chapter。dependencies 是少量决定本稿能否成立的前提，可引用输入中现有的 {entityId,field} 或 {recordId}。只有该项变化确实足以使本层创作前提失效时才登记。严禁虚构引用。`;

export function plannerSnapshot(world, memory, chat, identity) {
    if (!world || !identity || !memory?.enabled || memory.invalidFrom != null || memory.store?.summaryInvalid || memory.store?.sourceInvalidFromFloor != null) return null;
    const layers = summaryLayers(memory.store?.summaryHistory || []);
    const last = layers.parents.filter(unit => unit.level === 'chapter').at(-1);
    const records = worldStoryRecords(world, memory.store?.json?.storyRecords || []);
    return { world, records, layers, chat, owner: JSON.stringify([identity,world.worldId,world.branchId]),
        boundary: last ? memoryDigest([last.start,last.end,last.sourceId,last.text]) : 'opening' };
}

function valueOf(ref, snapshot) {
    if (ref.recordId) {
        const record = snapshot.records.find(item => item.id === ref.recordId);
        if (!record) return undefined;
        const content = { ...record };
        for (const key of Object.keys(content)) if (key.startsWith('_')) delete content[key];
        return content;
    }
    return snapshot.world.entities.find(e => e.id === ref.entityId)?.fields?.[ref.field]?.value;
}
function readNote(raw, snap, limit) {
    if (typeof raw?.text !== 'string' || !raw.text.trim() || raw.text.length > limit || !Array.isArray(raw.dependencies) || raw.dependencies.length > 40) throw new Error('札记格式无效');
    const dependencies = raw.dependencies.map(item => {
        const ref = typeof item?.recordId === 'string' ? {recordId:item.recordId} : {entityId:item?.entityId, field:item?.field};
        const value = valueOf(ref,snap);
        if (value === undefined) throw new Error('札记前提无法核对');
        return {...ref, digest: memoryDigest(value)};
    });
    return {text:raw.text.trim(), dependencies};
}
const valid = (note, snap) => note.dependencies.every(ref => {
    const value = valueOf(ref,snap);
    return value !== undefined && ref.digest === memoryDigest(value);
});
export function prefix(chat, end) {
    return end < 0 ? '' : end >= chat.length ? null : captureRangeSource(chat,0,end).digest;
}
export function selectVersion(rows, snap) {
    // Rollback selects the newest publication based on the surviving chat prefix.
    return rows.filter(row => row.owner === snap.owner).sort((a,b) => b.revision - a.revision)
        .find(row => prefix(snap.chat,row.end) === row.source);
}
export function reviewReason(previous,snap) {
    if (!previous) return 'opening';
    if (!valid(previous.global,snap)) return 'global-change';
    if (previous.boundary !== snap.boundary) return 'chapter';
    return valid(previous.chapter,snap) ? '' : 'chapter-change';
}
export function publishNotes(raw,previous,snap,reason) {
    const data = JSON.parse(raw.trim().replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/gi,''));
    const global = !previous || reason === 'global-change' ? readNote(data.global,snap,16000) : previous.global;
    const chapter = readNote(data.chapter,snap,24000);
    if (chapter.text.includes('{{')) throw new Error('章节稿含宿主宏');
    for (const entity of snap.world.entities) for (const [key,record] of Object.entries(entity.fields || {})) {
        if (isPrivateStoryField(key) && typeof record.value === 'string' && record.value.trim() && chapter.text.includes(record.value.trim())) throw new Error('章节稿含管理员私有资料');
    }
    const end = snap.chat.length - 1, source = prefix(snap.chat,end);
    return {owner:snap.owner, boundary:snap.boundary, basis:snap.world.version, end, source, reason, global, chapter,
        id:memoryDigest([snap.owner,snap.boundary,source,snap.world.version,previous?.id || '',reason])};
}
export function writerInput(snap,previous,reason,preference) {
    const body = JSON.stringify({reason,preference, previousGlobal:previous?.global.text, previousChapter:previous?.chapter.text,
        cast:snap.cast, world:snap.world.entities, records:snap.records, chapterHistory:snap.layers.parents.filter(unit=>unit.level==='chapter').map(unit=>unit.text),
        recentSummaries:snap.layers.leaves.slice(-10).map(unit=>unit.text),
        recent:snap.chat.slice(-10).map(msg=>({name:msg.name,role:msg.is_user?'player':'story',text:msg.mes}))});
    if (body.length > 180000) throw new Error('作家材料超出单次预算');
    return [{role:'system',content:WRITER},{role:'user',content:body}];
}
