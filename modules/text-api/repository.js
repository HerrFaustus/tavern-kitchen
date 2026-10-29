import { TEXT_API_SETTINGS_KEY as KEY, assertSettings, applyPresetAction } from './model.js';
import { migrateLegacySettings, withoutLegacySummaryApi, withoutLegacyPlannerApi } from './migration.js';
import { TEXT_API_COPY as COPY } from './copy.js';

const SUMMARY_KEY = 'storySummaryPanelConfig';
const LOCAL_SUMMARY = 'tavern_kitchen_summary_panel_config';

export function createTextApiRepository({ common, planner, local }) {
    let initialized = null;
    let queue = Promise.resolve();
    const serial = operation => {
        const pending = queue.then(operation, operation);
        queue = pending.then(() => {}, () => {});
        return pending;
    };
    const readLocal = key => {
        const value = local?.getItem(key);
        if (!value) return null;
        try { return JSON.parse(value); }
        catch { throw new Error(COPY.invalid); }
    };
    async function verify() {
        await common.waitForQueuedWrites?.();
        common.clearCache();
        return assertSettings(await common.getStrict(KEY, null));
    }
    async function cleanupRecord(storage, key, clean) {
        const current = await storage.getStrict(key, null);
        if (current == null || JSON.stringify(current) === JSON.stringify(clean(current))) return;
        await storage.updateAndSave(draft => {
            if (draft[key] != null) draft[key] = clean(draft[key]);
        }, { silent: false });
    }
    function cleanupLocal(key, clean) {
        const current = readLocal(key);
        if (current == null) return;
        const next = clean(current);
        if (JSON.stringify(current) !== JSON.stringify(next)) local.setItem(key, JSON.stringify(next));
    }
    async function cleanup() {
        await cleanupRecord(common, SUMMARY_KEY, withoutLegacySummaryApi);
        await cleanupRecord(planner, 'config', withoutLegacyPlannerApi);
        cleanupLocal(LOCAL_SUMMARY, withoutLegacySummaryApi);
    }
    async function initialize() {
        const current = await common.getStrict(KEY, null);
        if (!current) {
            const [summaryServer, planning] = await Promise.all([
                common.getStrict(SUMMARY_KEY, null), planner.getStrict('config', null),
            ]);
            const next = migrateLegacySettings({
                summary: summaryServer ?? readLocal(LOCAL_SUMMARY) ?? {}, planner: planning ?? {},
            });
            await common.updateAndSave(draft => { if (!draft[KEY]) draft[KEY] = next; }, { silent: false });
            const saved = await verify();
            if (JSON.stringify(saved) !== JSON.stringify(next)) throw new Error(COPY.saveFailed);
        } else assertSettings(current);
        await cleanup();
    }
    async function ready() {
        initialized ??= initialize().catch(error => { initialized = null; throw error; });
        await initialized;
    }
    return {
        load() { return serial(async () => { await ready(); return assertSettings(await common.getStrict(KEY, null)); }); },
        mutate(feature, action) {
            return serial(async () => {
            await ready();
            let next;
            await common.updateAndSave(draft => {
                next = applyPresetAction(draft[KEY], feature, action); draft[KEY] = next;
            }, { silent: false });
            return structuredClone(next);
            });
        },
    };
}

let repository;
export async function getTextApiRepository() {
    if (!repository) {
        const { CommonSettingStorage, EnaPlannerStorage } = await import('../../core/server-storage.js');
        repository ??= createTextApiRepository({ common: CommonSettingStorage, planner: EnaPlannerStorage,
            local: globalThis.localStorage });
    }
    return repository;
}
