import { memoryDigest } from '../story-summary/data/memory-policy.js';
import { protagonistIdentity } from '../story-state/protagonist-identity.js';
import { applyWorldStoryProposal } from './world-story-state.js';
import { parseStoryUpdates } from '../story-state/records.js';
import { invariant } from './domain.js';
import { resolveSourceQuote } from './json-response.js';

export const taskDefinitions = {
    memory: ['逐楼摘要', '交付 summary（本轮经过，非空文本，综合主楼正文与同楼后台正文）及 memoryTags（characters、locations、times、keywords 短文本数组）。'],
    overview: ['主角物品栏', '记录主角的钱物。成交用 trade，direction=buy/sell、item、counterparty、quantity（成交数量，单件为1）、price（实际收付的金币总数）、paymentQuote（主楼正文或紧邻玩家发言里的逐字付款依据）。先报价尚未成交不能入账，后台正文不能触发主角交易或扣款。赊购、赠送、暂存和归还只登记已发生的交接，可登记欠款或归还约定。'],
    people: ['人物与重要物品', '记录人物、关系、承诺、知情及具有后续行动、承诺或物证意义的物品。新物品用 importance 引用其剧情意义。用 owner、保管人、使用人分别表示归属，无据留空。'],
    places: ['地点记录', '按原文记录地点、上下级、位置与已证实的通行状态（「通行状态」可为「已封锁」或「可通行」）。'],
    situation: ['局势记录', '记录已发生的局势、计划和时钟，区分意图与事实。'],
    suspense: ['悬念', '只记录或更新有依据的悬念。'],
    simulation: ['世界推演', '基于当前世界状态、前情摘要与本轮主楼正文，生成独立非形式化「后台正文」作为主楼的幕后与环境延伸。若命中人物、组织、局势或地点条件，着重写幕后人物动向与局势演进；无特殊条件命中时，按街头见闻频率写自然的生活风味、环境流动或路人传闻。严禁替主角做决定或交易。'],
};

const fieldTasks = {
    overview: ['person', 'item'],
    people: ['person', 'organization', 'item'],
    places: ['place'],
};

const storyTasks = {
    people: ['person', 'plan', 'goal', 'knowledge'],
    overview: ['plan', 'goal'],
    situation: ['situation', 'clock'],
    suspense: ['suspense'],
};

export const actionProtocol = `返回 JSON。每项变化在 changes 数组中给出 task、group（相互依赖的变化共用）、floor（从零计）、quote（本轮逐字依据，常规记录可出自当楼主正文、紧邻玩家发言或同楼后台正文）、nature（established_fact/belief/intention/rumor/hypothesis）。不明确的标 uncertain:true。type=create 用 ref（本组临时名）、kind、name；type=set 用 target、field、value；引用实体的值写 {entityId:编号或临时名}。type=story 用 record，含稳定 id 和 kind（person、plan、goal、situation、knowledge、suspense、clock），人物用 name/presence，认知用 person/content，事项用 title/description/status/holders。沿用已存在的实体编号。无变化返回空数组。`;

const chineseDigits = '零一二三四五六七八九';
function numeral(value) {
    if (/^\d+$/.test(value)) return Number(value);
    let total = 0, digit = 0;
    for (const c of value.replaceAll('两', '二')) {
        if (chineseDigits.includes(c)) digit = chineseDigits.indexOf(c);
        else { total += (digit || 1) * ({ 十: 10, 百: 100, 千: 1000 }[c] || 0); digit = 0; }
    }
    return total + digit;
}

export function paidPrice(quote) {
    const amounts = [...String(quote).matchAll(/(?:支付|实付|实收|付清|付了?|交付|递出|递给[^，。]{0,6}?|收下|收了?|收到|找回|用|花了?)\s*([0-9零一二两三四五六七八九十百千]+)\s*(?:枚|个|金|钱|币)/gu)].map(match => numeral(match[1]));
    const unique = [...new Set(amounts)];
    return unique.length === 1 ? unique[0] : null;
}

function involvesHero(source, hero, playerName) {
    const actors = [playerName, hero.name, ...(hero.aliases || []), '主角', '你', '我'].filter(Boolean);
    const actions = /^(?:(?:当场|已经|刚刚|直接|愿意|想要|想|要|又|亲手)\s*){0,3}(?:(?:把|将|向|从)[^，。！？]{1,16}?(?:买|卖|交给|支付|收取)|付|交付|递出|递给|买|购|卖|出售|售出|收款|收下|收钱|实付|实收|拿出|掏出|花费|用[^，。！？]{1,12}买)/u;
    return source.messages.some(message => {
        if (message.role === 'user' && actions.test(message.text.trim())) return true;
        return actors.some(name => message.text.split(name).slice(1).some(tail => actions.test(tail.trim()))
            || ['卖给', '买自', '交给', '交付给', '递给', '付给', '交到'].some(verb => message.text.includes(verb + name)));
    });
}

function evidence(change, source, backgroundSource = null) {
    const mainText = source.messages.find(row => row.floor === change.floor)?.text;
    const mainQuote = resolveSourceQuote(mainText, change?.quote, { maxLength: 1200 });
    if (mainQuote) return mainQuote;
    // WHY: Protagonist trades / coin deductions remain strictly confined to main prose + adjacent user input,
    // while general facts/events treat settled floor background prose as same-class floor material.
    if (change?.type !== 'trade' && backgroundSource && backgroundSource.floor === change.floor) {
        const bgQuote = resolveSourceQuote(backgroundSource.text, change?.quote, { maxLength: 1200 });
        if (bgQuote) return bgQuote;
    }
    invariant(false, '引文无法在本轮核对');
}

function findQuoteAcrossFloor(raw, source, backgroundSource = null) {
    if (!raw) return null;
    for (const message of source.messages) {
        const hit = resolveSourceQuote(message.text, raw);
        if (hit) return hit;
    }
    if (backgroundSource?.text) {
        const hit = resolveSourceQuote(backgroundSource.text, raw);
        if (hit) return hit;
    }
    return null;
}

export function turnActionGroups(changes, keys) {
    invariant(Array.isArray(changes) && changes.length <= 200, '本轮变化清单无效');
    const groups = new Map();
    for (const [index, row] of changes.entries()) {
        if (!keys.includes(row?.task)) continue;
        const group = String(row.group || index);
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(row);
    }
    return [...groups.entries()].map(([id, rows]) => ({ id, rows }));
}

export function turnOperations(state, rows, { source, backgroundSource = null, playerName, effectId, commandId, omitted = [] }) {
    const entities = [...state.entities], operations = [], refs = new Map();
    const { hero } = protagonistIdentity(entities, playerName);
    const resolve = (ref, allowedKinds = null) => {
        const mappedId = refs.get(ref);
        let candidates = mappedId
            ? entities.filter(e => e.id === mappedId)
            : entities.filter(e => e.id === ref || [e.name, ...(e.aliases || [])].includes(ref));
        if (allowedKinds?.length) {
            const narrowed = candidates.filter(e => allowedKinds.includes(e.kind));
            if (narrowed.length) candidates = narrowed;
        }
        if (candidates.length === 1 && !omitted.includes(candidates[0].id)) {
            return candidates[0];
        }
        const selectable = candidates.filter(e => !omitted.includes(e.id));
        const error = new Error('对象不唯一或字段未提供');
        if (selectable.length > 1) {
            error.ambiguity = {
                ref: String(ref),
                candidates: selectable.map(e => ({ id: e.id, name: e.name, kind: e.kind })),
            };
        }
        throw error;
    };
    let storyTouched = false;
    const story = { ...state, modules: { ...state.modules } };
    for (const row of [...rows].sort((a, b) => Number(b.type === 'create') - Number(a.type === 'create'))) {
        const quote = evidence(row, source, backgroundSource);
        const label = quote;
        const provenance = { module: 'turn-update', key: effectId, label: '第 ' + (row.floor + 1) + ' 楼 · ' + label,
            task: row.task, proof: { floor: row.floor, quote } };
        const allowed = fieldTasks[row.task] || [];
        if (row.type === 'create') {
            invariant(allowed.includes(row.kind) && row.ref && !refs.has(row.ref) && typeof row.name === 'string' && row.name.trim(), '新对象的类型或临时引用无效');
            invariant(Boolean(resolveSourceQuote(quote, row.name)), '原文未确认新对象称呼');
            const rawImportance = typeof row.importance === 'string' ? row.importance.trim() : '';
            const importance = rawImportance ? findQuoteAcrossFloor(rawImportance, source, backgroundSource) : null;
            if (row.kind === 'item' && row.task !== 'overview') invariant(Boolean(importance), '物品缺少可核对的剧情意义');
            const matching = entities.filter(e => e.kind === row.kind && [e.name, ...(e.aliases || [])].includes(row.name));
            invariant(matching.length <= 1, '有多个同称对象，已跳过歧义创建');
            const id = matching[0]?.id || 'object:' + memoryDigest([state.worldId, effectId, row.ref]);
            const shouldCreate = !matching.length;
            refs.set(row.ref, id);
            if (shouldCreate) {
                entities.push({ id, kind: row.kind, name: row.name, aliases: [], fields: {} });
                operations.push({ type: 'create', id, kind: row.kind, name: row.name, source: provenance });
                const createNature = row.uncertain
                    ? (row.nature && row.nature !== 'established_fact' ? row.nature : 'hypothesis')
                    : (row.nature || 'established_fact');
                if (createNature !== 'established_fact') {
                    operations.push({ type: 'claim', id: 'claim:' + memoryDigest([effectId, id, '存在']), entityId: id, field: '存在', value: true, nature: createNature, source: provenance });
                }
                if (row.kind === 'item' && importance) {
                    operations.push(createNature === 'established_fact'
                        ? { type: 'set', entityId: id, field: '剧情意义', value: importance, source: provenance }
                        : { type: 'claim', id: 'claim:' + memoryDigest([effectId, id, '剧情意义']), entityId: id, field: '剧情意义', value: importance, nature: createNature, source: provenance });
                }
            }
        } else if (row.type === 'trade') {
            // DO NOT inspect backgroundSource here: trades and coin deductions belong strictly to main/user prose.
            invariant(!row.uncertain, '交易依据存在疑问，跳过自动扣款');
            const paymentQuote = typeof row.paymentQuote === 'string'
                ? source.messages.map(m => resolveSourceQuote(m.text, row.paymentQuote)).find(Boolean)
                : null;
            const amount = paymentQuote ? paidPrice(paymentQuote) : null;
            const price = row.price;
            const item = resolve(row.item, ['item']), peer = resolve(row.counterparty, ['person', 'organization']);
            invariant(row.task === 'overview' && hero && ['buy', 'sell'].includes(row.direction) && peer.id !== hero.id, '请核对主角和交易方向');
            invariant(involvesHero(source, hero, playerName), '引文未确认主角参加本次买卖');
            invariant(Boolean(paymentQuote) && amount !== null && amount === price, '成交价与实付或实收依据不一致');
            invariant(!/才卖|开价|考虑|报价|想要|愿意|打算|尚未|如果|要价/.test(quote) || /收下|交给|交付|成交|买下|卖出|交铃|实付|实收/.test(quote), '仅有报价未成交');
            invariant(source.messages.some(m => m.role === 'assistant' && /交给|交付|递给|收[下到]|成交|买下|卖出|交[出铃货]|售出|实付|实收/.test(m.text)), '角色回复未确认成交');
            if (row.quantity > 1) {
                const amounts = [...quote.matchAll(/([0-9零一二两三四五六七八九十百千]+)\s*(?:枚|件|把|个|只|份|袋|组|箱|本|支|瓶|块|根|套)/gu)];
                invariant(amounts.some(match => numeral(match[1]) === row.quantity && !/^(金币|银币|铜币|钱)/.test(quote.slice(match.index + match[0].length))),
                    '原文未明确本次成交数量');
            }
            operations.push({ type: 'purchase', heroId: hero.id, buyerId: row.direction === 'buy' ? hero.id : peer.id,
                sellerId: row.direction === 'buy' ? peer.id : hero.id, itemId: item.id, quantity: row.quantity ?? 1, price, source: provenance });
        } else if (row.type === 'story') {
            invariant(storyTasks[row.task]?.includes(row.record?.kind), '该功能不能改写这类剧情记录');
            const record = parseStoryUpdates([row.record], { requireHolders: true })[0];
            const storyNature = row.uncertain
                ? (row.nature && row.nature !== 'established_fact' ? row.nature : 'hypothesis')
                : (row.nature || 'established_fact');
            const change = applyWorldStoryProposal(story, { record, nature: storyNature }, provenance, state.version + 1, 'event:' + commandId, effectId + '/' + record.id, source);
            story.modules.story = change.value;
            storyTouched = true;
        } else {
            invariant(row.type === 'set' && typeof row.field === 'string', '不支持的变化类型');
            const entity = resolve(row.target, allowed), field = row.field;
            invariant(allowed.includes(entity.kind) && !['coins', '金币', '余额', '钱包'].includes(field), '钱包变动须通过主角交易核算');
            invariant(row.task !== 'overview' || entity.kind === 'item' || entity.id === hero?.id, '物品栏只维护主角的收支');
            const valueKinds = ['location', 'parent', '所在地', '上级地点'].includes(field) ? ['place']
                : ['owner', '归属', '保管人', '使用人'].includes(field) || field.startsWith('关系:') ? ['person', 'organization']
                    : null;
            const value = row.value?.entityId ? { entityId: resolve(row.value.entityId, valueKinds).id } : row.value;
            if (row.task === 'overview' && ['owner', '归属', '保管人', '使用人'].includes(field)) {
                invariant(hero && [value?.entityId, entity.fields[field]?.value?.entityId, entity.fields.owner?.value?.entityId].includes(hero.id), '该项交接与主角无关');
            }
            if (entity.kind === 'item' && row.task === 'people') {
                const important = ['剧情意义', 'importance', '归还条件', '归还约定', '保管人', '使用人', '物证', '重要性'].some(key => entity.fields[key]?.value)
                    || rows.some(action => action.type === 'create' && action.importance && refs.get(action.ref) === entity.id)
                    || rows.some(action => action.target === row.target && ['保管人', '使用人', '归还条件', '剧情意义', '物证'].includes(action.field));
                invariant(important, '物品缺少剧情意义');
            }
            const nature = row.uncertain
                ? (row.nature && row.nature !== 'established_fact' ? row.nature : 'hypothesis')
                : (row.nature || 'established_fact');
            operations.push(nature === 'established_fact'
                ? { type: 'set', field, value, entityId: entity.id, source: provenance }
                : { type: 'claim', id: 'claim:' + memoryDigest([effectId, entity.id, field]), entityId: entity.id, field, value, nature, source: provenance });
        }
    }
    if (storyTouched) operations.push({ type: 'module', module: 'story', value: story.modules.story });
    return operations;
}
