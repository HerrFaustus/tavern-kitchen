import manifest from '../manifest.json' with { type: 'json' };

/** Native SillyTavern extension drawer for the workspace entry. */
export function createExtensionDrawer({ doc = document, onOpen = () => {} } = {}) {
    const container = doc.createElement('div');
    container.id = 'tavern-kitchen-extension';
    container.className = 'extension_container';
    const drawer = doc.createElement('div');
    drawer.className = 'inline-drawer';
    const header = doc.createElement('div');
    header.className = 'inline-drawer-toggle inline-drawer-header';
    const title = doc.createElement('b');
    title.textContent = '酒馆后厨';
    const icon = doc.createElement('div');
    icon.className = 'inline-drawer-icon fa-solid fa-circle-chevron-down down';
    header.append(title, icon);
    const content = doc.createElement('div');
    content.className = 'inline-drawer-content';
    const note = doc.createElement('p');
    note.className = 'tk-extension-note';
    note.textContent = '剧情总结、世界档案与地图工具。';
    content.append(note);
    const version = doc.createElement('p');
    version.textContent = '版本 ' + manifest.version;
    const shortcut = doc.createElement('button');
    shortcut.type = 'button';
    shortcut.className = 'menu_button';
    shortcut.textContent = '打开后厨';
    shortcut.addEventListener('click', () => onOpen());
    const tutorial = doc.createElement('button');
    tutorial.type = 'button';
    tutorial.className = 'menu_button';
    tutorial.textContent = '后厨教程（待做）';
    tutorial.disabled = true;
    content.append(version, shortcut, tutorial);
    drawer.append(header, content);
    container.append(drawer);
    return container;
}

export function createPanelSettings({ doc = document, enabled, panels, onPanelChange, onToggleEnabled }) {
    const content = doc.createElement('details');
    content.className = 'tk-panel-settings';
    const summary = doc.createElement('summary');
    summary.textContent = '面板设置';
    content.append(summary);
    if (enabled !== undefined) {
        const toggle = doc.createElement('label');
        toggle.className = 'tk-extension-toggle';
        const input = doc.createElement('input');
        input.type = 'checkbox';
        input.checked = !!enabled;
        input.addEventListener('change', () => onToggleEnabled(input.checked,input));
        const text = doc.createElement('span');
        text.textContent = '启用酒馆后厨';
        toggle.append(input, text);
        content.append(toggle);
    }
    for (const {id,label,checked} of panels) {
        const line = doc.createElement('label'); line.className = 'tk-extension-toggle';
        const input = doc.createElement('input'); input.type = 'checkbox'; input.checked = checked;
        input.dataset.panel = id;
        input.addEventListener('change',() => onPanelChange(id,input.checked,input));
        line.append(input,doc.createTextNode(label)); content.append(line);
    }
    const credits = doc.createElement('a');
    credits.href = 'https://github.com/RT15548/LittleWhiteBox';
    credits.target = '_blank';
    credits.rel = 'noopener noreferrer';
    credits.textContent = '项目致谢 · Based on LittleWhiteBox by biex';
    const creditLine = doc.createElement('p');
    creditLine.append(credits);
    content.append(creditLine);
    return content;
}
