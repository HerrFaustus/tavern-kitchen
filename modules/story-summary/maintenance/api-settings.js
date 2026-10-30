import { mountTextApiSettings } from '../../text-api/settings-ui.js';
export function createSummaryAgentSettings(root) {
    const editor = mountTextApiSettings(root, { feature: 'memory', namespace: 'TavernKitchen-StoryFrame' });
    return { open: () => editor.refresh(), receive: () => {}, destroy: () => editor.destroy() };
}
