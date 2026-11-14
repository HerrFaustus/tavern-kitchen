let settings = {};

export function usePanelSettings(value) {
    settings = value || {};
}

export function panelEnabled(panel) {
    return settings.enabled !== false && (settings.panels?.[panel] ?? (panel === 'planner' ? settings.enaPlanner?.enabled !== false : true));
}
