import { memoryDigest } from '../story-summary/data/memory-policy.js';
import { protagonistIdentity } from '../story-state/protagonist-identity.js';
import { applyWorldStoryProposal } from './world-story-state.js';
import { parseStoryUpdates } from '../story-state/records.js';
import { invariant } from './domain.js';

export const taskDefinitions = {
    memory: ['逐楼摘要', '只交付 summary（本轮经过，非空文本）及 memoryTags（characters、locations、times、keywords 短文本数组）。'],
    overview: ['主角物品栏', '记录主角的钱物。成交用 trade，direction=buy/sell、item、counterparty、quantity（成交数量，单件为1）、price（实际收付的金币总数）、paymentQuote（逐字付款依据）。先报价尚未成交不能入账。赊购、赠送、暂存和归还只登记已发生的交接，可登记欠款或归还约定。'],
    people: ['人物与重要物品', '记录人物、关系、承诺、知情及具有后续行动、承诺或物证意义的物品。新物品用 importance 引用其剧情意义。用 owner、保管人、使用人分别表示归属，无据留空。'],
    places: ['地点记录', '按原文记录地点、上下级、位置和已证实的通行状态。'],
    situation: ['局势记录', '记录已发生的局势、计划和时钟，区分意图与事实。'],
    suspense: ['悬念', '只记录或更新有依据的悬念。'],
    clues: ['剧情线', '返回 plotLines 数组。每条包含 id（既有线复用）、title、question、status（active/potential/closed）、reading、quote（本轮逐字引文）、floor（从零计）、characters、relatedIds。同一问题有直接因果联系时沿用编号，可改名；可独立结案的另建并关联。'],
    peopleEvolution: ['人物动向', '推演命中人物的行动。知识写为有明确持有人的 knowledge，不能共享未知消息。'],
    subscribed: ['局势推演', '推进与本轮相关或到期的局势。已发生的结果写入事实，单纯计划只记 intention。'],
    sceneryEvolution: ['风物推演', '推进已到访或到期的风物，保留生效地点。'],
    encounter: ['街头见闻', '只在命中的公开场所生成见闻。'],
    mapEvolution: ['地图推演', '更新有依据的地点和通路。地点的通行状态用字段「通行状态」，值为「已封锁」或「可通行」。'],
};
const fieldTasks = {
    overview: ['person', 'item'], people: ['person', 'organization', 'item'], places: ['place'],
    peopleEvolution: ['person', 'item'], subscribed: ['place', 'organization'], mapEvolution: ['place'], sceneryEvolution: ['place'], encounter: ['place'],
};
const storyTasks = { people: ['person', 'plan', 'goal', 'knowledge'], overview: ['plan', 'goal'], situation: ['situation', 'clock'], suspense: ['suspense'],
    peopleEvolution: ['person', 'knowledge', 'plan', 'goal'], subscribed: ['situation', 'plan'], sceneryEvolution: ['situation'], encounter: ['situation'] };
const simulation = new Set(['peopleEvolution', 'subscribed', 'sceneryEvolution', 'encounter', 'mapEvolution']);
export const actionProtocol = `返回 JSON。每项变化在 changes 数组中给出 task、group（相互依赖的变化共用）、floor（从零计）、quote（本轮逐字依据）、nature（established_fact/belief/intention/rumor）。不明确的标 uncertain:true。type=create 用 ref（本组临时名）、kind、name；type=set 用 target、field、value；引用实体的值写 {entityId:编号或临时名}。type=story 用 record，含稳定 id 和 kind（person、plan、goal、situation、knowledge、suspense、clock），人物用 name/presence，认知用 person/content，事项用 title/description/status/holders。沿用已存在的实体编号。推演另给 result 说明结果及 knownBy（知情人编号数组）。无变化返回空数组。`;
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
    const actors = [playerName,hero.name,...(hero.aliases || []),'主角','你','我'].filter(Boolean);
    const actions = /^(?:(?:当场|已经|刚刚|直接|愿意|想要|想|要|又|亲手)\s*){0,3}(?:(?:把|将|向|从)[^，。！？]{1,16}?(?:买|卖|交给|支付|收取)|付|交付|递出|递给|买|购|卖|出售|售出|收款|收下|收钱|实付|实收|拿出|掏出|花费|用[^，。！？]{1,12}买)/u;
    return source.messages.some(message => {
        if (message.role === 'user' && actions.test(message.text.trim())) return true;
        return actors.some(name => message.text.split(name).slice(1).some(tail => actions.test(tail.trim()))
            || ['卖给','买自','交给','交付给','递给','付给','交到'].some(verb => message.text.includes(verb+name)));
    });
}
function evidence(change, source) {
    const text = source.messages.find(row => row.floor === change.floor)?.text;
    invariant(typeof change.quote === 'string' && change.quote.trim() && change.quote.length <= 1200 && text?.includes(change.quote), '引文无法在本轮核对');
    return change.quote;
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
export function turnOperations(state, rows, { source, playerName, effectId, commandId, reviewed = false, omitted = [] }) {
    const entities = [...state.entities], operations = [], refs = new Map();
    const { hero } = protagonistIdentity(entities, playerName);
    const resolve = ref => {
        const candidates = entities.filter(e => e.id === (refs.get(ref) || ref) || [e.name, ...(e.aliases || [])].includes(ref));
        invariant(candidates.length === 1 && !omitted.includes(candidates[0].id), '对象不唯一或字段未提供，请核对身份');
        return candidates[0];
    };
    let storyTouched = false;
    const story = { ...state, modules: { ...state.modules } };
    for (const row of [...rows].sort((a, b) => Number(b.type === 'create') - Number(a.type === 'create'))) {
        const quote = evidence(row, source), sim = simulation.has(row.task);
        invariant(reviewed || !row.uncertain, '依据尚不明确，请核对');
        const label = sim ? String(row.result || '').trim() : quote;
        invariant(!sim || label && label.length <= 1600 && Array.isArray(row.knownBy) && row.knownBy.every(ref => resolve(ref).kind === 'person'), '推演须说明结果和知情范围');
        const provenance = { module: sim ? 'simulation' : 'turn-update', key: effectId, label: '第 ' + (row.floor + 1) + ' 楼 · ' + label,
            task:row.task, proof:{floor:row.floor,quote}, ...(sim && { knownBy: row.knownBy.map(ref => resolve(ref).id) }) };
        const allowed = fieldTasks[row.task] || [];
        if (row.type === 'create') {
            invariant(allowed.includes(row.kind) && row.ref && !refs.has(row.ref) && typeof row.name === 'string' && row.name.trim(), '新对象的类型或临时引用无效');
            invariant(sim || quote.includes(row.name), '原文未确认新对象称呼');
            if (row.kind === 'item' && row.task !== 'overview') invariant(typeof row.importance === 'string' && row.importance.trim() && source.messages.some(m => m.text.includes(row.importance)), '请核对物品的剧情意义');
            const matching = entities.filter(e => e.kind === row.kind && [e.name, ...(e.aliases || [])].includes(row.name));
            invariant(matching.length <= 1, '有多个同称对象，请核对');
            const id = matching[0]?.id || 'object:' + memoryDigest([state.worldId, effectId, row.ref]);
            refs.set(row.ref, id);
            if (!matching.length) {
                entities.push({ id, kind: row.kind, name: row.name, aliases: [], fields: {} });
                operations.push({ type: 'create', id, kind: row.kind, name: row.name, source: provenance });
                if (row.kind === 'item' && row.importance) operations.push({type:'set',entityId:id,field:'剧情意义',value:row.importance,source:provenance});
            }
        } else if (row.type === 'trade') {
            const amount = paidPrice(row.paymentQuote);
            const price = reviewed && amount !== null ? amount : row.price;
            const item = resolve(row.item), peer = resolve(row.counterparty);
            invariant(row.task === 'overview' && hero && ['buy', 'sell'].includes(row.direction) && peer.id !== hero.id, '请核对主角和交易方向');
            invariant(involvesHero(source,hero,playerName),'引文未确认主角参加本次买卖，请核对交易双方');
            invariant(typeof row.paymentQuote === 'string' && source.messages.some(m => m.text.includes(row.paymentQuote)) && amount !== null && amount === price, '成交价与实付或实收依据不一致');
            invariant(reviewed || !/才卖|开价|考虑|报价|想要|愿意|打算|尚未|如果|要价/.test(quote) || /收下|交给|交付|成交|买下|卖出|交铃|实付|实收/.test(quote), '仅有报价，请核对成交');
            invariant(source.messages.some(m => m.role === 'assistant' && /交给|交付|递给|收[下到]|成交|买下|卖出|交[出铃货]|售出|实付|实收/.test(m.text)), '角色回复未确认成交');
            if (!reviewed && row.quantity > 1) {
                const amounts = [...quote.matchAll(/([0-9零一二两三四五六七八九十百千]+)\s*(?:枚|件|把|个|只|份|袋|组|箱|本|支|瓶|块|根|套)/gu)];
                invariant(amounts.some(match => numeral(match[1]) === row.quantity && !/^(金币|银币|铜币|钱)/.test(quote.slice(match.index+match[0].length))),
                    '请核对原文中本次成交的物品数量');
            }
            operations.push({ type: 'purchase', heroId: hero.id, buyerId: row.direction === 'buy' ? hero.id : peer.id,
                sellerId: row.direction === 'buy' ? peer.id : hero.id, itemId: item.id, quantity:row.quantity ?? 1, price, source: provenance });
        } else if (row.type === 'story') {
            invariant(storyTasks[row.task]?.includes(row.record?.kind), '该功能不能改写这类剧情记录');
            const record = parseStoryUpdates([row.record], { requireHolders: true })[0];
            if (sim && record.kind === 'knowledge') invariant(row.knownBy.some(ref => {
                const person = resolve(ref); return [person.name,...(person.aliases || [])].includes(record.person);
            }), '认知记录的持有人不在本次推演的知情范围');
            const change = applyWorldStoryProposal(story, { record, nature: row.nature || 'established_fact' }, provenance, state.version + 1, 'event:' + commandId, effectId + '/' + record.id, source);
            story.modules.story = change.value;
            storyTouched = true;
        } else {
            invariant(row.type === 'set' && typeof row.field === 'string', '不支持的变化类型');
            const entity = resolve(row.target), field = row.field;
            invariant(allowed.includes(entity.kind) && !['coins', '金币','余额','钱包'].includes(field), '钱包变动须通过主角交易核算');
            invariant(row.task !== 'overview' || entity.kind === 'item' || entity.id === hero?.id, '物品栏只维护主角的收支');
            const value = row.value?.entityId ? { entityId: resolve(row.value.entityId).id } : row.value;
            if (row.task === 'overview' && ['owner','归属','保管人','使用人'].includes(field)) invariant(hero && [value?.entityId, entity.fields[field]?.value?.entityId, entity.fields.owner?.value?.entityId].includes(hero.id), '该项交接与主角无关');
            if (entity.kind === 'item' && ['people','peopleEvolution'].includes(row.task)) {
                const important = ['剧情意义','importance','归还条件','归还约定','保管人','使用人','物证','重要性'].some(key=>entity.fields[key]?.value)
                    || rows.some(action=>action.type==='create' && action.importance && refs.get(action.ref)===entity.id)
                    || rows.some(action=>action.target===row.target && ['保管人','使用人','归还条件','剧情意义','物证'].includes(action.field));
                invariant(important,'请核对该物品的剧情意义');
            }
            const nature = row.nature || 'established_fact';
            operations.push(nature === 'established_fact' ? { type: 'set', field, value, entityId: entity.id, source: provenance }
                : { type: 'claim', id: 'claim:' + memoryDigest([effectId, entity.id, field]), entityId: entity.id, field, value, nature, source: provenance });
        }
    }
    if (storyTouched) operations.push({type:'module',module:'story',value:story.modules.story});
    return operations;
}
