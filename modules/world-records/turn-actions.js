import { memoryDigest } from '../story-summary/data/memory-policy.js';
import { protagonistIdentity } from '../story-state/protagonist-identity.js';
import { applyWorldStoryProposal } from './world-story-state.js';
import { parseStoryUpdates, storyDate } from '../story-state/records.js';
import { createEmptyMapDomain } from '../xiaobai-os/domains/map/state.js';
import { invariant } from './domain.js';
import { resolveSourceQuote } from './json-response.js';
import { RELATION_PREFIX } from './person-fields.js';

const mapScales = new Set(['world','region','city','district','building','floor','room','outdoor']);
const MAP_SCALE_ALIASES = {
    world: 'world', 世界: 'world',
    region: 'region', 区域: 'region', 大区: 'region',
    city: 'city', 城市: 'city', 城镇: 'city',
    district: 'district', 地区: 'district', 街区: 'district', 城区: 'district',
    building: 'building', 建筑: 'building',
    floor: 'floor', 楼层: 'floor',
    room: 'room', 房间: 'room', 室内: 'room', indoor: 'room',
    outdoor: 'outdoor', 室外: 'outdoor', 户外: 'outdoor',
};
const mapLinkKinds = new Set(['door','stairs','elevator','path','road','portal','passage']);
const mapLocationFields = ['location', '所在地', '所在位置', '位置', '当前地点', '当前位置', '所处位置', '地点'];
const IMPORTANCE_FIELDS = ['importance', '剧情意义', '重要性', '归还条件', '归还约定', '物证', 'description', '描述', '简介', '保管人', '使用人', 'owner', '归属'];
const normName = value => String(value ?? '').trim().normalize('NFKC').toLowerCase();
const entityRef = ref => (typeof ref === 'string' ? ref.trim()
    : ref && typeof ref === 'object' ? String(ref.entityId ?? ref.id ?? ref.ref ?? ref.name ?? '').trim() : '');
const normalizeScale = value => MAP_SCALE_ALIASES[normName(value)] || (mapScales.has(value) ? value : '');

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

const BUCKET_ALIASES = {
    overview: 'overview', protagonist: 'overview', hero: 'overview', items: 'overview', 主角: 'overview', 主角物品栏: 'overview',
    people: 'people', characters: 'people', npcs: 'people', person: 'people', 人物: 'people', 人物与重要物品: 'people',
    places: 'places', map: 'places', locations: 'places', place: 'places', 地点: 'places', 地图: 'places', 地点记录: 'places',
    situation: 'situation', situations: 'situation', world: 'situation', affairs: 'situation', scenery: 'situation', 局势: 'situation', 局势记录: 'situation',
    suspense: 'suspense', suspenses: 'suspense', mysteries: 'suspense', 悬念: 'suspense',
};

const STORY_KIND_SET = new Set(['person', 'plan', 'goal', 'situation', 'knowledge', 'suspense', 'clock']);
const THREAD_KINDS = new Set(['plan', 'goal', 'situation', 'suspense']);
const STATUS_ALIASES = {
    open: 'open', active: 'open', ongoing: 'open', pending: 'open', 未结: 'open', 未解决: 'open', 进行中: 'open', 持续: 'open', 开启: 'open',
    done: 'done', closed: 'done', resolved: 'done', completed: 'done', 已完成: 'done', 已解决: 'done', 已达成: 'done', 已结: 'done', 已了结: 'done',
    cancelled: 'cancelled', canceled: 'cancelled', dropped: 'cancelled', 已取消: 'cancelled', 放弃: 'cancelled',
    failed: 'failed', 已失败: 'failed', 失败: 'failed',
};
const PRESENCE_ALIASES = {
    present: 'present', 在场: 'present', 同在: 'present', 当前在场: 'present',
    nearby: 'nearby', 附近: 'nearby', 同区域: 'nearby', 邻近: 'nearby',
    away: 'away', absent: 'away', 离场: 'away', 离开: 'away', 不在场: 'away',
    unknown: 'unknown', 未知: 'unknown',
};
const BELIEF_ALIASES = {
    known: 'known', 已知: 'known', 确认: 'known', 亲见: 'known',
    believed: 'believed', 相信: 'believed', 误解: 'believed', 以为: 'believed', 听说: 'believed',
    uncertain: 'uncertain', 怀疑: 'uncertain', 不确定: 'uncertain', 猜测: 'uncertain',
};

export const actionProtocol = `返回紧凑单行 JSON 对象（勿加多余缩进或空行）。summary 写本轮摘要；memoryTags 写 characters、locations、times、keywords 短文本数组；buckets 按 overview、people、places、situation、suspense 分桶，每个桶内是变化数组。也可把所有变化放进 changes 数组并用 task 标明所属桶，两种写法择一。
每个变化给出 task、group（相互依赖的变化共用）、floor（0 起始，省略时按本轮末楼）、quote（仅主角交易、金币或关键物证需写本轮逐字依据；普通人物/地点/局势/悬念尽量省略以节省篇幅）、nature（established_fact/belief/intention/rumor/hypothesis）、uncertain（不确定时 true）。
type=create 用 ref（本组临时名）、kind、name；type=set 用 target、field、value；引用实体写 {entityId:编号或临时名}。type=story 用 record，含稳定 id 和 kind（person、plan、goal、situation、knowledge、suspense、clock）；已有事项优先沿用名册中的 p1/s1 短编号作为 id。type=link 用 from、to、kind（door/stairs/elevator/path/road/portal/passage）、label、bidirectional，只用于连接两个地点。主角买卖只能用 type=trade，并给 direction、item、counterparty、quantity、price、paymentQuote（主楼正文或紧邻玩家发言的逐字付款依据）；后台正文不能触发交易或扣款。
示范：{"summary":"……","memoryTags":{"characters":["店主"],"locations":["酒馆"],"times":["黄昏"],"keywords":["钥匙"]},"buckets":{"people":[{"task":"people","group":"g1","floor":1,"quote":"店主递出铜钥匙","nature":"established_fact","type":"create","ref":"shop","kind":"person","name":"店主"},{"task":"people","group":"g1","floor":1,"quote":"店主递出铜钥匙","type":"set","target":"shop","field":"当前情绪","value":"警惕"}],"places":[{"task":"places","type":"create","ref":"yard","kind":"place","name":"后院","scale":"outdoor","parent":"青竹酒馆"},{"task":"places","type":"link","from":"青竹酒馆","to":"后院","kind":"door","label":"后门"}],"situation":[{"task":"situation","type":"story","record":{"id":"gate-watch","kind":"situation","title":"城门盘查","description":"守卫逐人验看路引","status":"open","reason":""}}],"suspense":[{"task":"suspense","type":"story","record":{"id":"s1","kind":"suspense","title":"钥匙的来历","description":"店主不愿说明铜钥匙来自何处","status":"open","reason":""}}]}}
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

function canonicalTaskName(raw, fallback = '') {
    const key = normName(raw);
    return BUCKET_ALIASES[key] || (typeof raw === 'string' ? raw.trim() : '') || fallback;
}

function normalizeActionRow(raw, fallbackTask = '') {
    if (!raw || typeof raw !== 'object') return raw;
    const row = { ...raw };
    if (!row.type) {
        if (row.record || STORY_KIND_SET.has(row.kind)) row.type = 'story';
        else if (row.from && row.to) row.type = 'link';
        else if (row.target && row.field) row.type = 'set';
        else if (row.ref && row.kind && row.name) row.type = 'create';
    }
    let task = canonicalTaskName(row.task, fallbackTask);
    if (row.type === 'link') task = 'places';
    else if (row.type === 'trade') task = 'overview';
    else if (row.type === 'create' && row.kind === 'place') task = 'places';
    else if (row.type === 'create' && row.kind === 'organization') task = 'people';
    else if (row.type === 'set' && ['parent', '上级地点', 'scale', '类型', '通行状态', '通行'].includes(row.field)) task = 'places';
    else if (row.type === 'story') {
        const storyKind = (row.record && typeof row.record === 'object' ? row.record.kind : row.kind);
        if (storyKind === 'situation' || storyKind === 'clock') task = 'situation';
        else if (storyKind === 'suspense') task = 'suspense';
        else if (storyKind === 'knowledge' || storyKind === 'person') task = 'people';
        else if (storyKind === 'plan' || storyKind === 'goal') task = ['overview', 'people'].includes(task) ? task : 'people';
    }
    row.task = task;
    return row;
}

export function hasActionBuckets(result) {
    if (!result || typeof result !== 'object') return false;
    if (Array.isArray(result.changes)) return true;
    if (result.buckets && typeof result.buckets === 'object' && !Array.isArray(result.buckets)) return true;
    return Object.keys(result).some(key => Object.hasOwn(BUCKET_ALIASES, normName(key)) && Array.isArray(result[key]));
}

export function actionRows(result) {
    if (Array.isArray(result?.changes)) return result.changes.map(row => normalizeActionRow(row));
    const bucketObj = result?.buckets && typeof result.buckets === 'object' && !Array.isArray(result.buckets)
        ? result.buckets
        : (result && typeof result === 'object' && !Array.isArray(result) ? result : null);
    if (!bucketObj) return [];
    const rows = [];
    for (const [key, list] of Object.entries(bucketObj)) {
        const bucketTask = BUCKET_ALIASES[normName(key)];
        if (result?.buckets !== bucketObj && !bucketTask) continue;
        if (!Array.isArray(list)) continue;
        for (const row of list) {
            if (row && typeof row === 'object') rows.push(normalizeActionRow(row, bucketTask || key));
        }
    }
    return rows;
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

function normalizeStoryInput(row, { hero, playerName, quote }) {
    const raw = row.record && typeof row.record === 'object' ? { ...row.record } : { ...row };
    const kind = typeof raw.kind === 'string' ? raw.kind.trim() : '';
    if (kind === 'clock') {
        raw.id = 'clock';
        if (!raw.label && (raw.title || raw.value || raw.text || raw.date)) raw.label = String(raw.title || raw.value || raw.text || raw.date).trim();
        if (raw.date == null) raw.date = '';
        else if (typeof raw.date === 'string' && raw.date.trim()) {
            const cleaned = raw.date.trim().replace(/[年/]/gu, '-').replace(/月/gu, '-').replace(/日.*$/u, '').replace(/(^|-)(\d)(?=-|$)/gu, '$10$2');
            raw.date = storyDate(cleaned) !== null ? cleaned : '';
        }
    }
    if (!raw.id || typeof raw.id !== 'string' || !raw.id.trim()) {
        const seed = raw.title || raw.name || raw.content || raw.label || raw.description || JSON.stringify(raw);
        raw.id = `${kind || 'story'}:${memoryDigest([seed]).slice(0, 12)}`;
    }
    if (kind === 'person') {
        if (!raw.name && raw.title) raw.name = raw.title;
        raw.presence = PRESENCE_ALIASES[normName(raw.presence)] || (raw.presence ? String(raw.presence).trim() : 'present');
        if (raw.note == null) raw.note = typeof raw.description === 'string' ? raw.description : '';
    } else if (kind === 'knowledge') {
        raw.person = entityRef(raw.person) || entityRef(row.target) || hero?.name || playerName || '主角';
        if (!raw.content && (raw.title || raw.description)) raw.content = String(raw.title || raw.description).trim();
        raw.certainty = BELIEFS_FIX(raw.certainty);
        if (!raw.evidence || typeof raw.evidence !== 'string' || !raw.evidence.trim()) {
            raw.evidence = quote || (typeof raw.note === 'string' && raw.note.trim()) || (typeof raw.description === 'string' && raw.description.trim()) || '本轮正文';
        }
        if (raw.learnedAt == null) raw.learnedAt = '';
    } else if (THREAD_KINDS.has(kind)) {
        if (!raw.title && raw.name) raw.title = raw.name;
        if (raw.description == null) raw.description = typeof raw.title === 'string' ? raw.title : '';
        if (kind === 'plan' || kind === 'goal') {
            if (Array.isArray(raw.holders)) raw.holders = raw.holders.map(entityRef).filter(Boolean);
            if (!Array.isArray(raw.holders) || !raw.holders.length) {
                const candidateHolder = [entityRef(raw.holder), entityRef(row.target), entityRef(row.person), hero?.name, playerName, '主角']
                    .find(value => typeof value === 'string' && value.trim());
                raw.holders = [candidateHolder.trim()];
            }
            if (!String(raw.description || '').trim() && raw.title) raw.description = raw.title;
        }
        if (!raw.remove) {
            raw.status = STATUS_ALIASES[normName(raw.status)] || (raw.status ? String(raw.status).trim() : 'open');
            if (raw.status !== 'open' && (!raw.reason || !String(raw.reason).trim())) {
                raw.reason = String(raw.statusNote || raw.description || '剧情已结案').trim();
            }
            if (raw.reason == null) raw.reason = '';
            if (raw.due == null) raw.due = '';
        }
    }
    return raw;
}

function BELIEFS_FIX(value) {
    return BELIEF_ALIASES[normName(value)] || (typeof value === 'string' && value.trim() ? value.trim() : 'known');
}

function referencedKeys(row) {
    if (!row || typeof row !== 'object') return [];
    const out = [];
    for (const candidate of [row.target, row.from, row.to, row.parent, row.item, row.counterparty, row.value?.entityId ? row.value : null]) {
        const ref = entityRef(candidate);
        if (ref) out.push(ref);
    }
    return out;
}

function orderPlaceCreates(rows) {
    const places = rows.filter(r => r.type === 'create' && r.kind === 'place');
    const others = rows.filter(r => !(r.type === 'create' && r.kind === 'place'));
    const byRef = new Map(places.filter(r => r.ref).map(r => [r.ref, r]));
    const ordered = [], visited = new Set();
    const visit = row => {
        if (visited.has(row)) return;
        visited.add(row);
        const parentKey = entityRef(row.parent);
        if (parentKey && byRef.has(parentKey)) visit(byRef.get(parentKey));
        ordered.push(row);
    };
    for (const row of places) visit(row);
    others.sort((a, b) => Number(b.type === 'create') - Number(a.type === 'create'));
    return [...ordered, ...others];
}

export function reconcileActionGroups(rawGroups, keys, existingCreators = null) {
    const creators = new Map(), nameCounts = new Map(), nameCreators = new Map();
    if (existingCreators) {
        for (const [k, v] of existingCreators) creators.set(k, v);
    }
    for (const group of rawGroups) {
        for (const row of group.rows || []) {
            if (row?.type !== 'create' || !row.ref) continue;
            creators.set(row.ref, { groupId: group.id, kind: row.kind });
            const nk = normName(row.name);
            if (nk) {
                nameCounts.set(nk, (nameCounts.get(nk) || 0) + 1);
                nameCreators.set(nk, { groupId: group.id, kind: row.kind });
            }
        }
    }
    const creatorOf = key => {
        if (!key) return null;
        if (creators.has(key)) return creators.get(key);
        const nk = normName(key);
        return nk && nameCounts.get(nk) === 1 ? nameCreators.get(nk) : null;
    };
    const primaryGroups = [], deferredGroups = [];
    for (const group of rawGroups) {
        const primary = [], deferred = [];
        for (const rawRow of group.rows || []) {
            const row = normalizeActionRow(rawRow, rawRow?.task);
            if (!keys.includes(row?.task)) continue;
            const hasForeignRef = row.type !== 'create' && referencedKeys(row).some(ref => {
                const owner = creatorOf(ref);
                return owner && owner.groupId !== group.id;
            });
            if (hasForeignRef) deferred.push(row);
            else primary.push(row);
        }
        if (primary.length) primaryGroups.push({ id: group.id, rows: primary });
        if (deferred.length) {
            deferredGroups.push({
                id: primary.length ? `${group.id}:deps` : group.id,
                rows: deferred,
                ...(primary.length ? { deferred: true } : {}),
            });
        }
    }
    return [...primaryGroups, ...deferredGroups];
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
    return reconcileActionGroups([...groups.entries()].map(([id, rows]) => ({ id, rows })), keys);
}

export function turnOperations(state, rows, { source, backgroundSource = null, playerName, effectId, commandId, omitted = [], storyRefs = {}, refs: sharedRefs = null, allRows = null }) {
    const entities = [...state.entities], operations = [], refs = sharedRefs instanceof Map ? sharedRefs : new Map();
    let { hero } = protagonistIdentity(entities, playerName);
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
            location.brief = String(value ?? '').replace(/\s+/gu, ' ').slice(0, 1200);
        } else if (['scale','类型'].includes(field)) {
            const scale = normalizeScale(value);
            if (scale) location.scale = scale;
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
    const ensureHero = provenance => {
        if (hero) return hero;
        const displayName = typeof playerName === 'string' && playerName.trim() ? playerName.trim() : '主角';
        const existing = entities.find(e => e.kind === 'person' && [e.name, ...(e.aliases || [])].some(n => normName(n) === normName(displayName) || normName(n) === '主角'));
        if (existing) { hero = existing; return hero; }
        const id = 'object:' + memoryDigest([state.worldId, effectId, 'protagonist', displayName]);
        const aliases = displayName !== '主角' ? ['主角'] : [];
        hero = { id, kind: 'person', name: displayName, aliases, fields: {}, bindings: [] };
        entities.push(hero);
        operations.push({ type: 'create', id, kind: 'person', name: displayName, ...(aliases.length ? { aliases } : {}), source: provenance });
        return hero;
    };
    const matchEntities = (ref, allowedKinds = null) => {
        const raw = entityRef(ref);
        if (!raw) return [];
        const mappedId = refs.get(raw);
        let candidates = mappedId
            ? entities.filter(e => e.id === mappedId)
            : entities.filter(e => e.id === raw || [e.name, ...(e.aliases || [])].includes(raw));
        if (!candidates.length) {
            const rosterMatch = raw.match(/^(.*?)\s*[（(]编号\s*([^）)]+)[）)]\s*$/u);
            if (rosterMatch) {
                const [, labelName, idHint] = rosterMatch;
                candidates = entities.filter(e => e.id === idHint.trim());
                if (!candidates.length && labelName.trim()) {
                    candidates = entities.filter(e => [e.name, ...(e.aliases || [])].includes(labelName.trim()));
                }
            }
        }
        if (allowedKinds?.length) {
            const narrowed = candidates.filter(e => allowedKinds.includes(e.kind));
            if (narrowed.length) candidates = narrowed;
        }
        return candidates;
    };
    const isHeroAlias = ref => {
        const key = normName(entityRef(ref));
        return Boolean(key) && (['主角', 'player', 'hero'].includes(key) || (playerName && key === normName(playerName)));
    };
    const resolve = (ref, allowedKinds = null, { provenance = null, autoPlace = false } = {}) => {
        const rawRef = entityRef(ref);
        const candidates = matchEntities(rawRef, allowedKinds);
        if (candidates.length === 1 && !omitted.includes(candidates[0].id)) {
            return candidates[0];
        }
        if (!candidates.length && provenance && (!allowedKinds || allowedKinds.includes('person')) && isHeroAlias(rawRef)) {
            return ensureHero(provenance);
        }
        if (!candidates.length && autoPlace && provenance && rawRef) {
            const cleanName = rawRef.replace(/\s*[（(]编号\s*[^）)]+[）)]\s*$/u, '').trim();
            if (cleanName && cleanName.length <= 120 && !['__proto__', 'prototype', 'constructor'].includes(cleanName)) {
                const id = 'object:' + memoryDigest([state.worldId, effectId, 'auto-place', cleanName]);
                const created = { id, kind: 'place', name: cleanName, aliases: [], fields: {}, bindings: [] };
                entities.push(created);
                refs.set(ref, id);
                refs.set(cleanName, id);
                operations.push({ type: 'create', id, kind: 'place', name: cleanName, source: provenance });
                ensureLocation(created);
                return created;
            }
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
    const siblingPool = Array.isArray(allRows) && allRows.length ? allRows : rows;
    for (const row of orderPlaceCreates(rows)) {
        const proof = evidence(row, source, backgroundSource);
        const quote = proof.quote;
        const label = quote || [row.name, row.record?.title, row.field].filter(value => typeof value === 'string' && value.trim()).join(' · ') || '本轮记录';
        const provenance = { module: 'turn-update', key: effectId, label: '第 ' + (proof.floor + 1) + ' 楼 · ' + label,
            task: row.task, ...(quote ? { proof: { floor: proof.floor, quote } } : {}) };
        const allowed = fieldTasks[row.task] || [];
        if (row.type === 'create') {
            const matching = entities.filter(e => e.kind === row.kind && [e.name, ...(e.aliases || [])].includes(row.name));
            invariant(matching.length <= 1, '有多个同称对象，已跳过歧义创建');
            const alreadyMappedSame = row.ref && refs.has(row.ref) && matching[0]?.id === refs.get(row.ref);
            invariant(allowed.includes(row.kind) && row.ref && (!refs.has(row.ref) || alreadyMappedSame) && typeof row.name === 'string' && row.name.trim(), '新对象的类型或临时引用无效');
            const bgFloorAllowed = row.task === 'overview' ? null : backgroundSource;
            if (row.kind === 'item') invariant(Boolean(resolveSourceQuote(quote, row.name) || findQuoteAcrossFloor(row.name, source, bgFloorAllowed)), '原文未确认新对象称呼');
            invariant(row.kind !== 'route', '地点通道请使用 type=link');
            const rawImportance = typeof row.importance === 'string' ? row.importance.trim() : '';
            const importance = rawImportance ? (findQuoteAcrossFloor(rawImportance, source, backgroundSource) || rawImportance.slice(0, 400)) : null;
            const hasSiblingImportance = row.kind === 'item' && siblingPool.some(action =>
                action.type === 'set'
                && IMPORTANCE_FIELDS.includes(String(action.field || '').trim())
                && [row.ref, row.name].includes(entityRef(action.target))
                && action.value != null && String(action.value).trim() !== '');
            if (row.kind === 'item' && row.task !== 'overview') invariant(Boolean(importance || hasSiblingImportance), '物品缺少可核对的剧情意义');
            const id = matching[0]?.id || 'object:' + memoryDigest([state.worldId, effectId, row.ref]);
            const shouldCreate = !matching.length;
            refs.set(row.ref, id);
            if (shouldCreate) {
                const created = { id, kind: row.kind, name: row.name, aliases: [], fields: {}, bindings: [] };
                entities.push(created);
                operations.push({ type: 'create', id, kind: row.kind, name: row.name, source: provenance });
                if (row.kind === 'person' && !hero && (isHeroAlias(row.name) || (playerName && normName(row.name) === normName(playerName)))) {
                    hero = created;
                }
                if (row.kind === 'place') {
                    const location = ensureLocation(created);
                    const scale = normalizeScale(row.scale);
                    if (location && scale) location.scale = scale;
                    const parentRef = entityRef(row.parent);
                    if (parentRef) {
                        const parentEntity = resolve(parentRef, ['place'], { provenance, autoPlace: true });
                        if (parentEntity.id !== created.id) {
                            updatePlace(created, 'parent', { entityId: parentEntity.id });
                            operations.push({ type: 'set', entityId: id, field: 'parent', value: { entityId: parentEntity.id }, source: provenance });
                        }
                    }
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
            const from = resolve(row.from, ['place'], { provenance, autoPlace: true });
            const to = resolve(row.to, ['place'], { provenance, autoPlace: true });
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
            const rawStory = normalizeStoryInput(row, { hero, playerName, quote });
            const resolveLabel = token => {
                const hit = matchEntities(token, ['person', 'organization']);
                return hit.length === 1 ? hit[0].name : token;
            };
            if (rawStory && typeof rawStory === 'object') {
                if (typeof rawStory.person === 'string') rawStory.person = resolveLabel(rawStory.person);
                if (Array.isArray(rawStory.holders)) rawStory.holders = [...new Set(rawStory.holders.map(resolveLabel))];
            }
            invariant(storyTasks[row.task]?.includes(rawStory?.kind), '该功能不能改写这类剧情记录');
            const inputRecord = rawStory && typeof rawStory === 'object'
                ? { ...rawStory, ...(storyRefs[rawStory.id] ? { id:storyRefs[rawStory.id] } : {}) }
                : rawStory;
            const record = parseStoryUpdates([inputRecord], { requireHolders: true })[0];
            const storyNature = row.uncertain
                ? (row.nature && row.nature !== 'established_fact' ? row.nature : 'hypothesis')
                : (row.nature || 'established_fact');
            const change = applyWorldStoryProposal(story, { record, nature: storyNature }, provenance, state.version + 1, 'event:' + commandId, effectId + '/' + record.id, source);
            story.modules.story = change.value;
            storyTouched = true;
        } else {
            invariant(row.type === 'set' && typeof row.field === 'string', '不支持的变化类型');
            let field = row.field.trim();
            if (mapLocationFields.includes(field)) field = 'location';
            else if (['parent', '上级地点', '所属地点', '所属区域'].includes(field)) field = 'parent';
            else if (['owner', '归属', '归属人', '拥有者', '持有者'].includes(field)) field = 'owner';
            else if (['description', '描述', '简介'].includes(field)) field = 'description';
            else if (['importance', '重要性'].includes(field)) field = '剧情意义';
            const isLocationAnchor = row.task === 'places' && field === 'location';
            const targetKinds = isLocationAnchor ? ['person', 'organization', 'item', 'place'] : allowed;
            const entity = resolve(row.target, targetKinds, { provenance, autoPlace: row.task === 'places' && !isLocationAnchor });
            invariant(targetKinds.includes(entity.kind) && !['coins', '金币', '余额', '钱包'].includes(field), '钱包变动须通过主角交易核算');
            invariant(row.task !== 'overview' || entity.kind === 'item' || entity.id === hero?.id, '物品栏只维护主角的收支');
            const valueKinds = ['location', 'parent'].includes(field) ? ['place']
                : ['owner', '保管人', '使用人'].includes(field) || field.startsWith('关系:') || field.startsWith(RELATION_PREFIX) ? ['person', 'organization']
                    : null;
            const autoPlace = ['location', 'parent'].includes(field);
            let value = row.value;
            const refValue = valueKinds && ['location', 'parent', 'owner', '保管人', '使用人'].includes(field) ? entityRef(row.value) : (row.value?.entityId ? entityRef(row.value) : '');
            if (refValue) {
                const resolvedId = resolve(refValue, valueKinds, { provenance, autoPlace }).id;
                value = ['owner', 'location', 'parent'].includes(field)
                    ? { entityId: resolvedId }
                    : { entityId: resolvedId, ...(row.value?.role ? { role: row.value.role } : {}) };
            }
            if (row.task === 'overview' && ['owner', '保管人', '使用人'].includes(field)) {
                invariant(hero && [value?.entityId, entity.fields[field]?.value?.entityId, entity.fields.owner?.value?.entityId].includes(hero.id), '该项交接与主角无关');
            }
            if (entity.kind === 'item' && row.task === 'people') {
                const important = ['剧情意义', 'importance', '归还条件', '归还约定', '保管人', '使用人', '物证', '重要性'].some(key => entity.fields[key]?.value)
                    || siblingPool.some(action => action.type === 'create' && action.importance && refs.get(action.ref) === entity.id)
                    || siblingPool.some(action => entityRef(action.target) === entityRef(row.target) && IMPORTANCE_FIELDS.includes(String(action.field || '').trim()));
                invariant(important, '物品缺少剧情意义');
            }
            if (field.startsWith(RELATION_PREFIX) || field.startsWith('关系:')) {
                const targetRef = field.startsWith(RELATION_PREFIX) ? field.slice(RELATION_PREFIX.length) : field.slice(3).trim();
                const peer = targetRef ? matchEntities(targetRef, ['person'])[0] : null;
                const roleText = typeof value === 'string' ? value.trim() : typeof value?.role === 'string' ? value.role.trim() : '';
                if (peer && peer.id !== entity.id && roleText && !peer.fields?.[RELATION_PREFIX + entity.id]?.value?.entityId) {
                    field = RELATION_PREFIX + peer.id;
                    value = { entityId: peer.id, role: roleText.slice(0, 200) };
                } else if (field.startsWith(RELATION_PREFIX) && (!peer || peer.id === entity.id || peer.fields?.[RELATION_PREFIX + entity.id]?.value?.entityId === entity.id)) {
                    field = `关系:${peer?.name || targetRef || '对象'}`;
                    value = roleText || JSON.stringify(value ?? '');
                }
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
