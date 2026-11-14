import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ageDisplay,
    calculateRelativeDays,
    formatRelativeStoryRange,
    latestStoryTime,
    parseStoryDate,
    relativeTimeLabel,
    weekdayLabel,
} from './time-rel.js';

test('parseStoryDate handles standard, Chinese numeral, calendar-prefixed, fantasy, and rejects floor tags', () => {
    assert.deepEqual(parseStoryDate('2026/11/14 21:30'), { year: 2026, month: 11, day: 14, type: 'standard' });
    assert.deepEqual(parseStoryDate('1988.9.29晴'), { year: 1988, month: 9, day: 29, type: 'standard' });
    assert.deepEqual(parseStoryDate('庆历十五年八月初七'), {
        year: 15,
        month: 8,
        day: 7,
        type: 'standard',
        calendarPrefix: '庆历',
    });
    assert.deepEqual(parseStoryDate('元持廿一年十二月卅日'), {
        year: 21,
        month: 12,
        day: 30,
        type: 'standard',
        calendarPrefix: '元持',
    });
    assert.equal(parseStoryDate('3727年★9月30日'), null);
    assert.deepEqual(parseStoryDate('霜月3日'), { monthId: '霜月', day: 3, type: 'fantasy', raw: '霜月3日' });
    assert.equal(parseStoryDate('#1–3'), null);
    assert.equal(parseStoryDate('15:30'), null);
    assert.equal(parseStoryDate('旧档汇总'), null);
});

test('relativeTimeLabel, weekdayLabel, and ageDisplay infer safe relative labels only when unambiguous', () => {
    assert.equal(relativeTimeLabel('2026/11/14 08:00', '2026/11/14 22:00'), '今天');
    assert.equal(relativeTimeLabel('2026/11/13', '2026/11/14'), '昨天');
    assert.equal(relativeTimeLabel('2026/11/12', '2026/11/14'), '前天');
    assert.equal(relativeTimeLabel('2026/11/06', '2026/11/14'), '上周五');
    assert.equal(relativeTimeLabel('2025/11/10', '2026/11/14'), '去年11月10日');
    assert.equal(relativeTimeLabel('2026/11/15', '2026/11/14'), '明天');

    assert.equal(weekdayLabel('2026/11/14 12:00'), '周六');
    assert.equal(weekdayLabel('庆历十五年八月初七'), '');
    assert.equal(relativeTimeLabel('庆历十五年八月初一', '庆历十五年八月初七'), '6天前');

    assert.equal(calculateRelativeDays('霜月3日', '霜月8日'), 5);
    assert.equal(calculateRelativeDays('霜月3日', '雪月8日'), null);

    assert.equal(ageDisplay('20岁', '2024/05/01', '2024/11/01'), '20岁');
    assert.equal(ageDisplay('20岁', '2024/05/01', '2026/11/01'), '约22岁(2024年时20岁)');
    assert.equal(ageDisplay('二十出头', '2024/05/01', '2026/11/01'), '二十出头(2024年时)');
});

test('formatRelativeStoryRange and latestStoryTime render leaf vs compressed spans and find clock anchor', () => {
    const leaf = formatRelativeStoryRange({ timeEnd: '2026/11/13 18:00' }, '2026/11/14 20:00');
    assert.equal(leaf, '(昨天·周五) 2026/11/13 18:00');

    const comp = formatRelativeStoryRange({
        timeStart: '2026/11/10',
        timeEnd: '2026/11/12',
        isCompressed: true,
    }, '2026/11/14');
    assert.equal(comp, '2026/11/10(4天前·周二) - 2026/11/12(前天·周四)');

    assert.equal(latestStoryTime(
        { json: { storyRecords: [{ id: 'clock', kind: 'clock', label: '庆历四年秋', date: '2026-11-14' }] } },
        null,
    ), '2026-11-14');
    assert.equal(latestStoryTime({}, [{ mes: '正文<bbs_end>2026/11/15 09:00</bbs_end>' }]), '2026/11/15 09:00');
});
