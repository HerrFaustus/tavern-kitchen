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

function isTargetStale(staleTargets, groupKey, target) {
    if (!staleTargets || staleTargets.all) return false;
    const list = staleTargets[groupKey];
    return Array.isArray(list) && list.includes(target);
}

function staleSummaryText(staleTargets) {
    if (!staleTargets || staleTargets.all) return '';
    const parts = ENTITY_GROUPS
        .map(([key, label]) => {
            const names = staleTargets[key];
            return Array.isArray(names) && names.length ? `${label}：${names.join('、')}` : '';
        })
        .filter(Boolean);
    return parts.length ? `（涉及：${parts.join('；')}）` : '';
}

function formatChapterPlaintext(chapterLayer) {
    if (chapterLayer?.text) return chapterLayer.text;
    const entities = chapterLayer?.entities;
    if (!entities) return '';
    const sections = [];
    for (const [key, label] of ENTITY_GROUPS) {
        const items = entities[key] || [];
        if (!items.length) continue;
        const lines = [`【${label}】`];
        for (const item of items) {
            const parts = NOTE_PARTS.filter(([field]) => item[field]).map(([field, fieldLabel]) => `${fieldLabel}：${item[field]}`);
            lines.push(parts.length ? `- ${item.target}：${parts.join('；')}` : `- ${item.target}`);
        }
        sections.push(lines.join('\n'));
    }
    return sections.join('\n\n');
}

function renderNoteLayer(doc, container, layer, staleTargets) {
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
            const stale = isTargetStale(staleTargets, key, item.target);
            const card = doc.createElement('article');
            card.className = stale ? 'tk-planner-entity is-stale' : 'tk-planner-entity';
            card.dataset.entityName = item.target || '';
            const name = doc.createElement('div');
            name.className = 'tk-planner-entity-name';
            const nameText = doc.createElement('span');
            nameText.textContent = item.target;
            name.append(nameText);
            if (stale) {
                const badge = doc.createElement('span');
                badge.className = 'tk-planner-tag is-stale';
                badge.textContent = '待更新';
                name.append(badge);
            }
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

export function createPlannerSettings(root, { retry, controlsRoot, clipboard } = {}) {
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
    const toolbar = doc.createElement('div');
    toolbar.className = 'tk-planner-toolbar';
    toolbar.hidden = true;
    const searchInput = doc.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'text_pole tk-planner-search';
    searchInput.placeholder = '筛选实体或关键词…';
    searchInput.setAttribute('aria-label', '筛选实体或关键词');
    const copyButton = doc.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'menu_button tk-planner-copy';
    copyButton.textContent = '复制本章纯文本';
    const copyStatus = doc.createElement('span');
    copyStatus.className = 'tk-planner-copy-status';
    copyStatus.setAttribute('role', 'status');
    toolbar.append(searchInput, copyButton, copyStatus);
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
    panel.append(heading, state, noteStatus, overview, toolbar, note);
    (controlsRoot || panel).append(controls);
    root.replaceChildren(panel);
    let shownId = null;
    let activeGroup = 'all';
    let currentChapterText = '';
    const applyFilter = () => {
        const query = searchInput.value.trim().toLowerCase();
        for (const button of overview.querySelectorAll('.tk-planner-filter')) {
            button.setAttribute('aria-pressed', String(button.dataset.entityFilter === activeGroup));
        }
        for (const layerEl of [chapter, globalText]) {
            for (const groupEl of layerEl.querySelectorAll('.tk-planner-group')) {
                const groupMatches = activeGroup === 'all' || groupEl.dataset.entityGroup === activeGroup;
                let visibleCount = 0;
                for (const card of groupEl.querySelectorAll('.tk-planner-entity')) {
                    const textMatches = !query || (card.textContent || '').toLowerCase().includes(query);
                    const visible = groupMatches && textMatches;
                    card.hidden = !visible;
                    if (visible) visibleCount++;
                }
                groupEl.hidden = visibleCount === 0;
            }
        }
    };
    searchInput.addEventListener('input', applyFilter);
    copyButton.addEventListener('click', async () => {
        if (!currentChapterText) return;
        try {
            const targetClipboard = clipboard || doc.defaultView?.navigator?.clipboard || globalThis.navigator?.clipboard;
            if (!targetClipboard?.writeText) throw new Error('clipboard unavailable');
            await targetClipboard.writeText(currentChapterText);
            copyStatus.textContent = '已复制';
        } catch {
            copyStatus.textContent = '复制失败';
        }
    });
    return {
        status(message, canRetry) {
            state.textContent = message;
            retryButton.hidden = controls.hidden = !canRetry;
        },
        note(result) {
            const saved = result?.note;
            const staleTargets = result?.state === 'stale' ? result?.staleTargets : null;
            if (saved?.id !== shownId) {
                global.open = false;
                activeGroup = 'all';
                searchInput.value = '';
            }
            shownId = saved?.id ?? null;
            note.hidden = !saved;
            copyStatus.textContent = '';
            const chapterCount = renderNoteLayer(doc, chapter, saved?.chapter, staleTargets);
            const globalCount = renderNoteLayer(doc, globalText, saved?.global, staleTargets);
            currentChapterText = formatChapterPlaintext(saved?.chapter);
            const hasGlobal = !!(saved?.global?.text || (saved?.global?.entities && ENTITY_GROUPS.some(([key]) => saved.global.entities[key]?.length)));
            global.hidden = !hasGlobal;
            const summaryCounts = ENTITY_GROUPS
                .map(([key, label]) => [key, label, (saved?.chapter?.entities?.[key]?.length || 0) + (saved?.global?.entities?.[key]?.length || 0)])
                .filter(([, , n]) => n > 0);
            if (activeGroup !== 'all' && !summaryCounts.some(([key]) => key === activeGroup)) activeGroup = 'all';
            overview.replaceChildren();
            if (saved && summaryCounts.length) {
                overview.hidden = false;
                const allBtn = doc.createElement('button');
                allBtn.type = 'button';
                allBtn.className = 'tk-planner-filter';
                allBtn.dataset.entityFilter = 'all';
                allBtn.textContent = '全部';
                allBtn.onclick = () => {
                    activeGroup = 'all';
                    applyFilter();
                };
                overview.append(allBtn);
                for (const [key, label] of summaryCounts) {
                    const chapterN = saved?.chapter?.entities?.[key]?.length || 0;
                    const chip = doc.createElement('button');
                    chip.type = 'button';
                    chip.className = 'tk-planner-stat tk-planner-filter';
                    chip.dataset.entityFilter = key;
                    chip.textContent = `${label} ${chapterN || saved?.global?.entities?.[key]?.length || 0}`;
                    chip.onclick = () => {
                        activeGroup = activeGroup === key ? 'all' : key;
                        applyFilter();
                    };
                    overview.append(chip);
                }
            } else overview.hidden = true;
            const hasStructuredEntities = chapterCount + globalCount > 0;
            toolbar.hidden = !saved || (!hasStructuredEntities && !currentChapterText);
            searchInput.hidden = !hasStructuredEntities;
            copyButton.hidden = !currentChapterText;
            applyFilter();
            const staleDetail = staleSummaryText(staleTargets);
            noteStatus.textContent = result?.state === 'ready'
                ? (saved?.revision ? `已保存 · 第 ${saved.revision} 版` : '已保存')
                : result?.state === 'stale' ? `剧情或世界前提已变化，这份札记需要更新。${staleDetail}`
                    : result?.state === 'empty' ? '暂无札记，编剧将在需要时自动整理。'
                        : result?.state === 'unavailable' ? '请先打开聊天并准备剧情和世界资料。'
                            : result?.state === 'changed' ? '资料已变化，请重新打开编剧面板。'
                                : result?.state === 'error' ? '札记读取失败，请重新打开编剧面板。'
                                    : '正在读取札记…';
        },
    };
}
