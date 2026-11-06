import { memoryDigest } from './memory-policy.js';

const optionalEntries = `先写事情的经过和结果。需要补充时，在同一段总结文本末尾用“【词条名】内容”的形式写短句。只列有材料依据、能补充正文的项，略去空项和重复信息。
【环境氛围】留一个能辨认场面或影响行动的外部细节，如门外的脚步声让交谈中断。
【情感氛围】用一两个短语直接点出这一幕是什么感觉。可以写笼罩全场的气氛，如“风暴来临前的压抑”；也可以写人物切身的感受，如“肾上腺素的震颤”或“终于能喘口气的轻松”。从材料的语气、节奏和反应里选贴切的词，强弱随场景。若不同人物的感受形成反差，点明各是谁。
【关键互动】记下人物之间值得记住的一刻，写清谁对谁说了什么或做了什么。替对方拂去眼泪、突然的拥抱、隔着人群投来的阴森凝视，都可以单独成条。对方的反应若有分量且来源写明，可接在同一句里。动作的含义留给材料交代。涉及关键措辞时按来源逐字短引，只有大意时用间接引语。
【叙事意义】只在出现重要转折时写。用一句有戏剧感的短句，直说人物或局面在这里起了什么变化。旧侣说开误会、决定重新在一起，可写“二人于此解开心结，破镜重圆”；若他们此刻只是肯开口，就写“冷战多日，两人终于肯把话说开”。同样的笔法也适用于谜底揭晓、阵营决裂或人物作出抉择。用词落在材料已证实的转折上，略去对作者意图和未来走向的猜测。`;

export const LAYER_PROMPTS = Object.freeze({
    round: `summary 供下一轮接戏。通常用一两句写清谁采取了什么行动、对谁或什么产生影响，以及回复结束时事情停在哪里。一轮里有几件独立进展时可以分句，按发生顺序写。对话、失败或日常相处也可有进展：保留新透露的信息、被拒绝的请求、改变的称呼或约好的下一步，不强凑转折。

${optionalEntries}
本轮词条写入 summary 字符串。优先留下一轮接戏会用到的语气、原话或现场细节。

以本轮正文为依据。旧摘要和世界快照用于辨认人物、物品与既有状态，已登记的交付或扣款不要再记成本轮新进展。区分提出、答应、开始、受阻和完成。传闻写明谁告诉谁，推测写明谁凭什么这样想。时间、数量、称谓和原话只保留正文支持的精度；没有出现在正文里的秘密不要补进摘要。`,
    stage: `只用所列连续摘要，把这段经历写成一段能解释“局面怎样走到这里”的经过。先找出贯穿本段的目标、难题或关系变化，再选出改变其走向的行动和决定，落到阶段末实际达到的状态。并行发生的事分开交代；材料只给了先后顺序时，不替它们补上因果。

压缩时，把条件留在它所约束的行动或后果旁边。保留会影响判断的期限、数量、否定、例外和适用对象。两次约定分别说明谁承诺什么；后一次明确撤回或替换前一次时才写成变更。保留消息的来源与可信程度：亲见、转述、猜测和得到证实是不同进展，后来的揭晓也不改变人物当时所知。

${optionalEntries}
从所列摘要中挑出贯穿本阶段的氛围、情感转折，或最能看出人物关系变化、解释某个决定的一次互动。叙事意义可写一条零散线索如何在本段得到证实。相同细节合并一次。

区分意图、尝试、满足前提和最终完成。例如，守卫答应见手令才放人，主角后来取得手令，只能说明放人的前提已具备；材料写到囚犯获释，才记放人完成。此例仅示范判断方法。删减时先合并重复交涉与过程动作，留下决定性的证据、付出的代价、关系变化和仍牵动后续的悬念。阶段可以在局部目标达成时结束，更大的任务按实际进度保留。`,
    chapter: `把所列阶段融合成供下一章接写的回顾。用材料中能确认的起点交代人物面临的处境或目标，沿主线选择真正改变方向的转折。写清是谁在什么约束下作了选择、这一选择带来了什么结果。支线只有在改变主线、人物关系或章末处境时才展开。跨阶段重复出现的同一件事写一次，保留它从首次发生到最终变化的轨迹。

到章末，区分已经解决、暂时平息和仍在持续的事。选出会限制下一步行动的具体后果，例如伤势限制了什么、谁欠谁什么、哪项承诺尚有期限，或一次结盟附带什么条件。手续已结束且再无影响时可省去；代价仍在生效时，保留造成它的关键选择。用行动和约定写关系变化，不凭一时合作断定双方已经和解。

${optionalEntries}
只取阶段总结中能解释主线转折或章末处境的互动。例如，一句承诺到章末仍约束着人物，就保留它的说话人、对象和条件；一次当众伸手相救改变了双方的立场，也可以留下这个动作。若这次互动已在回顾中交代清楚，词条可省。

若后续取决于知情差异，把已揭晓的事实和人物各自掌握的线索交代清楚。同一条线索，有人亲见，有人听闻，也可能有人仍相信先前的说法。只有材料确立某人被隐瞒、误信或尚未获知时才写出；资料没有提到某人，不足以断定其不知情。最后停在章末已有的事实、未解问题或已约定的行动。篇幅随材料取舍，不为凑齐项目而推测人物内心、预告答案或续写下一章。`,
});
export function timelineRounds(store) {
    const rounds = (store?.json?.importedRounds || []).map((row, i) => ({ ...row, id: 'unbound-' + i, _addedAt: null }));
    for (const batch of reviewedRounds(store?.summaryHistory)) {
        rounds.push(...(batch.importedRounds || []).map((row, i) => ({ ...row, id: 'import-' + batch.endMesId + '-' + i, _addedAt: batch.endMesId })));
        if (!batch.summary) continue;
        const start = batch.sourceReceipt?.source.start ?? batch.roundSource?.start ?? batch.floorEntry?.source.start ?? (batch.previousEndMesId ?? -1) + 1;
        const end = batch.endMesId;
        const source = batch.sourceReceipt?.source || batch.roundSource;
        rounds.push({ id: 'round-' + end, _addedAt: end, version: batch.roundVersion || 0,
            ...(source && { origin: { start: source.start, end: source.end, digest: source.digest } }), title: '本轮总结', timeLabel: batch.kind === 'baseline' ? '旧档汇总' :
            '#' + (start + 1) + (start < end ? '–' + (end + 1) : ''), summary: batch.summary,
            ...(batch.memoryTags && { memoryTags: batch.memoryTags }),
            participants: batch.memoryTags?.characters || [], memoryRole: '本轮总结' });
    }
    return rounds;
}

export function layerSignature(children) {
    return memoryDigest(children.map(({ start, end, text, sourceId }) => [start, end, text, sourceId]));
}

// Both older fixed-size groups and reviewed closures refer to their exact children.
export function roundSourceId(batch) {
    return batch.sourceReceipt?.id || (batch.roundSource && 'round:' + batch.roundSource.digest);
}

export function reviewedRounds(history = [], staged = []) {
    const notes = new Map();
    for (const batch of history) {
        for (const { end, note } of [...(batch.legacyRoundBase || []), ...(batch.legacyRoundChanges || [])]) {
            if (note) notes.set(end, note); else notes.delete(end);
        }
    }
    const revisions = history.flatMap(batch => batch.roundRevisions || []).concat(staged);
    const bySource = new Map();
    for (const revision of revisions) {
        const list = bySource.get(revision.sourceId) || [];
        list.push(revision);
        bySource.set(revision.sourceId, list);
    }
    return history.map(batch => {
        if (batch.floorEntry?.omitted || batch.floorEntry?.deleted) return { ...batch, summary: '' };
        let summary = batch.summary || batch.floorEntry?.payload?.summary || '';
        const note = notes.get(batch.endMesId);
        let memoryTags = batch.memoryTags;
        let roundVersion = batch.roundVersion || 0;
        if (note) {
            summary = [summary, ...note.lines.filter(line => !summary.includes(line))].filter(Boolean).join('\n');
            memoryTags = { version: 1, keywords: [], ...memoryTags };
            for (const field of ['characters', 'locations', 'times']) memoryTags[field] = [...new Set([...(memoryTags[field] || []), ...note[field]])];
        }
        for (const change of bySource.get(roundSourceId(batch)) || []) {
            if (change.end === batch.endMesId && change.baseVersion === roundVersion && change.previous === summary) {
                summary = change.text;
                if (change.memoryTags) memoryTags = change.memoryTags;
                roundVersion++;
            }
        }
        return summary === batch.summary && !note && roundVersion === (batch.roundVersion || 0) ? batch : { ...batch, summary, memoryTags, roundVersion };
    });
}

export function summaryLayers(history = [], staged = []) {
    const leaves = [], records = [], parents = [];
    for (const batch of reviewedRounds(history)) {
        if (roundSourceId(batch) && batch.summary && !batch.floorEntry?.omitted) leaves.push({
            start: (batch.sourceReceipt?.source || batch.roundSource).start, end: batch.endMesId, text: batch.summary, sourceId: roundSourceId(batch), version: batch.roundVersion || 0, memoryTags: batch.memoryTags,
        });
        for (const level of ['stage', 'chapter']) if (batch.layers?.[level]) records.push({ ...batch.layers[level], level });
        records.push(...(batch.reviewLayers || []));
    }
    records.push(...staged);
    let children = leaves;
    for (const level of ['stage', 'chapter']) {
        const valid = [], positions = new Map(children.map((child, i) => [child.start, i]));
        for (const node of records.filter(n => n.level === level).sort((a, b) => a.start - b.start)) {
            if (!positions.has(node.start) || valid.at(-1)?.end >= node.start || !node.text?.trim()) continue;
            const group = [];
            for (let i = positions.get(node.start); i < children.length && children[i].end <= node.end; i++) {
                if (group.length && children[i].start !== group.at(-1).end + 1) break;
                group.push(children[i]);
            }
            if (group.at(-1)?.end === node.end && layerSignature(group) === node.sourceId) valid.push(node);
        }
        parents.push(...valid);
        children = valid;
    }
    return { parents, leaves };
}

export function projectLayers(items, parents, end = Infinity) {
    const selected = parents.filter(n => n.end <= end).sort((a, b) => a.start - b.start || b.end - a.end);
    const result = [];
    for (const node of selected) if (!result.length || result.at(-1).end < node.start) result.push(node);
    let index = 0;
    const remaining = items.filter(item => {
        while (result[index]?.end < item.start) index++;
        return !result[index] || item.start < result[index].start || item.end > result[index].end;
    });
    return [...remaining, ...result].sort((a, b) => a.start - b.start || a.end - b.end);
}
