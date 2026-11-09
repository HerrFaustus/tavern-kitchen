import type { XiaobaiOsSettingsRepository } from '../../host/settings-repository.js';
import { readSituationCatalog, registerLinkedDevelopments } from '../../../story-state/situation-links.js';
import type { WorldService } from './application/service.js';
import { isTrustedMessage } from '../../../../core/iframe-messaging.js';

let reader: WorldService | undefined;
export function registerEvolutionReader(world: WorldService) {
    reader = world;
    const disconnect = registerLinkedDevelopments(identity => {
        const current = world.readCurrent();
        return current.chatIdentity === identity ? current.world.news.filter(item => !!item.situationId) : [];
    });
    return () => { disconnect(); if (reader === world) { reader = undefined; } };
}

export function mountEvolutionView(parent: HTMLElement, section: 'people' | 'situation', preferences: XiaobaiOsSettingsRepository, frame?: HTMLIFrameElement) {
    const people = section === 'people';
    const key = people ? 'peopleEvolution' : 'subscribed';
    const label = document.createElement('label');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    label.append(toggle, people ? '随剧情推演人物动向' : '随剧情推演事态进展');
    const status = document.createElement('small');
    status.setAttribute('role', 'status');
    const log = document.createElement('details');
    const title = document.createElement('summary');
    title.textContent = people ? '幕后人物动向' : '幕后局势进展';
    const entries = document.createElement('div');
    log.append(title, entries);
    parent.replaceChildren(label, status, log);
    const scenery = document.createElement('input'); scenery.type = 'checkbox';
    const frequency = document.createElement('select');
    if (!people) {
        const weatherLabel = document.createElement('label'), encounterLabel = document.createElement('label');
        weatherLabel.append(scenery, '随剧情推演风物变化');
        for (const [value, text] of [['off', '关闭'], ['occasional', '偶尔'], ['lively', '活跃']]) {
            const option = document.createElement('option'); option.value = value; option.textContent = text; frequency.append(option);
        }
        encounterLabel.append('街头见闻频率', frequency);
        parent.insertBefore(weatherLabel, status); parent.insertBefore(encounterLabel, status);
    }
    const embedded = !!frame;
    const inline = !people && embedded;
    if (inline) { label.hidden = true; scenery.parentElement!.hidden = true; frequency.parentElement!.hidden = true; }
    let active = true, saving = false;
    const renderPreferences = () => {
        const settings = preferences.read();
        if (inline) { frame!.contentWindow?.postMessage({
            source: 'TavernKitchen', type: 'WORLD_EVOLUTION_STATE',
            settings: { enabled: !!settings?.enabled, pending: saving,
                subscribed: !!settings?.apps.world.subscribed,
                sceneryEvolution: settings?.apps.world.sceneryEvolution === true,
                encounterFrequency: settings?.apps.world.encounterFrequency || 'occasional',
                error: status.textContent || '' },
        }, window.location.origin); }

        toggle.checked = !!settings?.apps.world[key];
        scenery.checked = settings?.apps.world.sceneryEvolution === true;
        for (const option of frequency.options) { option.selected = option.value === (settings?.apps.world.encounterFrequency || 'occasional'); }
        scenery.disabled = frequency.disabled = saving || !settings?.enabled;
        toggle.disabled = saving || !settings?.enabled;
        if (!settings?.enabled) { status.textContent = '请先打开「API」或地图以启动工作台。'; }
    };
    const world = reader;
    const renderEntries = () => {
        if (!active) { return; }
        entries.replaceChildren();
        const current = world?.readCurrent();
        const news = current?.chatIdentity ? current.world.news.filter(item => people === item.id.startsWith('person-')) : [];
        if (!people && current?.chatIdentity && current.world.overview) {
            const overview = document.createElement('p');
            overview.textContent = current.world.overview;
            entries.append(overview);
        }
        const catalog = new Map(readSituationCatalog(current?.chatIdentity || '').map(item => [item.id, item.title]));
        for (const item of news) {
            const row = document.createElement('p'), heading = document.createElement('strong');
            heading.textContent = item.title;
            row.append(heading, document.createElement('br'), item.body);
            if (item.progress) {
                const proof = document.createElement('details');
                const summary = document.createElement('summary');
                summary.textContent = '推进依据 · 第 ' + (item.progress.floor + 1) + ' 楼';
                proof.append(summary, '原状态：' + (item.progress.from || '首次记录'), document.createElement('br'),
                    '推进原因：' + item.progress.reason, document.createElement('br'), '正文：' + item.progress.quote);
                row.append(proof);
            }
            if (item.situationId) {
                const link = document.createElement('small');
                link.textContent = '关联局势：' + (catalog.get(item.situationId) || '当前记录已移除');
                row.append(document.createElement('br'), link);
            }
            entries.append(row);
        }
        log.hidden = embedded || !entries.childElementCount;
        if (embedded) {
            frame!.contentWindow?.postMessage({
                source: 'TavernKitchen', type: 'WORLD_EVOLUTION_RECORDS', section: people ? 'people' : 'world',
                overview: !people ? current?.world.overview || '' : '',
                news: news.map(item => ({ title: item.title, body: item.body, progress: item.progress,
                    situationTitle: item.situationId ? catalog.get(item.situationId) : undefined })),
            }, window.location.origin);
        }
    };
    const report = (error: unknown) => { if (active) { status.textContent = error instanceof Error ? error.message : String(error); } };
    const save = async (operation: () => Promise<unknown>) => {
        saving = true; renderPreferences(); toggle.disabled = scenery.disabled = frequency.disabled = true; status.textContent = '';
        try { await operation(); }
        catch (error) { report(error); }
        finally { saving = false; if (active) { renderPreferences(); } }
    };
    toggle.onchange = () => {
        const value = toggle.checked;
        return save(() => preferences.setWorldPreference(key, value));
    };
    scenery.onchange = () => {
        const value = scenery.checked;
        return save(() => preferences.setWorldPreference('sceneryEvolution', value));
    };
    frequency.onchange = () => {
        const value = frequency.value as 'off' | 'occasional' | 'lively';
        return save(() => preferences.setEncounterFrequency(value));
    };
    const receive = (event: MessageEvent) => {
        if (!embedded || !active || !isTrustedMessage(event, frame, 'TavernKitchen-StoryFrame')) { return; }
        if (event.data.type === 'WORLD_EVOLUTION_REQUEST') { renderPreferences(); renderEntries(); return; }
        if (!inline || event.data.type !== 'WORLD_EVOLUTION_CHANGE' || saving || !preferences.read()?.enabled) { return; }
        const { key: field, value } = event.data;
        if (field === 'encounterFrequency' && ['off','occasional','lively'].includes(value)) {
            save(() => preferences.setEncounterFrequency(value)).catch(report); return;
        }
        if (['subscribed','sceneryEvolution'].includes(field) && typeof value === 'boolean') {
            save(() => preferences.setWorldPreference(field, value)).catch(report);
        }
    };
    if (embedded) {
        // eslint-disable-next-line no-restricted-syntax -- receive checks the live iframe, origin and source with isTrustedMessage before processing.
        window.addEventListener('message', receive);
    }
    renderPreferences(); renderEntries();
    const unsubscribe = preferences.subscribe(renderPreferences);
    const stop = world?.subscribe(renderEntries);
    world?.refreshCurrent().then(renderEntries).catch(report);
    return () => { active = false; if (embedded) { window.removeEventListener('message', receive); } stop?.(); unsubscribe(); };
}
