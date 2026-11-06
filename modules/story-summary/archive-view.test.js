import assert from 'node:assert/strict';
import test from 'node:test';
import { getArchiveCharacters, getArchiveStateFacts, getWorldFactSection } from './archive-view.js';
import { buildTimelineTree, selectTimelineTree } from './timeline-tree.js';

test('timeline nests only sourced rounds, keeps unfinished branches, and reveals matching descendants', () => {
    const rounds = Array.from({ length: 5 }, (_, i) => ({ id: 'round-' + i, _addedAt: i,
        origin: { start: i, end: i }, summary: i === 1 ? '银钥匙' : '渡口' }));
    rounds.push({ id: 'import-1-0', _addedAt: 1, origin: { start: 0, end: 1 }, summary: '旧档' });
    const units = [['stage', 0, 1], ['stage', 2, 2], ['chapter', 0, 2], ['stage', 3, 3]]
        .map(([level, start, end]) => ({ level, start, end, text: level }));
    const tree = buildTimelineTree(rounds, units);
    const newest = selectTimelineTree(tree, { descending: true });
    assert.deepEqual(newest.map(n => n.level), ['round', 'stage', 'chapter', 'round']);
    assert.deepEqual(newest[2].children.map(n => n.end), [2, 1]);
    assert.deepEqual(newest[2].children[1].children.map(n => n.index), [1, 0]);
    const [chapter] = selectTimelineTree(tree, { query: '银钥匙' });
    assert.ok(chapter.reveal && chapter.children[0].reveal);
    assert.deepEqual(chapter.children[0].children.map(n => n.index), [1]);
    assert.deepEqual(selectTimelineTree(tree, { level: 'chapter' })[0].children.map(n => n.end), [1, 2]);
    assert.equal(buildTimelineTree(rounds, []).length, 6);
});

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

test('scene and round mentions stay off the roster while an identified custodian keeps one profile', () => {
    const data = {
        playerName: '主角', characters: { main: [], relationships: [] }, characterAliases: [],
        storyRecords: [{ kind: 'scene', participants: ['卖花人', '北门守卫'] }],
        rounds: [{ participants: ['卖花人', '北门守卫'], summary: '卖花人吆喝了一声。' }],
    };
    const names = () => getArchiveCharacters(data).map(character => character.name);
    assert.deepEqual(names(), ['主角']);
    data.storyRecords.push({ kind: 'person', name: '北门守卫', note: '代管银钥匙，明早归还。' });
    assert.deepEqual(names(), ['主角', '北门守卫']);
    data.characterAliases.push({ from: '北门守卫', to: '林安', evidence: '守卫报出姓名。' });
    data.entities = [{ kind: 'person', name: '林安' }];
    assert.deepEqual(names().sort(), ['主角', '林安'].sort());
});
