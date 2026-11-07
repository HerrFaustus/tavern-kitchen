import { currentSituations } from './ambient.js';
import { applyRegionalProximity } from './regional-proximity.js';
import { nameKey, protagonistIdentity } from './protagonist-identity.js';
import { availableStoryRecords, isPersonalAgenda, projectPersonalAgendas } from './records.js';
import { worldStoryRecords } from '../world-records/world-story-state.js';
import { PERSON_FIELDS } from '../world-records/person-fields.js';

export const INVOLVEMENT_PROTOCOL = `involvement 是可选增量数组。只用本批正文证据判断某人物、事态或风物与当前玩家的直接牵涉；与主角互动、直接影响当前行动或被主角主动介入才 enter。同处主角地理区域的人物、事态、风物由程序自动列为近景（regional=true）。仅同地或被提及时，不额外写 enter；有独立的直接牵涉仍应记录。明确解除才 leave；本轮未提及不要输出。远景只有收到有关它的直接消息、明显跳时后有据可查、重返相关地点或影响来到眼前才 wake。wake 本身不升档。格式 {target, action:"enter|leave|wake", reason, floor, quote}，target 使用 involvementContext 中的 key。新人物只有达到人物建档门槛才可用 person-name/姓名；一次性搭话或交易只记剧情，不生成牵涉。新局势可用 situation/本轮局势记录id。floor 为零基楼层，quote 必须是本批 AI 正文逐字原句。事实和世界提案始终照常记录。近景每轮检查，每次至多推进有依据的一小步；远景唤醒只概括现状。`;

export function readInvolvement(world, snapshot, playerName, {includeAgendas = false} = {}) {
    if (!world || !snapshot?.enabled || snapshot.invalidFrom != null || snapshot.store?.summaryInvalid || snapshot.store?.sourceInvalidFromFloor != null) return [];
    const store = snapshot.store;
    const entities = world.entities || [];
    const identity = protagonistIdentity(entities, playerName);
    const { hero, names, title } = identity;
    if (!hero && (!title || !names.size)) return [];
    const rows = new Map();
    const people = entities.filter(entity => entity.kind === 'person' && entity !== hero);
    for (const person of people) {
        const direct = hero && [ [person, hero], [hero, person] ].some(([from,to]) =>
            Object.values(from.fields || {}).some(field => field.nature === 'established_fact' && field.value?.entityId === to.id));
        const key = 'person/' + person.id;
        rows.set(key, { key, kind:'person', title:person.name, aliases:person.aliases || [], near:!!direct, reason:direct ? '世界记录中与主角直接关联' : '', fixed:!!direct });
        if (includeAgendas) {
            const profile = Object.entries(person.fields || {}).filter(([field, record]) =>
                PERSON_FIELDS.has(field) && record.nature === 'established_fact' && typeof record.value === 'string' && record.value.trim());
            if (profile.length) rows.get(key).profile = Object.fromEntries(profile.map(([field, record]) => [field, record.value]));
        }
    }
    const factual = worldStoryRecords(world,availableStoryRecords(store));
    const trackedNames = new Set((store?.json?.characters?.main || []).map(person => typeof person === 'string' ? person : person.name));
    for (const record of factual) {
        if (record.kind === 'person') trackedNames.add(record.name);
        if (record.kind === 'knowledge') trackedNames.add(record.person);
        for (const holder of record.holders || []) trackedNames.add(holder);
    }
    for (const title of trackedNames) {
        const name = nameKey(title);
        if (!name) continue;
        if (names.has(name) || people.some(person => [person.name, ...(person.aliases || [])].some(alias => nameKey(alias) === name))) continue;
        const key = 'person-name/' + title;
        rows.set(key, {key, kind:'person', title, near:false, reason:''});
    }
    const situations = currentSituations(store,world,factual);
    for (const record of situations) {
        const key = 'situation/' + record.id;
        if (record.status !== 'open') { rows.delete(key); continue; }
        rows.set(key, {key, kind:record.flavor ? 'scenery' : 'situation', title:record.title, near:false, reason:'', scope:record.scope || ''});
    }
    for (const batch of store?.summaryHistory || []) {
        if (batch.sourceReceipt?.worldId !== world.worldId || batch.sourceReceipt?.branchId !== world.branchId || batch.floorEntry?.omitted || batch.floorEntry?.deleted) continue;
        if (batch.ambient?.arrived && batch.ambient.visit?.place) {
            for (const row of rows.values()) if (row.scope === batch.ambient.visit.place) row.wakeFloor = batch.endMesId;
        }
        for (const change of (Array.isArray(batch.involvement) ? batch.involvement : [])) {
            if (typeof change?.target !== 'string') continue;
            let row = rows.get(change.target);
            if (!row && change.target.startsWith('person-name/')) {
                const name = nameKey(change.target.slice(12));
                const found = people.filter(person => [person.name,...(person.aliases || [])].some(alias => nameKey(alias) === name));
                if (found.length === 1) row = rows.get('person/' + found[0].id);
                else if (!found.length && !names.has(name) && change.action === 'enter') {
                    row = { key:change.target, kind:'person', title:change.target.slice(12), near:false, reason:'' };
                    rows.set(change.target,row);
                }
            }
            if (!row) continue;
            if (change.action === 'wake') { row.wakeFloor = change.floor; continue; }
            if (!row.fixed) { row.near = change.action === 'enter'; row.reason = row.near ? change.reason : ''; }
        }
    }
    applyRegionalProximity(rows, world, identity, situations);
    if (includeAgendas) {
        const peopleByName = new Map(), knownNames = new Set();
        for (const row of rows.values()) {
            if (row.kind !== 'person') continue;
            for (const name of [row.title,...(row.aliases || [])]) {
                knownNames.add(name);
                const key = nameKey(name);
                if (names.has(key)) continue;
                if (!peopleByName.has(key)) peopleByName.set(key,row);
                else if (peopleByName.get(key) !== row) peopleByName.set(key,null);
            }
        }
        for (const record of projectPersonalAgendas(factual, knownNames)) {
            if (!isPersonalAgenda(record) || record.status !== 'open') continue;
            const holders = new Set((record.holders || []).map(name => peopleByName.get(nameKey(name))));
            for (const row of holders) if (row) {
                row.agendas ||= [];
                const {id,kind,title,description,conditions,statusNote,due} = record;
                row.agendas.push({id,kind,title,description,conditions,statusNote,due});
            }
        }
    }
    return [...rows.values()];
}

export function prepareInvolvement(raw, context, proposals = []) {
    if (!Array.isArray(raw) || !context?.involvementContext) return [];
    const ids = new Set(context.involvementContext.map(row => row.key));
    for (const proposal of proposals) if (proposal.type === 'story' && proposal.record.kind === 'situation') ids.add('situation/' + proposal.record.id);
    const changes = [];
    for (const change of raw.slice(0, 60)) {
        if (!change || !['enter','leave','wake'].includes(change.action) || typeof change.target !== 'string' || typeof change.reason !== 'string' || !change.reason.trim()
            || typeof change.quote !== 'string' || !change.quote.trim() || change.quote.length > 400) continue;
        const source = context.increment.messages.find(item => item.floor === change.floor && item.role === 'assistant');
        if (!source?.text.includes(change.quote)) continue;
        if (!ids.has(change.target) && !(change.target.startsWith('person-name/') && change.target.length > 12 && change.target.length <= 212 && change.quote.includes(change.target.slice(12)))) continue;
        changes.push({ target:change.target, action:change.action, floor:change.floor, reason:change.reason.trim().slice(0,200), quote:change.quote });
    }
    return changes;
}
