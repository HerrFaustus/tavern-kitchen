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
    assert.equal(document.querySelector('#persona-management-button').nextElementSibling.id, 'tk-topbar');
    assert.equal(document.querySelector('#rightNavHolder').previousElementSibling.id, 'tk-topbar');
    assert.equal(document.querySelector('#tk-workspace').parentElement.id, 'tk-topbar', 'native drawer must own its content');
    await workspace.open('memory');
    await setImmediate();
    assert.deepEqual(calls, ['memory']);
    const switchInput = document.querySelector('.tk-feature-switch input');
    assert.equal(switchInput.checked, true);
    switchInput.checked = false;
    switchInput.dispatchEvent(new document.defaultView.Event('change'));
    assert.deepEqual(toggles[0].slice(0, 2), ['storySummary', false]);
    assert.equal(document.querySelectorAll('[role="tab"]').length, 5);
    assert.equal(document.querySelector('[role="tab"]').textContent, '主角');
    assert.equal(document.querySelector('[aria-selected="true"]').textContent, '剧情');
    await workspace.open('memory');
    await setImmediate();
    assert.deepEqual(calls, ['memory']);
    await workspace.open('map');
    const mount = getKitchenMount('map');
    const parent = mount.parentElement;
    const frame = document.createElement('iframe'); mount.append(frame);
    await workspace.open('dice');
    await setImmediate();
    assert.equal(getKitchenMount('dice'), mount);
    assert.equal(mount.parentElement, parent, 'tab switches must not detach a live iframe');
    assert.equal(mount.firstElementChild, frame);
    assert.equal(mount.getAttribute('aria-label'), '行动判定');
    for (const route of ['situation', 'people', 'relations']) {
        await workspace.open(route);
        assert.equal(getKitchenMount(route), getKitchenMount('memory'));
        assert.equal(document.querySelector('[aria-selected="true"]').textContent, '世界');
    }
    assert.equal(workspace.isActive('people'), true, 'legacy relations links open the merged page');
    assert.equal(document.querySelector('.tk-subnav [aria-pressed="true"]').textContent, '人物');
    assert.equal(document.querySelector('.tk-subnav [data-route="relations"]'), null);
    assert.equal(document.querySelector('.tk-expand'), null);
    assert.equal(document.querySelector('#tk-topbar .fa-door-open')?.classList.contains('fa-solid'), true);
    await workspace.open('lore');
    assert.equal(getKitchenMount('lore'), getKitchenMount('situation'));
    assert.equal(document.querySelector('.tk-subnav [aria-pressed="true"]').textContent, '设定');
    assert.equal(document.querySelector('.tk-subnav-more summary').textContent, '更多 · 设定');
    assert.deepEqual([...document.querySelectorAll('.tk-subnav-more [data-route]')].map(button => button.dataset.route), ['lore']);
    assert.equal(getKitchenMount('variables'), null);
    await workspace.open('variables');
    assert.equal(workspace.isActive('lore'), true, 'a retired variable route must not open or replace the active panel');
    assert.equal(document.querySelector('.tk-subnav [data-route="world"]'), null);
    assert.equal(document.querySelector('.tk-subnav [data-route="situation"]').textContent, '局势');
    await workspace.open('world-records');
    assert.equal(document.querySelector('.tk-subnav [aria-pressed="true"]').textContent, '局势');
    assert.equal(document.querySelector('.tk-subnav-more summary').textContent, '更多');
    assert.deepEqual([...document.querySelectorAll('.tk-subnav > button')].map(button => button.dataset.route), ['people', 'map', 'situation']);
    assert.equal(getKitchenMount('world-records'), getKitchenMount('memory'));
    await workspace.open('world');
    assert.equal(workspace.isActive('people'), true);
    assert.equal(document.querySelector('[aria-selected="true"]').textContent, '世界');
    await workspace.open('world-management');
    assert.equal(document.querySelector('[aria-selected="true"]').textContent, '世界');
    assert.equal(workspace.isActive('people'), true);
    assert.equal(document.querySelector('[data-route="world-management"]'), null);
    assert.equal(getKitchenMount('world-management'), null);
    await workspace.open('summaries');
    assert.equal(document.querySelector('.tk-subnav [aria-pressed="true"]').textContent, '剧情设置');
    assert.equal(getKitchenMount('summaries'), getKitchenMount('memory'));
    await workspace.open('suspense');
    assert.equal(document.querySelector('[aria-selected="true"]').textContent, '剧情');
    assert.equal(document.querySelector('.tk-subnav [aria-pressed="true"]').textContent, '悬念簿');
    assert.notEqual(getKitchenMount('suspense'), getKitchenMount('memory'));
    await workspace.open('proofreading');
    assert.equal(document.querySelector('[aria-selected="true"]').textContent, '剧情');
    assert.equal(document.querySelector('.tk-subnav [aria-pressed="true"]').textContent, '剧情校对');
    assert.equal(getKitchenMount('proofreading'), getKitchenMount('memory'));
    await workspace.open('memory-settings');
    assert.equal(document.querySelector('[aria-selected="true"]').textContent, '剧情');
    assert.equal(getKitchenMount('memory-settings'), getKitchenMount('memory'));
    assert.equal(document.querySelector('.tk-subnav [aria-pressed="true"]').textContent, '剧情设置');
    assert.equal(document.querySelector('.tk-subnav [data-route="memory"]').textContent, '剧情时间线');
    await workspace.open('agent-api');
    assert.equal(document.querySelector('[aria-selected="true"]').textContent, 'API 设置');
    assert.equal(document.querySelector('.tk-subnav [aria-pressed="true"]').textContent, 'API 设置');
    assert.equal(document.querySelector('.tk-subnav').hidden, true);
    assert.equal(document.querySelector('.tk-subnav [data-route="memory-settings"]'), null);
    await workspace.open('planner');
    await setImmediate();
    assert.match(getKitchenMount('planner').textContent, /请先启用规划/);
    getKitchenMount('planner').querySelectorAll('button')[1].click();
    await setImmediate();
    assert.equal(workspace.isActive('settings'), true);
    assert.equal(document.querySelectorAll('dialog').length, 0);
    workspace.close();
    assert.equal(document.querySelector('#tk-workspace').classList.contains('closedDrawer'), true);
    assert.equal(document.querySelector('#tk-topbar button').getAttribute('aria-expanded'), 'false');
    await workspace.open('dice');
    assert.equal(mount.firstElementChild, frame);
    // Host closes drawers itself when another top-level tool is opened.
    const panel = document.querySelector('#tk-workspace');
    panel.classList.replace('openDrawer', 'closedDrawer');
    await setImmediate();
    assert.equal(workspace.isActive('dice'), false);
    assert.equal(document.querySelector('#tk-topbar button').getAttribute('aria-expanded'), 'false');
    assert.deepEqual(visibility.at(-1), [false, 'dice']);
    await workspace.open();
    assert.equal(workspace.isActive('dice'), true);
    assert.equal(mount.firstElementChild, frame, 'host dismissal must preserve the frame');
    workspace.close();
    const opening = workspace.open('map');
    workspace.reset();
    await opening;
    await setImmediate();
    assert.equal(panel.classList.contains('closedDrawer'), true, 'chat reset cancels pending drawer activation');
});
