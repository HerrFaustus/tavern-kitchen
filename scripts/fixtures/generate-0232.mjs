// Generate the fictional upgrade fixture using the released implementation.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { IDBFactory } from 'fake-indexeddb';

const root = path.resolve(import.meta.dirname, '../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-old-release-'));
const ref = '5061466';
try {
    const tar = execFileSync('git', ['-C',root,'archive',ref,'shared','modules','core','libs/js-sha256.mjs','package.json'], {maxBuffer:64*1024*1024});
    execFileSync('tar', ['xf','-','-C',temporary], {input:tar});
    fs.symlinkSync(path.join(root,'node_modules'), path.join(temporary,'node_modules'), 'dir');
    // eslint-disable-next-line no-unsanitized/method -- Only the fixed source paths below from the pinned commit are imported.
    const old = file => import(pathToFileURL(path.join(temporary,file)));
    const { createWorldService } = await old('modules/world-records/service.js');
    const { createWorldStorage } = await old('modules/world-records/storage.js');
    const { captureRangeSource } = await old('modules/story-summary/data/turn-source.js');
    const { createKitchenCards } = await old('modules/kitchen-data/card.js');
    const { plannerOwner } = await old('modules/story-planner/identity.js');
    const storage = createWorldStorage({indexedDB:new IDBFactory()});
    const identity = JSON.stringify(['fixture-user',JSON.stringify(['character','merchant.png','清河县'])]);
    const date = '2026-11-01T00:00:00.000Z';
    let sequence = 0;
    const service = createWorldService({storage,getIdentity:()=>identity,id:()=> 'old-' + ++sequence, now:()=>date});
    const source = {module:'manual',key:'清河旧事',label:'开局清册'};
    const chat = [{name:'旅人',mes:'进镇。',is_user:true,send_date:'u1'}, {name:'店主',mes:'东桥有守卫。',send_date:'a1'}];
    const state = await service.ensure('清河县旧档');
    const ops = [['hero','person','旅人'],['shop','person','店主'],['bell','item','铜铃'],['bridge','place','东桥']].map(([id,kind,name])=>({type:'create',id,kind,name,source}));
    const field = (entityId,field,value)=>({type:'set',entityId,field,value,source});
    ops.push(field('hero','coins',10),field('shop','coins',37),field('bell','owner',{entityId:'shop'}),field('bridge','通行状态','可通行'));
    ops.push({type:'bind',entityId:'bridge',binding:JSON.stringify(['map','place:bridge'])});
    const kept = (await service.commit(service.command(state,ops,'旧世界开局'))).state;
    const selected = await service.fork(kept,kept.version);
    const live = (await service.commit(service.command(selected,[field('bridge','通行状态','已封锁')],'东桥封锁'))).state;
    const summary = {type:'TavernKitchenStorySummaryMemory',version:1,exportedAt:date,data:{facts:[],rounds:[],arcs:[{name:'阿棠',progress:30}]}};
    const memory = {storySummary:{summaryHistory:[],lastSummarizedMesId:-1,json:{facts:[],arcs:summary.data.arcs}},stateAtoms:[],l0Index:{version:1,byFloor:{}}};
    const digest = captureRangeSource(chat,0,1).digest;
    const notes = [kept,live].map((world,i)=>({id:'note-'+i,revision:1,owner:plannerOwner(identity,world),end:1,source:digest,basis:world.version,
        chapter:{text:i?'东桥封锁旧稿':'东桥通行旧稿',dependencies:[]},global:{text:'清河调查',dependencies:[]}}));
    const cards = createKitchenCards({memory:{read:()=>({identity,memory,summary,source:{digest,length:2}})},world:{read:async()=>({world:live,notes:notes.slice(1)})},isCurrent:()=>true});
    const card = await cards.export(); card.createdAt=date;
    const fixture = {commit:ref,chat,identity,selected:live.branchId,branches:[kept,live],notes,metadata:{extensions:{TavernKitchen:memory}},card};
    fs.writeFileSync(path.join(root,'scripts/fixtures/chat-0.2.32.json'), JSON.stringify(fixture,null,2)+'\n');
    await storage.close();
} finally { fs.rmSync(temporary,{recursive:true,force:true}); }
