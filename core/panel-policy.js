let settings = {};
const prompts = new Map();

let persistPrompt;
export function usePanelSettings(value, savePrompt) {
    settings = value;
    persistPrompt = savePrompt;
}
export function savePanelPrompt(key, value) {
    if (!persistPrompt) throw new Error('提示词配置尚未就绪');
    return persistPrompt(key, value);
}
export function panelEnabled(panel) {
    return settings.enabled !== false && (settings.panels?.[panel] ?? (panel === 'planner' ? settings.enaPlanner?.enabled !== false : true));
}

// The editor and the request builder reference the same default. Templates substitute data after the user's edits.
export function definePanelPrompt(panel, key, label, template, validate = undefined) {
    const entry = {panel,key,label,template,validate};
    prompts.set(key,entry);
    return values => {
        const source = settings.panelPrompts?.[key] ?? template;
        if (!values) return source;
        return source.replace(/\{\{(\w+)\}\}/g,(match,name) => Object.hasOwn(values,name) ? String(values[name]) : match);
    };
}
export function promptsForPanel(panel) { return [...prompts.values()].filter(entry => entry.panel.split('|').includes(panel)); }
