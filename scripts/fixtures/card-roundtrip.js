import { createKitchenCards } from '../../modules/kitchen-data/card.js';
import { createWorldCardData } from '../../modules/kitchen-data/world.js';
import { createWorldStorage } from '../../modules/world-records/storage.js';
import { emptyWorld, applyCommand, forkWorld } from '../../modules/world-records/domain.js';
import { createNoteStore } from '../../modules/story-planner/storage.js';
import { plannerSnapshot, publishNotes } from '../../modules/story-planner/notes.js';
import { createPlanner } from '../../modules/story-planner/runtime.js';

// Real browser IndexedDB with an isolated synthetic chat and branch.
export async function testCardRoundTrip() {
    const storage=createWorldStorage(), notes=createNoteStore(), chat=[{mes:'灯塔的灯重新亮起。',send_date:'a'}];
    const plannerMemory={enabled:true,store:{json:{},summaryHistory:[]}};
    let branch='', current={identity:'isolated-card',source:{digest:'fixture',length:1},
        memory:{storySummary:{json:{facts:[]},summaryHistory:[],lastSummarizedMesId:-1,apiKey:'not data'},stateAtoms:[],l0Index:{version:1,byFloor:{}}},
        summary:{type:'TavernKitchenStorySummaryMemory',version:1,exportedAt:'2026-11-09T00:00:00Z',data:{facts:[],rounds:[]}}};
    const identity=(override=branch)=>'isolated-card'+override;
    const initial=applyCommand(emptyWorld('world','branch','灯塔'),{id:'fixture',worldId:'world',branchId:'branch',expectedVersion:0,
        at:'2026-11-09T00:00:00Z',title:'建立人物',operations:[{type:'create',id:'traveler',kind:'person',name:'旅人',
            source:{module:'manual',key:'fixture',label:'手工设定'}}]}).state;
    await storage.update(identity(),()=>({state:initial}));
    const initialSnap=plannerSnapshot(initial,plannerMemory,chat,identity());
    await notes.put(publishNotes(JSON.stringify({global:{text:'世界正在变冷',dependencies:[]},chapter:{text:'灯塔等待来客',dependencies:[]}}),null,initialSnap,'opening'));
    const world=createWorldCardData({identity,storage,service:{read:()=>storage.read(identity())},noteStore:notes});
    const memory={read:()=>structuredClone(current),async write(callback){return callback({assertCurrent(){},async commit(data,namespace,guard){
        guard();current={...current,memory:data.memory};branch=namespace;
    }});}};
    const cards=createKitchenCards({memory,world,isCurrent:id=>id==='isolated-card'});
    const card=await cards.export(), previousOwner=identity();
    await cards.import(card);
    const imported=await world.read(), snap=plannerSnapshot(imported.world,plannerMemory,chat,identity());
    let calls=0;
    const planner=createPlanner({snapshot:()=>snap,store:notes,write:async()=>{calls++;throw new Error('unexpected');},status:()=>{}});
    const chapter=await planner.prepare();
    const saved=(await notes.list(snap.owner))[0];
    await storage.update(identity(),state=>({state:forkWorld(state,state.version,'legacy-branch')}));
    await notes.putImported(identity(),[{...structuredClone(saved),id:'legacy-fixture',owner:identity(),revision:saved.revision+1,
        chapter:{text:'旧导入章节札记',dependencies:[]}}],()=>true);
    const legacySnap=plannerSnapshot(await storage.read(identity()),plannerMemory,chat,identity());
    const legacyPlanner=createPlanner({snapshot:()=>legacySnap,store:notes,write:async()=>{calls++;throw new Error('unexpected');},status:()=>{}});
    const recovered=await legacyPlanner.prepare();
    const invalid=structuredClone(card);invalid.data.notes[0].chapter.dependencies=[null];
    const active=identity();let rejected=false;
    try { await cards.import(invalid); } catch { rejected=true; }
    const result={exportedNotes:card.data.notes.length,containsSetting:'apiKey' in card.data.memory.storySummary,
        branchChanged:previousOwner!==active,chapter,recovered,calls,rejected,activeUnchanged:identity()===active,
        notesAfterRecovery:(await notes.list(legacySnap.owner)).length,sourcePreserved:saved.source===card.data.notes[0].source,
        revisionPreserved:saved.revision===card.data.notes[0].revision};
    await storage.close();
    return result;
}
