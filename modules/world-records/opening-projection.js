import { memoryDigest } from '../story-summary/data/memory-policy.js';
import { parseStoryUpdates, storyDate } from '../story-state/records.js';
import { createEmptyMapDomain } from '../xiaobai-os/domains/map/state.js';
import { isPrivateStoryField } from './authority.js';
import { OPENING } from './opening.js';

const idFor = (...parts) => 'opening-' + memoryDigest(parts).slice(0,32);
const norm = name => name.trim().normalize('NFKC').toLowerCase();
const scales = new Set(['world','region','city','district','building','floor','room','outdoor']);
const linkKinds = new Set(['door','stairs','elevator','path','road','portal','passage']);
const relationPrefixes = ['关系身份/', '关系身份:', '关系:'];
const locationFields = new Set(['location','所在地','位置','当前地点']);
const personFields = new Set(['外貌','体型','衣着','性格','身份','职务','阵营','身体状况','当前情绪','能力与专长']);
const sourceOf = row => ({module:OPENING,key:row.key,label:row.label});

export function openingOperations(state, rows, {fingerprint,player,oldChat,allowMap = true,commandId}) {
    const operations = [], version = state.version + 1;
    const entities = structuredClone(state.entities), fields = new Map();
    const old = state.sources[OPENING];
    const originalMap = state.modules?.map;
    const map = structuredClone(originalMap || createEmptyMapDomain());
    // Only replace the opening's own cartography while no later map edit exists.
    if (!oldChat && old?.mapVersion && originalMap?.revision === old.mapVersion) {
        map.atlas.locations = map.atlas.locations.filter(item => !old.places.includes(item.key));
        map.atlas.links = map.atlas.links.filter(item => !(old.links || []).includes(item.id));
        map.atlas.actors = map.atlas.actors.filter(item => !old.actors.includes(item.actorKey));
    }
    const places = [], links = [], actors = [];
    const positions = new Map();
    for (const row of rows.filter(item => item.kind === 'position')) {
        const key = norm(row.name);
        if (!positions.has(key)) positions.set(key,new Set());
        positions.get(key).add(norm(row.value));
    }
    const story = structuredClone(state.modules?.story || {version:1,records:[],candidates:[]});
    if (!oldChat) story.records = story.records.filter(item => item.source.module !== OPENING);
    function entity(kind,name,row) {
        const names = [name,...(row.name === name ? row.aliases : [])].map(norm);
        const hits = entities.filter(e => e.kind === kind && [e.name,...e.aliases].some(n => names.includes(norm(n))));
        if (hits.length > 1) return null;
        if (hits.length) {
            const e = hits[0];
            const aliases = row.name === name ? row.aliases.filter(alias => ![e.name,...e.aliases].includes(alias)) : [];
            if (aliases.length) {
                e.aliases.push(...aliases);
                operations.push({type:'rename',entityId:e.id,name:e.name,aliases});
            }
            return e;
        }
        const id = idFor(kind,norm(name)), aliases = row.name === name ? row.aliases : [];
        const created = {id,kind,name,aliases,fields:{},bindings:[]};
        entities.push(created);
        operations.push({type:'create',id,kind,name,aliases,source:sourceOf(row)});
        return created;
    }
    function bind(e,key) {
        const binding = JSON.stringify(['map',key]);
        if (e.bindings.includes(binding)) return;
        e.bindings.push(binding);
        operations.push({type:'bind',entityId:e.id,binding});
    }
    function field(e,key,value,row) {
        if (!e || (e.fields[key] && (e.fields[key].source.module !== OPENING || oldChat))) return;
        const id = JSON.stringify([e.id,key]), prev = fields.get(id);
        if (prev && JSON.stringify(prev.value) !== JSON.stringify(value)) { fields.set(id,{conflict:true}); return; }
        fields.set(id,{type:'set',entityId:e.id,field:key,value,source:sourceOf(row)});
    }
    function place(name,row) {
        if (!name || name.length > 120) return null;
        const e = entity('place',name,row);
        if (!e) return null;
        const matches = map.atlas.locations.filter(p => norm(p.name) === norm(e.name));
        if (matches.length > 1) return null;
        let location = matches[0];
        if (!location) {
            location = {key:idFor('map',e.id),name:e.name,scale:scales.has(row.scale) && row.name === name ? row.scale : 'outdoor',status:'mentioned'};
            map.atlas.locations.push(location); places.push(location.key);
        }
        if (allowMap) bind(e,'place:'+location.key);
        return {e,location};
    }
    for (const row of rows.filter(r => r.kind === 'place')) {
        const p = place(row.name,row);
        if (!p) continue;
        field(p.e,'description',row.value,row);
        if (places.includes(p.location.key) && scales.has(row.scale)) p.location.scale = row.scale;
        const parent = row.parent && place(row.parent,row);
        if (parent && p.e !== parent.e) field(p.e,'parent',{entityId:parent.e.id},row);
    }
    function anchor(e, p, row) {
        if (map.atlas.actors.some(a => norm(a.displayName) === norm(e.name))) return;
        const actorKey = norm(player) === norm(e.name) ? 'player' : idFor('actor',e.id);
        if (map.atlas.actors.some(a => a.actorKey === actorKey)) return;
        map.atlas.actors.push({actorKey,displayName:e.name,locationKey:p.location.key}); actors.push(actorKey);
        bind(e,'actor:'+actorKey);
    }
    function appendStory(row, record) {
        const id = record.id;
        if (story.records.some(item => item.record.id === id || (record.title && item.record.title === record.title && item.record.kind === record.kind))) return;
        const previous = state.modules?.story?.records.find(item => item.record.id === id);
        const source = sourceOf(row);
        const unchanged = previous && memoryDigest([previous.record,previous.source]) === memoryDigest([record,source]);
        story.records.push(unchanged ? previous : {key:id,record,version,eventId:'event:'+commandId,start:0,end:0,nature:'established_fact',source});
    }
    const deferredOwners = [], deferredLocations = [], deferredRelations = [], clockRows = [];
    for (const row of rows) {
        if (row.kind === 'feature') {
            const p = place(row.parent,row);
            if (p && places.includes(p.location.key)) {
                const features = p.location.features ??= [];
                if (!features.some(f => f.name === row.name)) features.push({name:row.name,description:row.value.replace(/\s+/gu,' ')});
            }
        } else if (row.kind === 'route') {
            deferredRelations.push(row);
        } else if (['person','lore','organization','item'].includes(row.kind)) {
            const isWalletField = row.kind === 'person' && ['coins','金币','余额','钱包'].includes(row.field);
            if (isWalletField && norm(row.name) !== norm(player)) continue;
            if (row.kind === 'item' && !row.importance && (!row.owner || norm(row.owner) !== norm(player))) continue;
            const relationPrefix = relationPrefixes.find(prefix => String(row.field || '').startsWith(prefix));
            if (row.kind === 'person' && relationPrefix) { deferredRelations.push(row); continue; }
            if (row.kind === 'person' && locationFields.has(row.field)) { deferredLocations.push(row); continue; }
            const e = entity(row.kind === 'lore' ? 'subject' : row.kind,row.name,row);
            if (row.kind === 'item' && row.importance) field(e,'剧情意义',row.importance,row);
            if (row.kind === 'item' && row.owner) deferredOwners.push({e,row});
            if (isWalletField) {
                const parsedCoins = typeof row.value === 'number'
                    ? (Number.isSafeInteger(row.value) && row.value >= 0 ? row.value : null)
                    : (() => {
                        const raw = String(row.value ?? '').trim();
                        const matched = /^\d+$/.test(raw) ? raw : raw.match(/^(\d+)\s*(?:枚|个)?(?:金币|金|币)?$/)?.[1];
                        const num = matched ? Number(matched) : NaN;
                        return Number.isSafeInteger(num) && num >= 0 ? num : null;
                    })();
                if (parsedCoins !== null) field(e, 'coins', parsedCoins, row);
                else field(e, 'description', row.value, row);
            } else {
                field(e,personFields.has(row.field) ? row.field : 'description',row.value,row);
            }
        } else if (row.kind === 'position' && !oldChat && positions.get(norm(row.name)).size === 1) {
            const p = place(row.value,row), e = entity('person',row.name,row);
            if (!p || !e) continue;
            field(e,'location',{entityId:p.e.id},row);
            anchor(e,p,row);
        } else if (['situation','scenery','suspense'].includes(row.kind) && !oldChat) {
            const id = idFor(row.kind,norm(row.name));
            const [record] = parseStoryUpdates([{kind:row.kind === 'suspense' ? 'suspense' : 'situation',id,title:row.name,description:row.value,status:'open',reason:'',scope:row.scope,
                ...(row.kind === 'scenery' ? {flavor:'scenery'} : {})}]);
            appendStory(row,record);
        } else if (row.kind === 'clock' && !oldChat) {
            clockRows.push(row);
        }
    }
    // WHY: entity creation order inside one batch is arbitrary, so cross-record
    // references (owner, relationship, route, current place) resolve only after
    // every named object exists.
    for (const {e,row} of deferredOwners) {
        const owners = entities.filter(person => ['person','organization'].includes(person.kind) && [person.name,...person.aliases].includes(row.owner));
        if (owners.length === 1) field(e,'owner',{entityId:owners[0].id},row);
    }
    for (const row of deferredLocations) {
        const e = entity('person',row.name,row), p = place(row.value,row);
        if (!e || !p) continue;
        field(e,'location',{entityId:p.e.id},row);
        if (!oldChat) anchor(e,p,row);
    }
    for (const row of deferredRelations.filter(item => item.kind === 'route')) {
        const from = place(row.name,row), to = place(row.value,row);
        if (!from || !to || from.location.key === to.location.key) continue;
        const id = idFor('link',from.location.key,to.location.key);
        if (map.atlas.links.some(link => link.id === id)) continue;
        // WHY: row.label is the source-fragment title; only the model-provided
        // channel name (routeLabel) may become a map link label.
        const linkLabel = row.routeLabel ?? (row.key ? '' : row.label);
        map.atlas.links.push({id,from:from.location.key,to:to.location.key,
            kind:linkKinds.has(row.field) ? row.field : 'path',bidirectional:true,...(linkLabel ? {label:linkLabel} : {})});
        links.push(id);
    }
    for (const row of deferredRelations.filter(item => item.kind === 'person')) {
        const prefix = relationPrefixes.find(item => String(row.field || '').startsWith(item));
        const targetName = row.field.slice(prefix.length).trim();
        const e = entity('person',row.name,row);
        const hits = entities.filter(person => person.id !== e?.id && ['person','subject'].includes(person.kind)
            && [person.name,...person.aliases].some(name => norm(name) === norm(targetName)));
        if (!e || hits.length !== 1 || !row.value.trim()) continue;
        field(e, '关系身份/' + hits[0].id, { entityId:hits[0].id, role:row.value.trim() }, row);
    }
    if (!oldChat && clockRows.length) {
        const row = clockRows.at(-1), raw = row.value.trim();
        const record = { id:'clock', kind:'clock', label:raw && raw !== row.name ? `${row.name} · ${raw}` : row.name,
            ...(storyDate(raw) ? { date:raw } : {}) };
        appendStory(row,record);
    }
    // Pass 2: project non-public secret/rumor/condition claims after core entities exist so secrets attach cleanly to named persons.
    // WHY: Keeping private claims out of established fields prevents NPC public prompts from leaking secrets/untriggered conditions.
    const desiredClaims = new Map();
    for (const row of rows.filter(r => ['secret', 'rumor', 'condition'].includes(r.kind))) {
        const hits = entities.filter(x => [x.name, ...(x.aliases || [])].some(n => norm(n) === norm(row.name)));
        const e = hits.length === 1 ? hits[0] : entity('subject', row.name, row);
        if (!e) continue;
        const rawField = typeof row.field === 'string' ? row.field.trim() : '';
        let claimField, nature;
        if (row.kind === 'secret') {
            claimField = isPrivateStoryField(rawField) ? rawField : rawField ? `秘密：${rawField}` : '秘密';
            nature = 'unclassified';
        } else if (row.kind === 'condition') {
            claimField = isPrivateStoryField(rawField) ? rawField : rawField ? `管理员私有/${rawField}` : '管理员私有/触发条件';
            nature = 'hypothesis';
        } else {
            claimField = rawField || '传闻';
            nature = 'rumor';
        }
        const claimId = 'claim:' + idFor('opening-claim', e.id, row.kind, claimField, memoryDigest([row.value, row.key]));
        desiredClaims.set(claimId, {
            type: 'claim',
            id: claimId,
            entityId: e.id,
            field: claimField,
            value: row.value,
            nature,
            source: sourceOf(row),
        });
    }
    for (const claimOp of desiredClaims.values()) {
        if (!state.claims.some(c => c.id === claimOp.id)) operations.push(claimOp);
    }
    if (!oldChat) {
        for (const existing of state.claims) {
            if (existing.status === 'pending' && existing.source?.module === OPENING && !desiredClaims.has(existing.id)) {
                operations.push({ type: 'resolve', claimId: existing.id, status: 'withdrawn' });
            }
        }
    }
    const byId = new Map(entities.map(e => [e.id,e]));
    for (const op of fields.values()) {
        if (op.conflict) continue;
        const previous = byId.get(op.entityId).fields[op.field];
        if (!previous || memoryDigest([previous.value,previous.source]) !== memoryDigest([op.value,op.source])) operations.push(op);
    }
    if (!oldChat) for (const e of state.entities) for (const [key,entry] of Object.entries(e.fields)) {
        const next = fields.get(JSON.stringify([e.id,key]));
        if (entry.source.module === OPENING && (!next || next.conflict)) operations.push({type:'clear_opening_field',entityId:e.id,field:key});
    }
    for (const location of map.atlas.locations.filter(p => allowMap && places.includes(p.key))) {
        const bound = entities.find(e => e.bindings.includes(JSON.stringify(['map','place:'+location.key])));
        const value = key => fields.get(JSON.stringify([bound.id,key]))?.value ?? bound.fields[key]?.value;
        const parent = entities.find(e => e.id === value('parent')?.entityId);
        const parentKey = map.atlas.locations.find(p => parent?.bindings.includes(JSON.stringify(['map','place:'+p.key])))?.key;
        if (parentKey) location.parent = parentKey;
        if (value('description')) location.brief = value('description').replace(/\s+/gu,' ');
    }
    const changedMap = allowMap && memoryDigest(map) !== memoryDigest(originalMap || createEmptyMapDomain());
    if (changedMap) operations.push({type:'module',module:'map',value:{...map,revision:version}});
    if (memoryDigest(story.records) !== memoryDigest(state.modules?.story?.records || [])) operations.push({type:'module',module:'story',value:{...story,revision:version}});
    operations.push({type:'source',module:OPENING,snapshot:{fingerprint,rows,places,links,actors,mapVersion:changedMap ? version : originalMap?.revision || 0}});
    return operations;
}

