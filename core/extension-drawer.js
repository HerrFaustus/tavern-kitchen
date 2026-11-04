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
    note.textContent = '剧情总结、世界档案、地图与变量工具。';
    const shortcut = doc.createElement('button');
    shortcut.type = 'button';
    shortcut.className = 'menu_button';
    shortcut.textContent = '打开酒馆后厨';
    shortcut.addEventListener('click', () => onOpen());
    content.append(note, shortcut);
    drawer.append(header, content);
    container.append(drawer);
    return container;
}
