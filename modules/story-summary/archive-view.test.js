import assert from 'node:assert/strict';
import test from 'node:test';
import { getArchiveStateFacts, getWorldFactSection } from './archive-view.js';

test('situation and lore partition active world records without changing source data', () => {
    const data = { facts: [
        { s: '渡口', p: '开放时间', o: '明早' },
        { s: '王国', p: '货币', o: '银币' },
        { s: '山脉', p: '地理位置', o: '北方' },
        { s: '城门', p: '临时通行规则', o: '暂停通行' },
        { s: '阿林', p: '对贝拉的态度', o: '信任' },
        { s: '旧城', p: '历史', o: '旧记录', retracted: true },
        { s: '物件', p: '未知旧属性', o: '原始内容', _isState: true },
    ] };
    const before = structuredClone(data);
    const situation = getArchiveStateFacts(data, 'world');
    const lore = getArchiveStateFacts(data, 'lore');
    assert.deepEqual(situation.map(f => f.s), ['渡口', '城门', '物件']);
    assert.deepEqual(lore.map(f => f.s), ['王国', '山脉']);
    assert.equal(new Set([...situation, ...lore]).size, getArchiveStateFacts(data).length);
    assert.deepEqual(data, before);
});

test('changing conditions override a background keyword and retention is not a category', () => {
    assert.equal(getWorldFactSection({ p: '当前法律', _isState: true }), 'world');
    assert.equal(getWorldFactSection({ p: '魔法体系', _isState: false }), 'lore');
    assert.equal(getWorldFactSection({ p: '' }), 'world');
});
