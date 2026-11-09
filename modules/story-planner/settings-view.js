export function createPlannerSettings(root, { retry, controlsRoot }) {
    const doc = root.ownerDocument;
    const panel = doc.createElement('section');
    panel.className = 'tk-planner-settings';
    const heading = doc.createElement('h4');
    heading.textContent = '当前札记';
    const state = doc.createElement('span');
    state.setAttribute('role', 'status');
    const noteStatus = doc.createElement('p');
    noteStatus.className = 'tk-planner-note-status';
    noteStatus.setAttribute('role', 'status');
    const note = doc.createElement('section');
    note.className = 'tk-planner-note';
    note.hidden = true;
    const chapterHeading = doc.createElement('h5');
    chapterHeading.textContent = '章节札记';
    const chapter = doc.createElement('div');
    chapter.className = 'tk-planner-note-text tk-planner-chapter';
    const global = doc.createElement('details');
    global.className = 'tk-planner-global';
    const globalHeading = doc.createElement('summary');
    globalHeading.textContent = '全局札记（可能包含剧透）';
    const globalText = doc.createElement('div');
    globalText.className = 'tk-planner-note-text';
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
    panel.append(heading, state, noteStatus, note);
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
            chapter.textContent = saved?.chapter?.text || '';
            globalText.textContent = saved?.global?.text || '';
            global.hidden = !saved?.global?.text;
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
