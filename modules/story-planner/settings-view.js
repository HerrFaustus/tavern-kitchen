export function createPlannerSettings(root, { presets, selected, preference, save, retry, apiInHeader = false }) {
    const doc = root.ownerDocument;
    const panel = doc.createElement('section');
    panel.className = 'tk-planner-settings';

    function field(title, control) {
        const label = doc.createElement('label');
        label.append(title, control);
        panel.append(label);
        return control;
    }
    const model = doc.createElement('select');
    if (!apiInHeader) field('后台作家模型',model);
    for (const { name, id } of [{ name: '选择独立模型配置', id: '' }, ...presets]) {
        const option = doc.createElement('option');
        option.value = id;
        option.textContent = name;
        model.append(option);
    }
    model.value = selected || '';

    const pref = field('创作偏好', doc.createElement('textarea'));
    pref.className = 'text_pole textarea_compact';
    pref.rows = 4;
    pref.maxLength = 3000;
    pref.value = preference || '';

    function button(label) {
        const control = doc.createElement('button');
        control.type = 'button';
        control.className = 'menu_button';
        control.textContent = label;
        return control;
    }
    const saveButton = button('保存配置');
    saveButton.onclick = async () => {
        saveButton.disabled = true;
        try { await save(apiInHeader ? undefined : model.value, pref.value.trim()); }
        finally { saveButton.disabled = false; }
    };
    const footer = doc.createElement('div');
    footer.className = 'flex-container alignitemscenter';
    const state = doc.createElement('span');
    state.setAttribute('role', 'status');
    const retryButton = button('下次正文重试');
    retryButton.onclick = retry;
    footer.append(state, retryButton);
    panel.append(saveButton, footer);
    root.replaceChildren(panel);
    return (message, canRetry) => {
        state.textContent = message;
        retryButton.hidden = !canRetry;
    };
}
