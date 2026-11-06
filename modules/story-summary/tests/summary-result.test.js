import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSummaryResult } from '../generate/summary-result.js';

const event = (fields = {}) => ({ title: '归还钥匙', summary: '小红归还了钥匙。 (#21-22)', ...fields });
const prepare = prepareSummaryResult;

test('retired event outputs cannot create records', () => {
    assert.equal(prepare({ events: [event()] }).events, undefined);
});

test('omitted update collections and empty events are legitimate; populated collections must be well formed', () => {
    assert.deepEqual(prepare({ events: [] }), {
        factUpdates: [], keywords: [], newCharacters: [], characterAliasUpdates: [],
    });
    for (const field of ['factUpdates', 'keywords', 'newCharacters', 'characterAliasUpdates']) {
        for (const value of [null, {}, '[]', [null]]) {
            assert.throws(() => prepare({ events: [], [field]: value }), error => error.message.startsWith(field));
        }
    }
});

test('old arc output is ignored without modifying the input', () => {
    const arc = {name:'小红',trajectory:'建立信任',progress:70};
    const batch = {arcUpdates:[arc],keywords:[{text:'钥匙',weight:'重要'}]};
    const result = prepare(batch);
    assert.equal(result.arcUpdates, undefined);
    assert.equal(result.keywords[0].text,'钥匙');
    assert.equal(batch.arcUpdates[0].progress,70);
});

test('missing relationship trend preserves fact content without inventing a label', () => {
    for (const p of ['对小蓝的看法', '对小蓝的态度', '与小蓝的关系']) {
        const fact = { s: '小红', p, o: '愿意共同承担责任', isState: true };
        for (const trend of [undefined, null, '', '  ']) {
            const batch = { events: [event()], factUpdates: [{ ...fact, trend }] };
            const before = structuredClone(batch);
            assert.deepEqual(prepare(batch).factUpdates, [fact]);
            assert.deepEqual(batch, before);
        }
    }
    const fact = { s: '小红', p: '对小蓝的看法', o: '愿意共同承担责任', isState: true };
    assert.deepEqual(prepare({ events: [], factUpdates: [{ ...fact, trend: ' 亲密 ' }] }).factUpdates, [{ ...fact, trend: '亲密' }]);
    for (const trend of ['未知倾向', 0, false, {}]) {
        assert.throws(() => prepare({ events: [], factUpdates: [{ ...fact, trend }] }), {
            code: 'invalid_summary_field', path: 'factUpdates[0].trend',
        });
    }
});

test('fact, character, keyword and alias updates project only valid update data', () => {
    const alias = { to: '李玄清', from: ['道长'], evidence: '#37 道长报出本名李玄清' };
    const result = prepare({
        events: [], newCharacters: [' 李玄清 '], keywords: [{ text: '钥匙', weight: '核心' }],
        factUpdates: [
            { s: ' 小红 ', p: '当前位置', o: '家中', isState: true, id: 'untrusted' },
            { s: '小红', p: '当前状态', retracted: true },
            { s: '小红', p: '对李玄清的看法', o: '信任', isState: true, trend: '投缘' },
        ],
        characterAliasUpdates: [alias],
    });
    assert.deepEqual(result.factUpdates, [
        { s: '小红', p: '位置', o: '家中', isState: true },
        { s: '小红', p: '状态', retracted: true },
        { s: '小红', p: '对李玄清的看法', o: '信任', isState: true, trend: '投缘' },
    ]);
    assert.deepEqual(result.characterAliasUpdates, [alias]);
    assert.deepEqual(result.newCharacters, ['李玄清']);
    assert.deepEqual(result.keywords, [{ text: '钥匙', weight: '核心' }]);
    for (const fact of [{ s: {}, p: '位置', o: '家' }, { s: '小红', p: '位置' },
        { s: '小红', p: '位置', o: '家', isState: 'false' }, { s: '小红', p: '位置', retracted: 'true' }]) {
        assert.throws(() => prepare({ events: [], factUpdates: [fact] }), /factUpdates\[0\]/);
    }
    assert.throws(() => prepare({ events: [], characterAliasUpdates: [{ ...alias, from: [] }] }), /characterAliasUpdates/);
});
