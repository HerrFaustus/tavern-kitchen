export const timelineLabels = { chapter: '章节总结', stage: '篇目总结', round: '本轮总结' };

// The host has already checked the parent signatures. Imported rounds can
// carry ranges from a different chat; only local, sourced rounds are children.
export function buildTimelineTree(rounds, units) {
    const roots = [];
    const groups = units.map(unit => ({ ...unit, id: unit.level + '-' + unit.start + '-' + unit.end, children: [] }));
    const stages = groups.filter(node => node.level === 'stage').sort((a, b) => a.start - b.start);
    const chapters = groups.filter(node => node.level === 'chapter').sort((a, b) => a.start - b.start);
    function attach(nodes, parents) {
        let i = 0;
        for (const node of nodes) {
            while (i < parents.length && parents[i].end < node.start) i++;
            const parent = parents[i];
            if (parent && parent.start <= node.start && node.end <= parent.end) parent.children.push(node);
            else roots.push(node);
        }
    }
    const local = [];
    rounds.forEach((round, index) => {
        const node = { level: 'round', round, index, start: round._addedAt ?? -1, end: round._addedAt ?? -1 };
        if (round.origin && round.id === 'round-' + round._addedAt) {
            node.start = round.origin.start;
            local.push(node);
        } else roots.push(node);
    });
    attach(local.sort((a, b) => a.start - b.start), stages);
    attach(stages, chapters);
    return roots.concat(chapters).sort((a, b) => a.end - b.end);
}

export function selectTimelineTree(nodes, { level, query, descending }, includeBranch = false) {
    const selected = [];
    for (const node of nodes) {
        const round = node.round;
        const match = (!level || node.level === level) && (!query || matchesQuery(node, query));
        if (round) {
            if (match || includeBranch) selected.push(node);
            continue;
        }
        const children = selectTimelineTree(node.children, { level, query, descending }, includeBranch || match);
        if (includeBranch || match || children.length) selected.push({ ...node, children,
            reveal: !!(level || query) && !includeBranch && !match && children.length > 0 });
    }
    return descending ? selected.reverse() : selected;
}

function matchesQuery(node, query) {
    const round = node.round;
    const values = round
        ? [round.title, round.summary, round.timeLabel, ...(round.participants || []), ...Object.values(round.memoryTags || {}).flat()]
        : [node.text, node.reason, node.evidence?.quote, '第 ' + (node.start + 1) + '–' + (node.end + 1) + ' 楼'];
    return [timelineLabels[node.level], ...values].join(' ').toLocaleLowerCase().includes(query);
}
