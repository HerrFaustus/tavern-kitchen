import { definePanelPrompt, panelEnabled } from '../../core/panel-policy.js';
import { reviewedRounds } from '../story-summary/data/summary-layers.js';

const instructions = definePanelPrompt('clues', 'plotLines', '剧情线提取', `只从本轮新材料提取有进展或有具体迹象的剧情线。另在返回 JSON 的顶层写 plotLines 数组，无则留空。每项含 title、status、reading、quote。title 用稳定短名，同一条线沿用旧名。status 取 active（已有行动或明确冲突）、potential（有迹象但联系还未证实）或 closed（已有收束依据）。reading 写清各方正在做什么，或哪两件事可能有关；猜测必须明说尚未证实。quote 必须逐字摘自本轮 summary，以其中已发生的事实作为依据。不要预测结局、给玩家派任务或把可能性写进事实总结。最多八条。已有剧情线（沿用标题，参考上次读法）：{{titles}}`);

export function plotLinePrompt(history, records) {
    if (!panelEnabled('clues')) return '';
    const titles = collectPlotLines(history, records).slice(0, 40).map(({title,status,reading}) => [title,status,reading.slice(0, 160)]);
    return instructions({ titles: JSON.stringify(titles) });
}

export function readPlotLines(rows, summary) {
    if (!Array.isArray(rows) || typeof summary !== 'string') return [];
    return rows.slice(0, 8).filter(row => row && ['active','potential','closed'].includes(row.status)
        && [row.title,row.reading,row.quote].every(value => typeof value === 'string' && value.trim())
        && row.title.length <= 100 && row.reading.length <= 800 && row.quote.length <= 500 && summary.includes(row.quote))
        .map(({ title,status,reading,quote }) => ({ title:title.trim(), status, reading:reading.trim(), quote }));
}

export function collectPlotLines(history = [], records = []) {
    const lines = new Map();
    // Existing chats already record concrete projects, unresolved questions and ongoing conflicts.
    for (const record of records) {
        if (!['plan','suspense','situation'].includes(record.kind) || record.flavor === 'scenery' || !record.title || !record.description) continue;
        const status = record.status !== 'open' ? 'closed' : record.kind === 'suspense' ? 'potential' : 'active';
        lines.set(record.title, { title:record.title, status, reading:record.reason || record.description,
            quote:record.description, floor:record._addedAt, recordId:record.id });
    }
    for (const round of reviewedRounds(history)) {
        for (const row of readPlotLines(round.plotLines, round.summary)) {
            const prior = lines.get(row.title);
            // A later resolution in the structured records supersedes an older round.
            if (prior?.floor > round.endMesId) continue;
            lines.set(row.title, { ...row, floor:round.endMesId });
        }
    }
    return [...lines.values()].sort((a,b) => (b.floor ?? -1) - (a.floor ?? -1));
}
