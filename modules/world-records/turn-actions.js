import { memoryDigest } from '../story-summary/data/memory-policy.js';
import { protagonistIdentity } from '../story-state/protagonist-identity.js';
import { applyWorldStoryProposal } from './world-story-state.js';
import { parseStoryUpdates } from '../story-state/records.js';
import { createEmptyMapDomain } from '../xiaobai-os/domains/map/state.js';
import { invariant } from './domain.js';
import { resolveSourceQuote } from './json-response.js';

const mapScales = new Set(['world','region','city','district','building','floor','room','outdoor']);
const mapLinkKinds = new Set(['door','stairs','elevator','path','road','portal','passage']);
const mapLocationFields = ['location','所在地','位置','当前地点'];
const normName = value => String(value ?? '').trim().normalize('NFKC').toLowerCase();

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
    places: ['place', 'route'],
};

const storyTasks = {
    people: ['person', 'plan', 'goal', 'knowledge'],
    overview: ['plan', 'goal'],
    situation: ['situation', 'clock'],
    suspense: ['suspense'],
};

export const actionProtocol = `返回 JSON 对象。summary 写本轮摘要；memoryTags 写 characters、locations、times、keywords 短文本数组；buckets 按 overview、people、places、situation、suspense 分桶，每个桶内是变化数组。也可把所有变化放进 changes 数组并用 task 标明所属桶，两种写法择一。
每个变化给出 task、group（相互依赖的变化共用）、floor（0 起始，省略时按本轮末楼）、quote（能核对时写本轮逐字依据；普通人物/地点/局势/悬念允许省略）、nature（established_fact/belief/intention/rumor/hypothesis）、uncertain（不确定时 true）。
type=create 用 ref（本组临时名）、kind、name；type=set 用 target、field、value；引用实体写 {entityId:编号或临时名}。type=story 用 record，含稳定 id 和 kind（person、plan、goal、situation、knowledge、suspense、clock）；已有事项优先沿用名册中的 p1/s1 短编号作为 id。type=link 用 from、to、kind（door/stairs/elevator/path/road/portal/passage）、label、bidirectional，只用于连接两个地点。主角买卖只能用 type=trade，并给 direction、item、counterparty、quantity、price、paymentQuote（主楼正文或紧邻玩家发言的逐字付款依据）；后台正文不能触发交易或扣款。
示范：{"summary":"……","memoryTags":{"characters":["店主"],"locations":["酒馆"],"times":["黄昏"],"keywords":["钥匙"]},"buckets":{"people":[{"task":"people","group":"g1","floor":1,"quote":"店主递出铜钥匙","nature":"established_fact","type":"create","ref":"shop","kind":"person","name":"店主"},{"task":"people","group":"g1","type":"set","target":"shop","field":"当前情绪","value":"警惕"}],"places":[{"task":"places","type":"create","ref":"yard","kind":"place","name":"后院","scale":"outdoor","parent":"青竹酒馆"},{"task":"places","type":"link","from":"青竹酒馆","to":"后院","kind":"door","label":"后门"}],"situation":[{"task":"situation","type":"story","record":{"id":"gate-watch","kind":"situation","title":"城门盘查","description":"守卫逐人验看路引","status":"open","reason":""}}],"suspense":[{"task":"suspense","type":"story","record":{"id":"s1","kind":"suspense","title":"钥匙的来历","description":"店主不愿说明铜钥匙来自何处","status":"open","reason":""}}]}}
无变化时 buckets 为空对象或返回空数组。`;

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

export function actionRows(result) {
    if (Array.isArray(result?.changes)) return result.changes;
    if (result?.buckets && typeof result.buckets === 'object' && !Array.isArray(result.buckets)) {
        return Object.entries(result.buckets).flatMap(([task, rows]) =>
            Array.isArray(rows) ? rows.map(row => row && typeof row === 'object' && !row.task ? { ...row, task } : row) : []);
    }
    return [];
}

function evidence(change, source, backgroundSource = null) {
    const floor = Number.isInteger(change?.floor) ? change.floor : source.end;
    const mainText = source.messages.find(row => row.floor === floor)?.text;
    const mainQuote = resolveSourceQuote(mainText, change?.quote, { maxLength: 1200 });
    if (mainQuote) return { floor, quote:mainQuote };
    // WHY: Protagonist trades / coin deductions remain strictly confined to main prose + adjacent user input,
    // while general facts/events treat settled floor background prose as same-class floor material.
    if (change?.type !== 'trade' && backgroundSource) {
        const bgQuote = resolveSourceQuote(backgroundSource.text, change?.quote, { maxLength: 1200 });
        if (bgQuote) return { floor: backgroundSource.floor, quote:bgQuote };
    }
    // Ordinary world changes no longer require a verbatim quote or a zero-based floor number.
    // Trades keep the hard evidence gate below; other rows receive a readable provenance label.
    if (change?.type === 'trade') invariant(false, '引文无法在本轮核对');
    return { floor, quote:'' };
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

export function turnOperations(state, rows, { source, backgroundSource = null, playerName, effectId, commandId, omitted = [], storyRefs = {} }) {
    const entities = [...state.entities], operations = [], refs = new Map();
    const { hero } = protagonistIdentity(entities, playerName);
    const map = structuredClone(state.modules?.map || createEmptyMapDomain());
    let mapDirty = false;
    const placeBinding = entity => {
        for (const binding of entity?.bindings || []) {
            if (typeof binding !== 'string' || !binding.startsWith('["map","place:')) continue;
            let parsed;
            try { parsed = JSON.parse(binding); } catch { continue; }
            const key = parsed[1];
            if (typeof key === 'string' && key.startsWith('place:')) return key.slice(6);
        }
        return '';
    };
    const ensureLocation = entity => {
        if (!entity || entity.kind !== 'place') return null;
        const bound = placeBinding(entity);
        let location = map.atlas.locations.find(item => item.key === bound);
        if (!location) location = map.atlas.locations.find(item => normName(item.name) === normName(entity.name));
        if (!location) {
            const base = 'loc:' + entity.id;
            let key = base, suffix = 2;
            while (map.atlas.locations.some(item => item.key === key)) key = base + ':' + suffix++;
            location = { key, name:entity.name, scale:'outdoor', status:'mentioned' };
            map.atlas.locations.push(location);
            mapDirty = true;
        }
        const binding = JSON.stringify(['map','place:'+location.key]);
        if (!(entity.bindings || []).includes(binding)) {
            entity.bindings = [...(entity.bindings || []), binding];
            operations.push({ type:'bind', entityId:entity.id, binding });
        }
        return location;
    };
    const anchorActor = (entity, location) => {
        if (!entity || !location || entity.kind !== 'person') return;
        const existing = (entity.bindings || []).find(binding => typeof binding === 'string' && binding.startsWith('["map","actor:'));
        let actorKey = '';
        if (existing) { try { actorKey = JSON.parse(existing)[1].slice(6); } catch { actorKey = ''; } }
        if (!actorKey) actorKey = normName(entity.name) === normName(playerName) ? 'player' : 'actor:' + entity.id;
        const actor = map.atlas.actors.find(item => item.actorKey === actorKey);
        if (actor) actor.locationKey = location.key;
        else map.atlas.actors.push({ actorKey, displayName:entity.name, locationKey:location.key });
        const binding = JSON.stringify(['map','actor:'+actorKey]);
        if (!(entity.bindings || []).includes(binding)) {
            entity.bindings = [...(entity.bindings || []), binding];
            operations.push({ type:'bind', entityId:entity.id, binding });
        }
        mapDirty = true;
    };
    const updatePlace = (entity, field, value) => {
        const location = ensureLocation(entity);
        if (!location) return;
        if (['parent','上级地点'].includes(field)) {
            const target = value?.entityId ? entities.find(item => item.id === value.entityId) : null;
            const targetLocation = target?.kind === 'place' ? ensureLocation(target) : null;
            if (targetLocation && targetLocation.key !== location.key) location.parent = targetLocation.key;
        } else if (['description','描述','简介'].includes(field)) {
            location.brief = String(value ?? '').replace(/\s+/gu, ' ').slice(0, 2000);
        } else if (['scale','类型'].includes(field)) {
            if (mapScales.has(value)) location.scale = value;
        } else if (['通行状态','通行'].includes(field)) {
            const text = String(value ?? '').trim();
            if (text) {
                const cleaned = location.brief?.replace(/(?:^|；)通行状态：[^；]*/u, '') || '';
                location.brief = [cleaned, '通行状态：' + text].filter(Boolean).join('；');
            }
        } else if (/^特征[/:：]/u.test(field)) {
            const name = field.replace(/^特征[/:：]/u, '').trim();
            if (name && value != null) {
                const features = location.features ??= [];
                const feature = features.find(item => (typeof item === 'string' ? item : item.name) === name);
                if (typeof feature === 'string') features[features.indexOf(feature)] = { name, description:String(value) };
                else if (feature) feature.description = String(value);
                else features.push({ name, description:String(value) });
            }
        }
        mapDirty = true;
    };
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
        const proof = evidence(row, source, backgroundSource);
        const quote = proof.quote;
        const label = quote || [row.name, row.record?.title, row.field].filter(value => typeof value === 'string' && value.trim()).join(' · ') || '本轮记录';
        const provenance = { module: 'turn-update', key: effectId, label: '第 ' + (proof.floor + 1) + ' 楼 · ' + label,
            task: row.task, ...(quote ? { proof: { floor: proof.floor, quote } } : {}) };
        const allowed = fieldTasks[row.task] || [];
        if (row.type === 'create') {
            invariant(allowed.includes(row.kind) && row.ref && !refs.has(row.ref) && typeof row.name === 'string' && row.name.trim(), '新对象的类型或临时引用无效');
            if (row.kind === 'item') invariant(Boolean(resolveSourceQuote(quote, row.name)), '原文未确认新对象称呼');
            invariant(row.kind !== 'route', '地点通道请使用 type=link');
            const rawImportance = typeof row.importance === 'string' ? row.importance.trim() : '';
            const importance = rawImportance ? findQuoteAcrossFloor(rawImportance, source, backgroundSource) : null;
            if (row.kind === 'item' && row.task !== 'overview') invariant(Boolean(importance), '物品缺少可核对的剧情意义');
            const matching = entities.filter(e => e.kind === row.kind && [e.name, ...(e.aliases || [])].includes(row.name));
            invariant(matching.length <= 1, '有多个同称对象，已跳过歧义创建');
            const id = matching[0]?.id || 'object:' + memoryDigest([state.worldId, effectId, row.ref]);
            const shouldCreate = !matching.length;
            refs.set(row.ref, id);
            if (shouldCreate) {
                const created = { id, kind: row.kind, name: row.name, aliases: [], fields: {}, bindings: [] };
                entities.push(created);
                operations.push({ type: 'create', id, kind: row.kind, name: row.name, source: provenance });
                if (row.kind === 'place') {
                    const location = ensureLocation(created);
                    if (location && mapScales.has(row.scale)) location.scale = row.scale;
                }
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
        } else if (row.type === 'link') {
            invariant(row.task === 'places', '通道只能写在地点记录');
            const from = resolve(row.from, ['place']), to = resolve(row.to, ['place']);
            invariant(from.id !== to.id, '通道两端必须是不同地点');
            const fromLocation = ensureLocation(from), toLocation = ensureLocation(to);
            const kind = mapLinkKinds.has(row.kind) ? row.kind : 'path';
            invariant(fromLocation && toLocation, '通道端点缺少地图地点');
            const id = 'link:' + memoryDigest([fromLocation.key, toLocation.key, kind, row.label || '']);
            if (!map.atlas.links.some(link => link.id === id)) {
                map.atlas.links.push({ id, from:fromLocation.key, to:toLocation.key, kind, bidirectional:row.bidirectional !== false,
                    ...(typeof row.label === 'string' && row.label.trim() ? { label:row.label.trim().slice(0,160) } : {}) });
            }
            mapDirty = true;
        } else if (row.type === 'story') {
            invariant(storyTasks[row.task]?.includes(row.record?.kind), '该功能不能改写这类剧情记录');
            const inputRecord = row.record && typeof row.record === 'object'
                ? { ...row.record, ...(storyRefs[row.record.id] ? { id:storyRefs[row.record.id] } : {}) }
                : row.record;
            const record = parseStoryUpdates([inputRecord], { requireHolders: true })[0];
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
            if (entity.kind === 'place') updatePlace(entity, field, value);
            else if (entity.kind === 'person' && mapLocationFields.includes(field) && value?.entityId) {
                const place = entities.find(item => item.id === value.entityId);
                if (place?.kind === 'place') anchorActor(entity, ensureLocation(place));
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
    if (mapDirty) operations.push({ type: 'module', module: 'map', value: { ...map, revision: state.version + 1 } });
    return operations;
}
