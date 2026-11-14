let settings = {};

export function usePanelSettings(value) {
    settings = value || {};
}

export function panelEnabled(panel) {
    return settings.enabled !== false && (settings.panels?.[panel] ?? (panel === 'places' ? settings.panels?.map === true : panel === 'planner' ? settings.enaPlanner?.enabled !== false : true));
}
