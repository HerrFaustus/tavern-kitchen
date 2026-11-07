import { memoryDigest } from '../story-summary/data/memory-policy.js';
import { worldStoryRecords } from '../world-records/world-story-state.js';
import { indexGeography } from './regional-proximity.js';
import { availableStoryRecords } from './records.js';

const clean = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
// Fold only a connective immediately before a place noun. Registered names take precedence.
const spelling = name => clean(name).normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ');
const placeForm = name => spelling(name).replace(/的(?=集市$|市集$|码头$|广场$|街口$|车站$|渡口$)/u, '');
function resolvePlace(name, entities) {
    const places = entities.filter(entity => entity.kind === 'place');
    const match = normalize => places.filter(place => [place.name, ...(place.aliases || [])]
        .some(alias => normalize(alias) === normalize(name)));
    const exact = match(spelling);
    const candidates = exact.length ? exact : match(placeForm);
    if (candidates.length > 1) return null;
    const place = candidates[0];
    return place ? { id: 'entity:' + place.id, name: place.name } : { id: 'name:' + placeForm(name), name };
}

const onBranch = (batch, world) => batch.sourceReceipt?.branchId === world?.branchId && batch.sourceReceipt?.worldId === world?.worldId;
function batches(store, world) {
    return (store?.summaryHistory || []).filter(batch => onBranch(batch, world) && batch.ambient?.visit && !batch.floorEntry?.omitted && !batch.floorEntry?.deleted);
}
export function ambientControl(store, world, receipt, preferences) {
    const history = batches(store, world);
    const previous = history.at(-1)?.ambient.visit || null;
    const sample = parseInt(memoryDigest([world.worldId, world.branchId, receipt.source.start, previous?.key]).slice(0, 8), 16) / 0x100000000;
    const active = currentSituations(store, world).filter(record => record.flavor && record.status === 'open')
        .map(({ id, flavor, title, phase, description, due, scope, placeId }) => ({ id, flavor, title, phase, description, due, scope, placeId }));
    return { previous, active,
        evolve: preferences.sceneryEvolution === true, frequency: preferences.encounterFrequency || 'occasional',
        draw: sample < ({ off: 0, occasional: 0.18, lively: 0.42 }[preferences.encounterFrequency || 'occasional'] || 0),
        seed: memoryDigest([world.worldId, world.branchId, receipt.source.start]).slice(0, 16) };
}

export const AMBIENT_PROTOCOL = `在独立总结 JSON 中另给 ambient（与正文事实及 worldUpdate 分开）。ambient.place 是当前视角的明确地点，仍在原处请复用 previous.place；无据留空。period 是明确的故事日期或时段，沿用未变化的值。timeJump 仅在本轮正文明确跨日或显著跳时时为 true。publicSpace 仅为可偶遇人群的公开场所，quiet 仅为适合插入背景细节的平静场景；私密、战斗、紧张对峙均不适合。不得猜测这些条件。若当前到访已有街头见闻，且正文明确已满足其散场条件，返回 encounterEnded:true。
正文已明确发生的节庆、物候、天气用有原文依据的 situation 类型 story 提案，flavor="scenery"，scope 写准确地点，phase 写所处阶段，category 写节庆、天气、物候或地方日常，impact 写该阶段当地可见、可听或实际影响行动的变化。有依据的近景风物通常写80–180字，交代影响谁、在何处、怎样随阶段变化；远景或只有一处线索时简记。沿用同一条风物并在已证实消退时结束。地方惯常节俗、布局和长期感官特征归地图。相关事态可填 relatedId。不根据幕后推演伪造正文证据。
当 ambientControl.evolve 开启时，当前牵涉中的风物每轮可检查，只写有依据的细微变化；其余风物只有到达、明显跳时、收到有关该风物的直接消息才粗略复查。无变化留空。允许复查时，可在 ambient.scenery 中给至多两条风物推演：{id,title,category,phase,detail,until,ended,relatedId,quote}。同地持续推演或远程复查必须用 quote 逐字引用本批 AI 正文依据，沿用 active 内已有 id；依据时节、地方设定和已发生的剧情，detail 在依据充足时写80–180字，具体到近景里可辨认的变化，远方有多少消息写多少。允许自然消退，避免重复正文已有风物。缺依据返回空数组。
只有 ambientControl.draw 为 true、进入公共地点或明确跳时、且场面平静时，可给 ambient.encounter:{title,detail,until,relatedId}；例如收摊促销、流动艺人或街头布道。写看得到听得到的一处细节，写散场条件，不替玩家回应，不要求玩家参与。不符合时省略。不要把幕后风物或见闻写入 summary 或 worldUpdate。`;

export function prepareAmbient(raw, control, end, knownIds = [], entities = []) {
    if (!raw || !control) return null;
    const knownPlace = clean(raw.place);
    const previous = control.previous;
    const location = knownPlace ? resolvePlace(knownPlace, entities) : null;
    // Earlier saves only recorded the label. Resolve it against today's registry before comparing.
    const previousId = previous?.placeId?.startsWith('entity:') ? previous.placeId : resolvePlace(previous?.place || '', entities)?.id;
    const placeId = location?.id || previousId || '';
    const samePlace = placeId === previousId;
    const place = location?.name && (!samePlace || location.id.startsWith('entity:')) ? location.name : previous?.place || knownPlace;
    const period = clean(raw.period) || previous?.period || '';
    const changed = !!location && (!previous || !samePlace || (raw.timeJump === true && !!period && period !== previous.period));
    const visit = { key: changed || !previous ? control.seed : previous.key, place, placeId, period };
    const updates = [];
    const event = (item, flavor, id) => {
        if (!item || !id || !clean(item.title) || !clean(item.detail, 600)) return;
        const ended = item.ended === true && flavor === 'scenery';
        updates.push({ id, kind: 'situation', flavor, title: clean(item.title), description: clean(item.detail, 600),
            scope: place, placeId, period, category: flavor === 'encounter' ? '街头见闻' : clean(item.category, 40), phase: clean(item.phase), due: clean(item.until), status: ended ? 'done' : 'open',
            reason: ended ? clean(item.until) || '随故事时间消退' : '', relatedId: knownIds.includes(item.relatedId) ? item.relatedId : '',
            _addedAt: end, _visit: visit.key });
    };
    if (control.evolve) for (const item of (Array.isArray(raw.scenery) ? raw.scenery : []).slice(0, 2)) {
        const key = clean(item?.id);
        if (!key) continue;
        const old = control.active.find(row => row.flavor !== 'encounter' && row.id === key);
        const near = control.near?.has('situation/' + key);
        const awakened = control.wake?.has('situation/' + key);
        const local = knownPlace && (!old || (old.placeId || resolvePlace(old.scope, entities)?.id) === placeId);
        if (!(local && changed) && !(old && (near || awakened))) continue;
        if (!(local && changed) && !(typeof item.quote === 'string' && item.quote.trim() && item.quote.length <= 400 && control.messages?.some(message =>
            message.role === 'assistant' && message.text.includes(item.quote)))) continue;
        if (item.ended === true && !old) continue;
        const id = old?.id || 'scenery-' + memoryDigest([placeId,key]).slice(0,16);
        if (updates.some(row => row.id === id)) continue;
        event(item, 'scenery', id);
        const saved = updates.find(row => row.id === id);
        if (old && saved) { saved.scope = old.scope; saved.placeId = old.placeId || resolvePlace(old.scope, entities)?.id; }
    }
    if (knownPlace && changed && control.draw && raw.publicSpace === true && raw.quiet === true && clean(raw.encounter?.until)) {
        event(raw.encounter,'encounter','encounter-' + visit.key);
    }
    return { visit, arrived: changed, updates, encounterEnded: raw.encounterEnded === true, quiet: !!location && raw.quiet === true };
}

export function ambientRecords(store, world) {
    const records = new Map();
    let encounter;
    for (const {ambient, endMesId} of batches(store, world)) {
        if (encounter && (encounter._visit !== ambient.visit.key || ambient.encounterEnded)) {
            const reason = ambient.encounterEnded ? '见闻已散场' : '此次到访已结束';
            encounter._history.push({ text: reason, _addedAt: endMesId });
            records.set(encounter.id, { ...encounter, status: 'done', reason, _addedAt: endMesId });
            encounter = undefined;
        }
        for (const record of (Array.isArray(ambient.updates) ? ambient.updates : [])) {
            if (!record?.id) continue;
            const old = records.get(record.id);
            const fields = ['title', 'phase', 'description', 'category', 'due', 'status', 'reason', 'relatedId'];
            if (old && fields.every(key => old[key] === record[key])) continue;
            const history = old?._history || [];
            history.push({ text: [record.phase, record.description, record.reason].filter(Boolean).join(' · '), _addedAt: endMesId });
            const entry = { ...record, _history: history };
            records.set(record.id, entry);
            if (record.flavor === 'encounter') encounter = entry;
        }
    }
    return [...records.values()];
}

export function currentSituations(store, world, factual = worldStoryRecords(world, availableStoryRecords(store))) {
    const records = new Map(ambientRecords(store, world).map(record => [record.id, record]));
    for (const record of factual) {
        if (record.kind !== 'situation') continue;
        const background = records.get(record.id);
        if (!background || record.status !== 'open' || (record._addedAt ?? -1) >= background._addedAt) records.set(record.id, record);
    }
    return [...records.values()];
}

// A read-only display of current effects. The map stores only lasting geography.
export function mapLocalConditions(world, snapshot, atlas) {
    if (!world || !atlas?.locations.length) return [];
    if (snapshot?.enabled && (snapshot.invalidFrom != null || snapshot.store?.summaryInvalid || snapshot.store?.sourceInvalidFromFloor != null)) return [];
    const store = snapshot?.enabled ? snapshot.store : null;
    const geo = indexGeography(world.entities || [],atlas);
    const keyById = new Map();
    for (const [key,id] of geo.mapIds) {
        keyById.set(id,keyById.has(id) ? null : key);
        keyById.set('map:' + key,key);
    }
    const removed = new Set((world.modules?.story?.records || []).filter(entry => entry.record.remove).map(entry => entry.record.id));
    const conditions = [];
    for (const row of currentSituations(store,world)) {
        if (row.status !== 'open' || removed.has(row.id)) continue;
        const detail = row.impact || (row.flavor ? row.description : '');
        if (!detail) continue;
        const stable = row.placeId?.startsWith('entity:') || row.placeId?.startsWith('map:');
        const scopes = row.scope ? [row.scope,...row.scope.split(/[、，,；;\n]/u)] : [];
        const ids = stable ? [row.placeId] : scopes.map(name => geo.resolve(name));
        const places = [...new Set(ids.map(id => keyById.get(id)).filter(Boolean))];
        if (places.length) conditions.push({id:row.id,title:row.title,phase:row.phase || '',detail,places});
    }
    return conditions;
}

export function ambientPrompt(store, world, factual = [], preferences = {}) {
    const latest = batches(store, world).at(-1);
    if (latest?.endMesId !== store?.lastSummarizedMesId || !latest?.ambient.quiet || !latest.ambient.visit.place || store?.summaryInvalid || store?.sourceInvalidFromFloor != null) return '';
    const local = currentSituations(store, world, factual).filter(record => record.flavor &&
        record.status === 'open' && (record.scope === latest.ambient.visit.place || (latest.ambient.visit.placeId && (record.placeId || resolvePlace(record.scope, world?.entities || [])?.id) === latest.ambient.visit.placeId)) && (latest.ambient.arrived || record._addedAt === latest.endMesId) && (record.flavor !== 'encounter' ||
        preferences.encounterFrequency !== 'off' && record._addedAt === latest.endMesId && latest.endMesId === store.lastSummarizedMesId));
    const items = local.sort((a,b) => Number(b.flavor === 'encounter') - Number(a.flavor === 'encounter') || b._addedAt - a._addedAt).slice(0,2);
    return items.length ? '【本地风物】\n' + JSON.stringify(items.map(r => [r.title,r.phase,r.impact || r.description])) : '';
}
