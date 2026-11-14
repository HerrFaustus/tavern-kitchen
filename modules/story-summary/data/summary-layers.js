import { memoryDigest } from './memory-policy.js';
import { isRangeSourceCurrent } from './turn-source.js';

export const DEFAULT_LEAF_KEEP_RECENT = 3;

export function layerDepth(level) {
    if (level === 0 || level === 'round') return 0;
    if (level === 1 || level === 'stage') return 1;
    if (level === 2 || level === 'chapter') return 2;
    if (typeof level === 'number' && Number.isInteger(level) && level > 0) return level;
    const match = typeof level === 'string' && level.trim().match(/^L?(\d+)$/i);
    if (match) {
        const parsed = Number(match[1]);
        if (Number.isInteger(parsed) && parsed > 0) return parsed;
    }
    return 1;
}

export function layerLevelName(depth) {
    if (depth <= 0) return 'round';
    if (depth === 1) return 'stage';
    if (depth === 2) return 'chapter';
    return 'L' + depth;
}

// Progressive thresholds adapted from BaiBaiBook:
// keep L0 leaves abundant (12+3 recent kept uncompressed) before rolling into L1,
// roll 6 L1 stages into L2, and 3 upper nodes into L3+ recursively.
export function thresholdForLevel(level) {
    const depth = layerDepth(level);
    if (depth <= 0) return 12;
    if (depth === 1) return 6;
    return 3;
}

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
        let plotLines = batch.plotLines;
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
                if (change.plotLines) plotLines = change.plotLines;
                roundVersion++;
            }
        }
        return summary === batch.summary && !note && roundVersion === (batch.roundVersion || 0)
            ? batch
            : { ...batch, summary, memoryTags, ...(plotLines !== undefined && { plotLines }), roundVersion };
    });
}

function summarizeSnapshotSteps(steps, explicitSummary, status, reading) {
    if (explicitSummary && (steps.length <= 1 || explicitSummary !== reading)) return explicitSummary;
    if (steps.length <= 1) return steps[0] || reading;
    const head = steps[0];
    const tail = steps.at(-1);
    const tailLabel = status === 'closed' ? '收束' : '当前';
    const middle = steps.slice(1, -1);
    const join = kept => [`起初：${head}`, ...(kept.length ? [`推进：${kept.join('；')}`] : []), `${tailLabel}：${tail}`].join('；');
    while (middle.length && join(middle).length > 800) middle.shift();
    const compact = join(middle);
    return compact.length <= 800 ? compact : `起初：${head.slice(0, 260)}；${tailLabel}：${tail.slice(0, 500)}`;
}

/** Merges validated round plotLines or lower-level plotLineSnapshots across ordered child nodes. */
export function mergePlotLineSnapshots(children = []) {
    const lines = new Map();
    const ensure = title => {
        if (!lines.has(title)) {
            lines.set(title, {
                title,
                status: 'potential',
                reading: '',
                explicitSummary: '',
                nextFocus: '',
                characters: new Set(),
                situationIds: new Set(),
                steps: [],
                firstFloor: undefined,
                floor: undefined,
                beatCount: 0,
            });
        }
        return lines.get(title);
    };
    const ordered = [...children].sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || (a.end ?? 0) - (b.end ?? 0));
    for (const child of ordered) {
        if (!child) continue;
        if (Array.isArray(child.plotLineSnapshots) && child.plotLineSnapshots.length) {
            const items = [...child.plotLineSnapshots].sort((a, b) => (a.floor ?? -1) - (b.floor ?? -1));
            for (const snap of items) {
                if (!snap?.title || !['active', 'potential', 'closed'].includes(snap.status)) continue;
                const reading = String(snap.reading || snap.summary || '').trim();
                if (!reading) continue;
                const entry = ensure(String(snap.title).trim());
                const snapFirst = Number.isInteger(snap.firstFloor) ? snap.firstFloor : (Number.isInteger(snap.floor) ? snap.floor : child.start);
                const snapFloor = Number.isInteger(snap.floor) ? snap.floor : child.end;
                if (Number.isInteger(snapFirst)) entry.firstFloor = entry.firstFloor === undefined ? snapFirst : Math.min(entry.firstFloor, snapFirst);
                if (Number.isInteger(snapFloor)) entry.floor = entry.floor === undefined ? snapFloor : Math.max(entry.floor, snapFloor);
                entry.status = snap.status;
                entry.reading = reading;
                if (snap.summary) entry.explicitSummary = String(snap.summary).trim();
                if (snap.status === 'closed') entry.nextFocus = '';
                else if (snap.nextFocus) entry.nextFocus = String(snap.nextFocus).trim();
                for (const name of snap.characters || []) if (typeof name === 'string' && name.trim()) entry.characters.add(name.trim());
                for (const id of snap.situationIds || []) if (typeof id === 'string' && id.trim()) entry.situationIds.add(id.trim());
                if (entry.steps.at(-1) !== reading) entry.steps.push(reading);
                entry.beatCount += Number.isInteger(snap.beatCount) && snap.beatCount > 0 ? snap.beatCount : 1;
            }
            continue;
        }
        const leafText = typeof child.text === 'string' ? child.text : '';
        for (const row of child.plotLines || []) {
            if (!row || !['active', 'potential', 'closed'].includes(row.status)) continue;
            const title = typeof row.title === 'string' ? row.title.trim() : '';
            const reading = typeof row.reading === 'string' ? row.reading.trim() : '';
            const quote = typeof row.quote === 'string' ? row.quote : '';
            if (!title || !reading || !quote.trim() || (leafText && !leafText.includes(quote))) continue;
            const entry = ensure(title);
            const floor = Number.isInteger(child.end) ? child.end : undefined;
            if (Number.isInteger(floor)) {
                entry.firstFloor = entry.firstFloor === undefined ? floor : Math.min(entry.firstFloor, floor);
                entry.floor = entry.floor === undefined ? floor : Math.max(entry.floor, floor);
            }
            entry.status = row.status;
            entry.reading = reading;
            if (typeof row.summary === 'string' && row.summary.trim()) entry.explicitSummary = row.summary.trim();
            if (row.status === 'closed') entry.nextFocus = '';
            else if (typeof row.nextFocus === 'string' && row.nextFocus.trim()) entry.nextFocus = row.nextFocus.trim();
            for (const name of row.characters || []) if (typeof name === 'string' && name.trim()) entry.characters.add(name.trim());
            for (const id of row.situationIds || []) if (typeof id === 'string' && id.trim()) entry.situationIds.add(id.trim());
            if (entry.steps.at(-1) !== reading) entry.steps.push(reading);
            entry.beatCount += 1;
        }
    }
    return [...lines.values()].map(entry => ({
        title: entry.title,
        status: entry.status,
        reading: entry.reading,
        summary: summarizeSnapshotSteps(entry.steps, entry.explicitSummary, entry.status, entry.reading),
        beatCount: entry.beatCount,
        ...(entry.firstFloor !== undefined && { firstFloor: entry.firstFloor }),
        ...(entry.floor !== undefined && { floor: entry.floor }),
        ...(entry.characters.size && { characters: [...entry.characters].slice(0, 12) }),
        ...(entry.situationIds.size && { situationIds: [...entry.situationIds].slice(0, 8) }),
        ...(entry.nextFocus && { nextFocus: entry.nextFocus }),
    })).sort((a, b) => (b.floor ?? -1) - (a.floor ?? -1));
}

function collectBatchLayerNodes(batch) {
    const out = [];
    if (batch.layers && typeof batch.layers === 'object') {
        for (const [key, value] of Object.entries(batch.layers)) {
            if (value) out.push({ ...value, level: value.level || key });
        }
    }
    if (Array.isArray(batch.reviewLayers)) out.push(...batch.reviewLayers);
    if (Array.isArray(batch.compressionNodes)) out.push(...batch.compressionNodes);
    return out;
}

function resolveBatchTimeBounds(batch, start, end) {
    const importedTimes = (batch.importedRounds || []).map(row => row.timeLabel).filter(Boolean);
    const fallbackTime = batch.storyTime || batch.memoryTags?.times?.at(-1) || importedTimes.at(-1) || '';
    const timeStart = String(batch.timeStart || batch.storyTimeStart || importedTimes[0] || fallbackTime || '').trim();
    const timeEnd = String(batch.timeEnd || batch.storyTimeEnd || fallbackTime || '').trim();
    return {
        timeStart,
        timeEnd,
        storyTime: String(batch.storyTime || timeEnd || timeStart || '').trim(),
        timeLabel: batch.kind === 'baseline' ? '旧档汇总' : '#' + (start + 1) + (start < end ? '–' + (end + 1) : ''),
    };
}

export function summaryLayers(history = [], staged = [], { chat = null, isLeafCurrent = null } = {}) {
    const leaves = [], records = [], parents = [];
    for (const batch of reviewedRounds(history)) {
        const source = batch.sourceReceipt?.source || batch.roundSource;
        const leafCurrent = !chat
            || ((!source || isRangeSourceCurrent(source, chat)) && (!isLeafCurrent || isLeafCurrent(batch, chat)));
        if (roundSourceId(batch) && batch.summary && !batch.floorEntry?.omitted && !batch.floorEntry?.deleted && leafCurrent) {
            const start = source?.start ?? batch.floorEntry?.source?.start ?? (batch.previousEndMesId ?? -1) + 1;
            const end = batch.endMesId;
            const id = roundSourceId(batch);
            leaves.push({
                id,
                kind: 'leaf',
                level: 'round',
                depth: 0,
                start,
                end,
                text: batch.summary,
                sourceId: id,
                version: batch.roundVersion || 0,
                memoryTags: batch.memoryTags,
                ...(batch.plotLines?.length && { plotLines: batch.plotLines }),
                childIds: [],
                ...resolveBatchTimeBounds(batch, start, end),
            });
        }
        records.push(...collectBatchLayerNodes(batch));
    }
    records.push(...staged);

    const byId = new Map(leaves.map(leaf => [leaf.id, leaf]));
    const referencedIds = new Set();
    const maxDepth = records.reduce((max, node) => Math.max(max, layerDepth(node?.level)), 2);

    let children = leaves;
    for (let depth = 1; depth <= maxDepth; depth++) {
        const valid = [];
        const validRefs = [];
        const positions = new Map(children.map((child, i) => [child.start, i]));
        const candidates = records
            .filter(node => node && layerDepth(node.level) === depth && node.text?.trim())
            .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

        for (const node of candidates) {
            let group = null;
            if (Array.isArray(node.childIds) && node.childIds.length) {
                const resolved = node.childIds.map(cid => byId.get(cid));
                if (resolved.every(Boolean)) {
                    const sorted = [...resolved].sort((a, b) => a.start - b.start);
                    const nonOverlapping = sorted.every((item, idx) => idx === 0 || item.start > sorted[idx - 1].end);
                    const lowerDepth = sorted.every(item => (item.depth ?? layerDepth(item.level)) < depth);
                    if (nonOverlapping && lowerDepth && (!node.sourceId || layerSignature(sorted) === node.sourceId)) {
                        group = sorted;
                    }
                }
            } else {
                if (!positions.has(node.start) || valid.at(-1)?.end >= node.start) continue;
                const span = [];
                for (let i = positions.get(node.start); i < children.length && children[i].end <= node.end; i++) {
                    if (span.length && children[i].start !== span.at(-1).end + 1) break;
                    span.push(children[i]);
                }
                if (span.at(-1)?.end === node.end && layerSignature(span) === node.sourceId) group = span;
            }
            if (!group?.length) continue;

            const start = node.start ?? group[0].start;
            const end = node.end ?? group.at(-1).end;
            if (valid.at(-1)?.end >= start) continue;

            const levelName = node.level || layerLevelName(depth);
            const id = node.id || `${levelName}:${start}-${end}`;
            const childIds = group.map(child => child.id);
            const timeStart = node.timeStart || group[0]?.timeStart || '';
            const timeEnd = node.timeEnd || group.at(-1)?.timeEnd || '';
            const plotLineSnapshots = Array.isArray(node.plotLineSnapshots) && node.plotLineSnapshots.length
                ? node.plotLineSnapshots
                : mergePlotLineSnapshots(group);
            const normalized = {
                ...node,
                id,
                kind: 'comp',
                level: levelName,
                depth,
                start,
                end,
                sourceId: node.sourceId || layerSignature(group),
                childIds,
                timeStart,
                timeEnd,
                storyTime: node.storyTime || timeEnd || timeStart || '',
                ...(plotLineSnapshots.length && { plotLineSnapshots }),
            };
            valid.push(normalized);
            // Preserve exact original object references in `parents` so validateStagedUnits (`parents.includes(unit)`) keeps matching.
            validRefs.push(node);
            byId.set(id, normalized);
            for (const cid of childIds) referencedIds.add(cid);
        }
        parents.push(...validRefs);
        children = valid;
    }

    const roots = [...byId.values()].filter(node => !referencedIds.has(node.id));
    return { parents, leaves, byId, roots };
}

export function selectViewNodes(view, leafEligible = () => true) {
    const byId = view?.byId || new Map();
    const roots = view?.roots || [];

    const collectLeaves = (node, acc) => {
        if (node.kind === 'leaf' || node.atomic) {
            acc.push(node);
            return;
        }
        for (const cid of node.childIds || []) {
            const child = byId.get(cid);
            if (child) collectLeaves(child, acc);
        }
    };

    const intactMemo = new Map();
    const isIntact = node => {
        if (node.kind === 'leaf' || node.atomic) return true;
        if (intactMemo.has(node.id)) return intactMemo.get(node.id);
        intactMemo.set(node.id, false);
        const childIds = node.childIds || [];
        let ok = childIds.length > 0;
        for (const cid of childIds) {
            const child = byId.get(cid);
            if (!child || !isIntact(child)) {
                ok = false;
                break;
            }
        }
        intactMemo.set(node.id, ok);
        return ok;
    };

    const canRepresent = node => {
        if (!isIntact(node)) return false;
        const descendants = [];
        collectLeaves(node, descendants);
        return descendants.length > 0 && descendants.every(leafEligible);
    };

    const chosen = [];
    const visited = new Set();
    const visit = node => {
        if (!node || visited.has(node.id)) return;
        visited.add(node.id);
        if (node.kind === 'leaf' || node.atomic) {
            if (leafEligible(node)) chosen.push(node);
            return;
        }
        if (canRepresent(node)) {
            chosen.push(node);
            return;
        }
        for (const cid of node.childIds || []) {
            const child = byId.get(cid);
            if (child) visit(child);
        }
    };

    for (const root of roots) visit(root);
    return chosen.sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || (a.end ?? 0) - (b.end ?? 0));
}

export function selectInjectionNodes(history = [], chat = null, hiddenThrough = Infinity, { staged = [], isLeafCurrent = null } = {}) {
    const view = summaryLayers(history, staged, { chat, isLeafCurrent });
    return selectViewNodes(view, leaf => leaf.end <= hiddenThrough);
}

export function selectHistoryNodesBefore(history = [], chat = null, beforeIndex = Infinity, { staged = [], isLeafCurrent = null } = {}) {
    const view = summaryLayers(history, staged, { chat, isLeafCurrent });
    return selectViewNodes(view, leaf => leaf.end < beforeIndex);
}

export function rootsAtCompressionLevel(history = [], level = 0, { chat = null, staged = [], isLeafCurrent = null } = {}) {
    const targetDepth = layerDepth(level);
    const { leaves, parents } = summaryLayers(history, staged, { chat, isLeafCurrent });
    const collected = new Set();
    for (const parent of parents) {
        for (const cid of parent.childIds || []) collected.add(cid);
    }
    const pool = targetDepth === 0 ? leaves : parents.filter(node => node.depth === targetDepth);
    return pool
        .filter(node => !collected.has(node.id))
        .sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || (a.end ?? 0) - (b.end ?? 0));
}

export function planNextCompression(history = [], { chat = null, staged = [], isLeafCurrent = null, leafKeepRecent = DEFAULT_LEAF_KEEP_RECENT } = {}) {
    const view = summaryLayers(history, staged, { chat, isLeafCurrent });
    const collected = new Set();
    for (const parent of view.parents) {
        for (const cid of parent.childIds || []) collected.add(cid);
    }
    const maxDepth = view.parents.reduce((max, node) => Math.max(max, node.depth || 1), 0);
    for (let depth = 0; depth <= maxDepth + 1; depth++) {
        const threshold = thresholdForLevel(depth);
        const keep = depth === 0 ? Math.max(0, leafKeepRecent) : 0;
        const pool = depth === 0 ? view.leaves : view.parents.filter(node => node.depth === depth);
        const roots = pool
            .filter(node => !collected.has(node.id))
            .sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || (a.end ?? 0) - (b.end ?? 0));
        if (roots.length < threshold + keep) continue;
        const nodes = roots.slice(0, threshold);
        const targetDepth = depth + 1;
        const targetLevel = layerLevelName(targetDepth);
        const start = nodes[0].start;
        const end = nodes.at(-1).end;
        return {
            depth: targetDepth,
            level: targetLevel,
            sourceLevel: depth,
            nodes,
            start,
            end,
            childIds: nodes.map(node => node.id),
            sourceId: layerSignature(nodes),
            timeStart: nodes[0]?.timeStart || '',
            timeEnd: nodes.at(-1)?.timeEnd || '',
        };
    }
    return null;
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
