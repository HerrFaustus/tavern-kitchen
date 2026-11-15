import assert from 'node:assert/strict';
import test from 'node:test';
import { parseJsonResponse, resolveSourceQuote } from './json-response.js';
import { parseOpening } from './opening.js';
import { turnOperations } from './turn-actions.js';

test('parseJsonResponse extracts fenced or prose-wrapped JSON and repairs safe formatting quirks', () => {
    const fencedWithProse = [
        '好的，这是本轮整理出的结果（注意 {占位} 不是 JSON）：',
        '```json',
        '{',
        '  "summary": "旅人交付了 5 枚金币，写着 \\"rec, }\\"",',
        '  "changes": [',
        '    {"task": "overview", "floor": 0,},',
        '  ],',
        '}',
        '```',
        '以上是全部更新，请查收。',
    ].join('\n');

    const parsed = parseJsonResponse(fencedWithProse);
    assert.equal(parsed.summary, '旅人交付了 5 枚金币，写着 "rec, }"');
    assert.deepEqual(parsed.changes, [{ task: 'overview', floor: 0 }]);

    const curlyWrapped = '结果如下：\n{“summary”: “她说“别去”\n快走”, “changes”: [],}';
    const curlyParsed = parseJsonResponse(curlyWrapped);
    assert.equal(curlyParsed.summary, '她说“别去”\n快走');
    assert.deepEqual(curlyParsed.changes, []);

    const validCurlyContent = '{"summary": "他说“你好”", "changes": []}';
    assert.equal(parseJsonResponse(validCurlyContent).summary, '他说“你好”');

    assert.throws(() => parseJsonResponse('这里根本没有 JSON 结构'));
});

test('resolveSourceQuote falls back only on unambiguous whitespace/curly-quote differences', () => {
    const source = '老板笑道：“拿好   这把\n长剑吧！”';
    assert.equal(
        resolveSourceQuote(source, '"拿好 这把 长剑吧！"'),
        '“拿好   这把\n长剑吧！”',
    );

    // Exact match wins even if another curly variant exists nearby.
    const dual = '他说："去吧。" 他又说：“去吧。”';
    assert.equal(resolveSourceQuote(dual, '"去吧。"'), '"去吧。"');

    // Ambiguous normalized candidates across distinct source spans are rejected.
    const ambiguous = '桥头 写着 A  B，碑文 写着 A\nB。';
    assert.equal(resolveSourceQuote(ambiguous, 'A B'), null);

    // Fabricated quotes are always rejected.
    assert.equal(resolveSourceQuote(source, '“拿好这把匕首吧！”'), null);
    assert.equal(resolveSourceQuote(source, '老板笑道：“拿好', { maxLength: 3 }), null);
});

test('parseOpening and turnOperations accept prose/fenced JSON and normalize quotes onto verbatim source spans', () => {
    const batch = [{
        id: 1,
        key: 'port',
        label: '开场',
        text: '铁匠指着摊位说：“这枚   银钥匙 能开北门。”',
    }];
    const modelReply = [
        '分析完成：',
        '```json',
        '[',
        '  {',
        '    "part": 1,',
        '    "kind": "item",',
        '    "name": "银钥匙",',
        '    "value": "能开北门的钥匙",',
        '    "importance": "\\"这枚 银钥匙 能开北门。\\"",',
        '    "quote": "铁匠指着摊位说：\\"这枚 银钥匙 能开北门。\\"",',
        '  },',
        ']',
        '```',
    ].join('\n');

    const rows = parseOpening(modelReply, batch);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].quote, '铁匠指着摊位说：“这枚   银钥匙 能开北门。”');
    assert.equal(rows[0].importance, '“这枚   银钥匙 能开北门。”');

    assert.throws(() => parseOpening(JSON.stringify([{
        part: 1,
        kind: 'item',
        name: '金钥匙',
        value: '不存在的物品',
        quote: '铁匠指着摊位说：“这枚金钥匙能开北门。”',
    }]), batch), /缺少可核对的原文/);

    const state = {
        worldId: 'w1',
        branchId: 'b1',
        version: 1,
        entities: [{ id: 'hero', kind: 'person', name: '旅人', aliases: ['主角'], fields: {} }],
        receipts: [],
        modules: {},
    };
    const source = {
        messages: [{
            floor: 0,
            role: 'assistant',
            text: '摊主笑道：“这本  旧帐簿 只卖 3 枚金币。” 旅人点头，当场支付   3 枚金币 收下摊位上的旧帐簿。',
        }],
    };
    const ops = turnOperations(state, [{
        task: 'people',
        group: 'g1',
        floor: 0,
        type: 'create',
        ref: 'ledger',
        kind: 'item',
        name: '旧帐簿',
        importance: '“这本 旧帐簿 只卖 3 枚金币。”',
        quote: '摊主笑道："这本 旧帐簿 只卖 3 枚金币。" 旅人点头，当场支付 3 枚金币 收下摊位上的旧帐簿。',
    }], {
        source,
        playerName: '旅人',
        effectId: 'e1',
        commandId: 'c1',
    });

    assert.equal(ops[0].type, 'create');
    assert.equal(ops[0].source.proof.quote, source.messages[0].text);
    assert.equal(ops[1].value, '“这本  旧帐簿 只卖 3 枚金币。”');
});
