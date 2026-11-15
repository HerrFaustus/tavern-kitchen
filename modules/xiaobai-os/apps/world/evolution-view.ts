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

export function mountEvolutionView(parent: HTMLElement, section: 'people' | 'situation', _preferences?: XiaobaiOsSettingsRepository, frame?: HTMLIFrameElement, _check?: () => Promise<void>, _visit?: (selector: string) => void) {
    const people = section === 'people';
    const status = document.createElement('small');
    status.setAttribute('role', 'status');
    const log = document.createElement('details');
    const title = document.createElement('summary');
    title.textContent = people ? '幕后人物动向' : '幕后局势进展';
    const entries = document.createElement('div');
    log.append(title, entries);
    parent.replaceChildren(status, log);
    const embedded = !!frame;
    let active = true;
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
    const receive = (event: MessageEvent) => {
        if (!embedded || !active || !isTrustedMessage(event, frame, 'TavernKitchen-StoryFrame')) { return; }
        if (event.data.type === 'WORLD_EVOLUTION_REQUEST') { renderEntries(); }
    };
    if (embedded) {
        // eslint-disable-next-line no-restricted-syntax -- receive checks the live iframe, origin and source with isTrustedMessage before processing.
        window.addEventListener('message', receive);
    }
    renderEntries();
    const stop = world?.subscribe(renderEntries);
    world?.refreshCurrent().then(renderEntries).catch(report);
    return () => { active = false; if (embedded) { window.removeEventListener('message', receive); } stop?.(); };
}

export function mountWorldSettings(parent: HTMLElement, preferences: XiaobaiOsSettingsRepository) {
    const panel = document.createElement('section');
    panel.className = 'tk-world-settings';
    panel.setAttribute('aria-label', '世界与推演设置');

    const heading = document.createElement('h4');
    heading.className = 'standoutHeader';
    heading.textContent = '世界与推演';

    const frequencyRow = document.createElement('div');
    frequencyRow.className = 'tk-world-settings-row';
    const frequencyLabel = document.createElement('label');
    frequencyLabel.htmlFor = 'tk-world-encounter-frequency';
    frequencyLabel.textContent = '街头见闻频率';
    const frequencySelect = document.createElement('select');
    frequencySelect.id = 'tk-world-encounter-frequency';
    frequencySelect.className = 'text_pole';
    frequencySelect.dataset.worldSetting = 'encounterFrequency';
    for (const [value, text] of [['off', '关闭'], ['occasional', '偶尔'], ['lively', '活跃']]) {
        const option = document.createElement('option');
        option.value = value;
        option.setAttribute('value', value);
        option.textContent = text;
        frequencySelect.append(option);
    }
    frequencyRow.append(frequencyLabel, frequencySelect);

    const injectRow = document.createElement('div');
    injectRow.className = 'tk-world-settings-row';
    const injectLabel = document.createElement('label');
    injectLabel.htmlFor = 'tk-world-inject-to-story';
    injectLabel.textContent = '将世界状态注入剧情';
    const injectCheckbox = document.createElement('input');
    injectCheckbox.id = 'tk-world-inject-to-story';
    injectCheckbox.type = 'checkbox';
    injectCheckbox.dataset.worldSetting = 'injectToStory';
    injectRow.append(injectLabel, injectCheckbox);

    const note = document.createElement('p');
    note.className = 'tk-world-settings-note';
    note.textContent = '人物动向、事态发展、风物变化、地图维护与编剧章节推演现已默认随剧情自动运转。';

    const status = document.createElement('small');
    status.setAttribute('role', 'status');

    panel.append(heading, frequencyRow, injectRow, note, status);
    parent.replaceChildren(panel);

    let active = true;
    let saving = false;

    const render = () => {
        if (!active) { return; }
        const world = preferences.read()?.apps.world;
        const frequency = world?.encounterFrequency || 'occasional';
        for (const option of frequencySelect.querySelectorAll('option')) {
            const match = (option.getAttribute('value') || option.value) === frequency;
            if (match) {
                option.setAttribute('selected', '');
                option.selected = true;
            } else {
                option.removeAttribute('selected');
            }
        }
        injectCheckbox.checked = world?.injectToStory !== false;
        frequencySelect.disabled = saving;
        injectCheckbox.disabled = saving;
    };

    const runSave = async (operation: () => Promise<unknown>) => {
        saving = true;
        render();
        status.textContent = '正在保存…';
        try {
            await operation();
            if (active) { status.textContent = '已保存。'; }
        } catch (error) {
            if (active) { status.textContent = error instanceof Error ? error.message : String(error); }
        } finally {
            saving = false;
            if (active) { render(); }
        }
    };

    const handleSave = (operation: () => Promise<unknown>) => {
        runSave(operation).catch(error => {
            console.debug({ source: import.meta.url, operation: 'world-settings-change' }, error);
        });
    };

    frequencySelect.onchange = () => {
        const selected = [...frequencySelect.querySelectorAll('option')].find(option => option.selected || option.hasAttribute('selected'));
        const next = (frequencySelect.value || selected?.getAttribute('value') || selected?.value || 'occasional') as 'off' | 'occasional' | 'lively';
        handleSave(() => preferences.setEncounterFrequency(next));
    };

    injectCheckbox.onchange = () => {
        const next = injectCheckbox.checked;
        handleSave(() => preferences.setWorldPreference('injectToStory', next));
    };

    render();
    const unsubscribe = preferences.subscribe(render);
    return () => { active = false; unsubscribe(); };
}
