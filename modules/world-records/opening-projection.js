import { memoryDigest } from '../story-summary/data/memory-policy.js';
import { parseStoryUpdates } from '../story-state/records.js';
import { createEmptyMapDomain } from '../xiaobai-os/domains/map/state.js';
import { OPENING } from './opening.js';

const idFor = (...parts) => 'opening-' + memoryDigest(parts).slice(0,32);
const norm = name => name.trim().normalize('NFKC').toLowerCase();
const scales = new Set(['world','region','city','district','building','floor','room','outdoor']);
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
        map.atlas.actors = map.atlas.actors.filter(item => !old.actors.includes(item.actorKey));
    }
    const places = [], actors = [];
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
    for (const row of rows) {
        if (row.kind === 'feature') {
            const p = place(row.parent,row);
            if (p && places.includes(p.location.key)) {
                const features = p.location.features ??= [];
                if (!features.some(f => f.name === row.name)) features.push({name:row.name,description:row.value.replace(/\s+/gu,' ')});
            }
        } else if (['person','lore','organization','item'].includes(row.kind)) {
            const e = entity(row.kind === 'lore' ? 'subject' : row.kind,row.name,row);
            field(e,personFields.has(row.field) ? row.field : 'description',row.value,row);
        } else if (row.kind === 'position' && !oldChat && positions.get(norm(row.name)).size === 1) {
            const p = place(row.value,row), e = entity('person',row.name,row);
            if (!p || !e) continue;
            field(e,'location',{entityId:p.e.id},row);
            if (!map.atlas.actors.some(a => norm(a.displayName) === norm(e.name))) {
                const actorKey = norm(player) === norm(e.name) ? 'player' : idFor('actor',e.id);
                if (map.atlas.actors.some(a => a.actorKey === actorKey)) continue;
                map.atlas.actors.push({actorKey,displayName:e.name,locationKey:p.location.key}); actors.push(actorKey);
                bind(e,'actor:'+actorKey);
            }
        } else if (['situation','scenery'].includes(row.kind) && !oldChat) {
            const id = idFor(row.kind,norm(row.name));
            if (story.records.some(item => item.record.id === id || item.record.title === row.name)) continue;
            const [record] = parseStoryUpdates([{kind:'situation',id,title:row.name,description:row.value,status:'open',scope:row.scope,
                ...(row.kind === 'scenery' ? {flavor:'scenery'} : {})}]);
            const previous = state.modules?.story?.records.find(item => item.record.id === id);
            const source = sourceOf(row);
            const unchanged = previous && memoryDigest([previous.record,previous.source]) === memoryDigest([record,source]);
            story.records.push(unchanged ? previous : {key:id,record,version,eventId:'event:'+commandId,start:0,end:0,nature:'established_fact',source});
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
    operations.push({type:'source',module:OPENING,snapshot:{fingerprint,rows,places,actors,mapVersion:changedMap ? version : originalMap?.revision || 0}});
    return operations;
}

