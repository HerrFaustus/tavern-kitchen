const ENTITY_GROUPS = [
    ['characters', '人物'],
    ['plotLines', '剧情线'],
    ['situations', '局势'],
];
const NOTE_PARTS = [
    ['commentary', '点评', 'is-commentary'],
    ['prediction', '走向预测', 'is-prediction'],
    ['suggestion', '建议', 'is-suggestion'],
];

function renderNoteLayer(doc, container, layer) {
    container.replaceChildren();
    const entities = layer?.entities;
    const hasEntities = entities && ENTITY_GROUPS.some(([key]) => entities[key]?.length);
    if (!hasEntities) {
        container.textContent = layer?.text || '';
        return 0;
    }
    let count = 0;
    for (const [key, label] of ENTITY_GROUPS) {
        const items = entities[key] || [];
        if (!items.length) continue;
        const group = doc.createElement('section');
        group.className = 'tk-planner-group';
        group.dataset.entityGroup = key;
        const title = doc.createElement('h6');
        title.className = 'standoutHeader tk-planner-group-title';
        title.textContent = `${label}（${items.length}）`;
        group.append(title);
        for (const item of items) {
            count++;
            const card = doc.createElement('article');
            card.className = 'tk-planner-entity';
            const name = doc.createElement('div');
            name.className = 'tk-planner-entity-name';
            name.textContent = item.target;
            card.append(name);
            for (const [field, fieldLabel, badgeClass] of NOTE_PARTS) {
                if (!item[field]) continue;
                const row = doc.createElement('div');
                row.className = 'tk-planner-entity-row';
                const badge = doc.createElement('span');
                badge.className = `tk-planner-tag ${badgeClass}`;
                badge.textContent = fieldLabel;
                const body = doc.createElement('p');
                body.className = 'tk-planner-entity-body';
                body.textContent = item[field];
                row.append(badge, body);
                card.append(row);
            }
            group.append(card);
        }
        container.append(group);
    }
    return count;
}

export function createPlannerSettings(root, { retry, controlsRoot }) {
    const doc = root.ownerDocument;
    const panel = doc.createElement('section');
    panel.className = 'tk-planner-settings';
    const heading = doc.createElement('h4');
    heading.className = 'standoutHeader tk-planner-heading';
    heading.textContent = '当前札记';
    const state = doc.createElement('span');
    state.className = 'tk-planner-live-state';
    state.setAttribute('role', 'status');
    const noteStatus = doc.createElement('p');
    noteStatus.className = 'tk-planner-note-status';
    noteStatus.setAttribute('role', 'status');
    const overview = doc.createElement('div');
    overview.className = 'tk-planner-overview';
    overview.hidden = true;
    const note = doc.createElement('section');
    note.className = 'tk-planner-note';
    note.hidden = true;
    const chapterHeading = doc.createElement('h5');
    chapterHeading.className = 'standoutHeader';
    chapterHeading.textContent = '章节札记';
    const chapter = doc.createElement('div');
    chapter.className = 'tk-planner-note-text tk-planner-chapter';
    const global = doc.createElement('details');
    global.className = 'tk-planner-global inline-drawer';
    const globalHeading = doc.createElement('summary');
    globalHeading.className = 'inline-drawer-toggle inline-drawer-header';
    globalHeading.textContent = '全局札记（可能包含剧透）';
    const globalText = doc.createElement('div');
    globalText.className = 'tk-planner-note-text inline-drawer-content';
    global.append(globalHeading, globalText);
    note.append(chapterHeading, chapter, global);
    const retryButton = doc.createElement('button');
    retryButton.type = 'button';
    retryButton.className = 'menu_button';
    retryButton.textContent = '下次正文重试';
    retryButton.onclick = retry;
    const controls = doc.createElement('footer');
    controls.className = 'tk-module-settings';
    controls.setAttribute('aria-label', '编剧控制');
    controls.append(retryButton);
    panel.append(heading, state, noteStatus, overview, note);
    (controlsRoot || panel).append(controls);
    root.replaceChildren(panel);
    let shownId = null;
    return {
        status(message, canRetry) {
            state.textContent = message;
            retryButton.hidden = controls.hidden = !canRetry;
        },
        note(result) {
            const saved = result?.note;
            if (saved?.id !== shownId) global.open = false;
            shownId = saved?.id ?? null;
            note.hidden = !saved;
            renderNoteLayer(doc, chapter, saved?.chapter);
            renderNoteLayer(doc, globalText, saved?.global);
            const hasGlobal = !!(saved?.global?.text || (saved?.global?.entities && ENTITY_GROUPS.some(([key]) => saved.global.entities[key]?.length)));
            global.hidden = !hasGlobal;
            const summaryCounts = ENTITY_GROUPS.map(([key, label]) => [label, saved?.chapter?.entities?.[key]?.length || 0]).filter(([, n]) => n > 0);
            overview.replaceChildren();
            if (saved && summaryCounts.length) {
                overview.hidden = false;
                for (const [label, n] of summaryCounts) {
                    const chip = doc.createElement('span');
                    chip.className = 'tk-planner-stat';
                    chip.textContent = `${label} ${n}`;
                    overview.append(chip);
                }
            } else overview.hidden = true;
            noteStatus.textContent = result?.state === 'ready'
                ? (saved?.revision ? `已保存 · 第 ${saved.revision} 版` : '已保存')
                : result?.state === 'stale' ? '剧情或世界前提已变化，这份札记需要更新。'
                    : result?.state === 'empty' ? '暂无札记，编剧将在需要时自动整理。'
                        : result?.state === 'unavailable' ? '请先打开聊天并准备剧情和世界资料。'
                            : result?.state === 'changed' ? '资料已变化，请重新打开编剧面板。'
                                : result?.state === 'error' ? '札记读取失败，请重新打开编剧面板。'
                                    : '正在读取札记…';
        },
    };
}
