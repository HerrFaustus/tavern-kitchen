export function createPlannerSettings(root, { retry, controlsRoot }) {
    const doc = root.ownerDocument;
    const panel = doc.createElement('section');
    panel.className = 'tk-planner-settings';
    const state = doc.createElement('span');
    state.setAttribute('role', 'status');
    const retryButton = doc.createElement('button');
    retryButton.type = 'button';
    retryButton.className = 'menu_button';
    retryButton.textContent = '下次正文重试';
    retryButton.onclick = retry;
    const controls = doc.createElement('footer');
    controls.className = 'tk-module-settings';
    controls.setAttribute('aria-label', '编剧控制');
    controls.append(retryButton);
    panel.append(state);
    (controlsRoot || panel).append(controls);
    root.replaceChildren(panel);
    return (message, canRetry) => {
        state.textContent = message;
        retryButton.hidden = controls.hidden = !canRetry;
    };
}
