import type { XiaobaiOsSettingsRepository } from '../../host/settings-repository.js';

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

    const note = document.createElement('p');
    note.className = 'tk-world-settings-note';
    note.textContent = '推演 Agent 每轮均会在楼尾「推演框」生成独立后台正文；「街头见闻频率」调节日常风味细节密度，世界状态默认随剧情注入。';

    const status = document.createElement('small');
    status.setAttribute('role', 'status');

    panel.append(heading, frequencyRow, note, status);
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
        frequencySelect.disabled = saving;
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

    render();
    const unsubscribe = preferences.subscribe(render);
    return () => { active = false; unsubscribe(); };
}
