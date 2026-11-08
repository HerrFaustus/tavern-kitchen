import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { parseHTML } from 'linkedom';
import { createKitchenWorkspace, getKitchenMount } from './kitchen-workspace.js';

test('one native workspace owns tabs, keeps the shared frame attached and recovers failed panels', async () => {
    const { document } = parseHTML('<html><head></head><body><div id="top-settings-holder"><div id="persona-management-button"></div><div id="rightNavHolder"></div></div></body></html>');
    const settingsElement = document.createElement('div');
    const calls = [];
    const visibility = [];
    const toggles = [];
    const workspace = createKitchenWorkspace({
        documentTarget: document, settingsElement,
        featureSwitches: { memory: [{ key: 'storySummary', label: '启用剧情模块', checked: true }] },
        onToggleFeature: (...args) => toggles.push(args),
        onVisibility: (...state) => visibility.push(state), actions: {
        memory: () => { calls.push('memory'); },
        planner: () => { throw new Error('请先启用规划'); },
        map: () => { calls.push('map'); },
        situation: () => { calls.push('situation'); },
    } });
    assert.equal(document.querySelectorAll('#tk-topbar').length, 1);
    assert.equal(document.querySelector('#persona-management-button').nextElementSibling.id, 'rightNavHolder');
    assert.equal(document.querySelector('#rightNavHolder').nextElementSibling.id, 'tk-topbar');
    assert.equal(document.querySelector('#tk-workspace').parentElement.id, 'tk-topbar', 'native drawer must own its content');
    await workspace.open('memory');
    await setImmediate();
    assert.deepEqual(calls, ['memory']);
    const switchInput = document.querySelector('.tk-feature-switch input');
    assert.equal(switchInput.checked, true);
    switchInput.checked = false;
    switchInput.dispatchEvent(new document.defaultView.Event('change'));
    assert.deepEqual(toggles[0].slice(0, 2), ['storySummary', false]);
    assert.equal(document.querySelectorAll('[role="tab"]').length, 6);
    assert.equal(document.querySelector('[role="tab"]').textContent, '主角');
    assert.equal(document.querySelector('[aria-selected="true"]').textContent, '剧情');
    await workspace.open('memory');
    await setImmediate();
    assert.deepEqual(calls, ['memory']);
    await workspace.open('map');
    const mount = getKitchenMount('map');
    const parent = mount.parentElement;
    const frame = document.createElement('iframe'); mount.append(frame);
    await workspace.open('settings');
    await setImmediate();
    assert.equal(getKitchenMount('settings'), mount);
    assert.equal(mount.parentElement, parent, 'tab switches must not detach a live iframe');
    assert.equal(mount.firstElementChild, frame);
    assert.equal(mount.getAttribute('aria-label'), 'API');
    for (const route of ['situation', 'people', 'relations']) {
        await workspace.open(route);
        assert.equal(getKitchenMount(route), getKitchenMount('memory'));
        assert.equal(document.querySelector('[aria-selected="true"]').textContent, '世界');
    }
    assert.equal(workspace.isActive('people'), true, 'legacy relations links open the merged page');
    workspace.showEvolution(parent => {
        parent.append(document.createElement('input'));
        return () => {};
    }, true);
    const evolutionSettings = document.querySelector('.tk-workspace-controls .tk-evolution details');
    assert.ok(evolutionSettings);
    assert.equal(evolutionSettings.open, true);
    assert.ok(evolutionSettings.querySelector('input'));

    assert.equal(document.querySelector('.tk-subnav [aria-pressed="true"]').textContent, '人物');
    assert.equal(document.querySelector('.tk-subnav [data-route="relations"]'), null);
    assert.equal(document.querySelector('.tk-expand'), null);
    assert.equal(document.querySelector('#tk-topbar .fa-door-open')?.classList.contains('fa-solid'), true);
    await workspace.open('lore');
    assert.equal(getKitchenMount('lore'), null);
    assert.equal(document.querySelector('[data-route="lore"]'), null);
    assert.equal(document.querySelector('.tk-subnav [aria-pressed="true"]').textContent, '人物');
    assert.equal(getKitchenMount('variables'), null);
    await workspace.open('variables');
    assert.equal(workspace.isActive('people'), true, 'a retired variable route must not open or replace the active panel');
    assert.equal(document.querySelector('.tk-subnav [data-route="world"]'), null);
    assert.equal(document.querySelector('.tk-subnav [data-route="situation"]').textContent, '局势');
    assert.equal(document.querySelector('.tk-subnav [data-route="opening"]').textContent, '世界生成');
    await workspace.open('world-records');
    assert.equal(document.querySelector('.tk-subnav [aria-pressed="true"]').textContent, '局势');
    assert.deepEqual([...document.querySelectorAll('.tk-subnav > button')].map(button => button.dataset.route), ['people', 'map', 'situation', 'opening']);
    assert.equal(getKitchenMount('world-records'), getKitchenMount('memory'));
    await workspace.open('world');
    assert.equal(workspace.isActive('people'), true);
    assert.equal(document.querySelector('[aria-selected="true"]').textContent, '世界');
    await workspace.open('world-management');
    assert.equal(document.querySelector('[aria-selected="true"]').textContent, '世界');
    assert.equal(workspace.isActive('people'), true);
    assert.equal(document.querySelector('[data-route="world-management"]'), null);
    assert.equal(getKitchenMount('world-management'), null);
    await workspace.open('map');
    await workspace.open('memory');
    document.getElementById('tk-tab-world').click();
    await setImmediate();
    assert.equal(workspace.isActive('map'), true);
    await workspace.open('summaries');
    assert.equal(document.querySelector('.tk-subnav [aria-pressed="true"]').textContent, '总结');
    assert.equal(getKitchenMount('summaries'), getKitchenMount('memory'));
    await workspace.open('suspense');
    assert.equal(document.querySelector('[aria-selected="true"]').textContent, '剧情');
    assert.equal(document.querySelector('.tk-subnav [aria-pressed="true"]').textContent, '悬念');
    assert.notEqual(getKitchenMount('suspense'), getKitchenMount('memory'));
    await workspace.open('proofreading');
    assert.equal(document.querySelector('[aria-selected="true"]').textContent, '剧情');
    assert.equal(document.querySelector('.tk-subnav [aria-pressed="true"]').textContent, '校对');
    assert.equal(getKitchenMount('proofreading'), getKitchenMount('memory'));
    await workspace.open('memory-settings');
    assert.equal(document.querySelector('[aria-selected="true"]').textContent, '剧情');
    assert.equal(getKitchenMount('memory-settings'), getKitchenMount('memory'));
    assert.equal(document.querySelector('.tk-subnav [aria-pressed="true"]').textContent, '总结');
    assert.equal(document.querySelector('.tk-subnav [data-route="memory"]').textContent, '总结');
    await workspace.open('agent-api');
    assert.equal(document.querySelector('[aria-selected="true"]').textContent, 'API');
    assert.equal(document.querySelector('.tk-subnav [aria-pressed="true"]').textContent, 'API');
    assert.equal(document.querySelector('.tk-subnav').hidden, true);
    assert.equal(document.querySelector('.tk-subnav [data-route="memory-settings"]'), null);
    await workspace.open('planner');
    await setImmediate();
    assert.match(getKitchenMount('planner').textContent, /请先启用规划/);
    assert.equal(getKitchenMount('planner').querySelectorAll('button').length, 1);
    assert.ok(workspace.isActive('planner'));
    assert.equal(document.querySelectorAll('dialog').length, 0);
    workspace.close();
    assert.equal(document.querySelector('#tk-workspace').classList.contains('closedDrawer'), true);
    assert.equal(document.querySelector('#tk-topbar button').getAttribute('aria-expanded'), 'false');
    await workspace.open('settings');
    assert.equal(mount.firstElementChild, frame);
    // Host closes drawers itself when another top-level tool is opened.
    const panel = document.querySelector('#tk-workspace');
    panel.classList.replace('openDrawer', 'closedDrawer');
    await setImmediate();
    assert.equal(workspace.isActive('settings'), false);
    assert.equal(document.querySelector('#tk-topbar button').getAttribute('aria-expanded'), 'false');
    assert.deepEqual(visibility.at(-1), [false, 'settings']);
    await workspace.open();
    assert.equal(workspace.isActive('settings'), true);
    assert.equal(mount.firstElementChild, frame, 'host dismissal must preserve the frame');
    let initializations = 0;
    workspace.configure({actions:{people:()=>{}},initializeWorld:async () => {initializations++;return '开局资料已保存';}});
    await workspace.open('opening');
    const initialize = [...panel.querySelectorAll('button')].find(button => button.textContent === '生成世界');
    initialize.click(); await setImmediate();
    assert.equal(initializations,1);
    assert.ok(initialize.closest('.tk-workspace-controls'));
    assert.equal(getKitchenMount('opening').querySelector('button'), null);
    assert.match(getKitchenMount('opening').textContent,/开局资料已保存/);
    const enabled = new Set(['map','settings']);
    workspace.configure({actions:{map(){}},visiblePanel:id=>enabled.has(id)});
    await setImmediate();
    assert.equal(document.querySelector('#tk-tab-overview').hidden,true);
    await workspace.open('world');
    assert.equal(workspace.isActive('map'),true);
    assert.equal(panel.querySelector('button[data-route="people"]'),null);
    enabled.clear();workspace.configure({actions:{},visiblePanel:id=>enabled.has(id)});
    assert.equal(document.querySelector('#tk-topbar').hidden,true);
    enabled.add('map');workspace.configure({actions:{map(){}},visiblePanel:id=>enabled.has(id)});
    assert.equal(document.querySelector('#tk-topbar').hidden,false);
    workspace.close();
    const opening = workspace.open('map');
    workspace.reset();
    await opening;
    await setImmediate();
    assert.equal(panel.classList.contains('closedDrawer'), true, 'chat reset cancels pending drawer activation');
});
