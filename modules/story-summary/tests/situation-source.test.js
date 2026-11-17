import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { uiEntry } from './helpers/story-summary-entry.js';
import { renderThreads } from '../../story-state/view.js';
import { ARCHIVE_COPY } from '../archive-view.js';

test('situation cards on the world page wire 查看原楼 to the archive floor-source dialog', t => {
    const previousDocument = globalThis.document;
    const { document } = parseHTML(`<html><body>
        <div id="facts-host"><div id="facts-list"></div></div>
        <button id="archive-world-index"></button>
        <h2 id="archive-world-heading"></h2>
        <p id="archive-world-hint"></p>
    </body></html>`);
    globalThis.document = document;
    t.after(() => { globalThis.document = previousDocument; });
    document.documentElement.dataset.kitchenView = 'world';

    const opened = [];
    const summaryData = {
        facts: [],
        storyRecords: [{ id: 'situation:gate', kind: 'situation', title: '城门戒严', description: '夜禁提前', status: 'open', reason: '', due: '', _addedAt: 1 }],
    };
    const ui = uiEntry(['renderFacts'], {
        $: id => document.getElementById(id),
        document,
        summaryData,
        renderThreads,
        ARCHIVE_COPY,
        archiveView: {
            refreshIndexes() {},
            filteredFacts: () => [],
            worldFacts: () => [],
            openFloorSource: floor => opened.push(floor),
        },
        setHtml: (node, html) => { node.textContent = String(html ?? ''); },
        h: value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])),
    });

    ui.renderFacts(summaryData.facts);
    const situations = document.querySelector('.tk-story-situations');
    assert.match(situations.textContent, /城门戒严/);
    const buttons = [...situations.querySelectorAll('button')].filter(button => button.textContent === '查看原楼');
    assert.ok(buttons.length >= 1);
    buttons[0].click();
    assert.deepEqual(opened, [1]);
});
