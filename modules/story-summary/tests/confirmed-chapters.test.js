import assert from 'node:assert/strict';
import test from 'node:test';
import { createChapterProcessing } from '../../../core/chapter-processing.js';
import { captureRangeSource } from '../data/turn-source.js';
import { planNextCompression, selectHistoryNodesBefore, summaryLayers } from '../data/summary-layers.js';
import { createMemorySession } from '../maintenance/session.js';
import { commitMemorySession } from '../maintenance/commit.js';
import { watchChapterSaves } from '../maintenance/notification.js';
import { maintenanceFixture } from './fixtures/memory-maintenance.js';

const check = () => true;
test('confirmed review saves six stages and three chapters, retries only L3 and later produces L4', async t => {
    const current = maintenanceFixture();
    current.chat = Array.from({length:36},(_,i)=>({is_user:i%2===0,mes:'渡口进展第'+(i+1)+'楼。'}));
    current.store = {json:current.json,lastSummarizedMesId:-1,summaryHistory:[]};
    const requests=[], writer=[], saved=[];
    t.after(watchChapterSaves({enabled:()=>true,changed:()=>saved.push(current.cutoff)}));
    const ports = {read:()=>current, async commit(next,_prior,_impact,guard) {
        guard(); current.store=structuredClone(next.storySummary); current.json=current.store.json; return next;
    }};
    const generate = async ({level,depth,children}) => {
        requests.push(depth || level);
        if (depth===3 && fail) throw new Error('跨章连接失败');
        return '渡口调查 '+children[0].start+'–'+children.at(-1).end;
    };
    let fail=false;
    const memory = {getPublishedSummaryStore:()=>current.store,generateReviewedLayer:generate,async saveFloorWork(source,guard,edit) {
        guard(); const next=structuredClone(current.store);
        edit((next.floorWork??={})[source.end]??={source,digest:source.digest,done:[]},next); current.store=next;
    }};
    const reopen = () => createChapterProcessing({read:()=>current,memory,requireUpdate:async()=>{},reviewEnabled:()=>true,
        plannerEnabled:()=>true,writeChapter:async source=>writer.push(source.end)});
    let process=reopen();
    const round = n => {
        const source=captureRangeSource(current.chat,n*2,n*2+1);
        current.store.summaryHistory.push({format:2,kind:'batch',previousEndMesId:n*2-1,endMesId:source.end,maintenance:[],undo:{version:1},
            summary:'渡口第'+n+'轮',roundSource:source});
        current.cutoff=current.store.lastSummarizedMesId=source.end;
        return source;
    };
    async function close(session,level,from,to) {
        const units=await session.reviewUnit('ReadNarrativeUnits',{level},current);
        const res=await session.reviewUnit('CloseNarrativeUnit',{level,from,to,revision:units.revision,reason:'渡口阶段线索闭合',
            evidence:{floor:to,quote:current.chat[to-1].mes}},current,async()=>current);
        assert.equal(res.status,'staged');
    }
    for(let i=0;i<9;i++){
        round(i*2); const source=round(i*2+1);
        const session=createMemorySession({...current,generateReviewedLayer:generate});
        await close(session,'stage',i*4+1,i*4+2); await close(session,'stage',i*4+3,i*4+4);
        await close(session,'chapter',i*4+1,i*4+4);
        await commitMemorySession(session,{runId:'chapter-'+i,calls:[],mode:'chat'},ports);
        assert.equal(saved.at(-1),source.end);
        if(i===2) {
            fail=true; await assert.rejects(process.run(source,undefined,check),/跨章连接失败/);
            assert.equal(summaryLayers(current.store.summaryHistory).parents.filter(n=>n.level==='chapter').length,3);
            fail=false; process=reopen();
        }
        assert.ok(process.pending(source,current.store));
        await process.run(source,undefined,check);
        assert.equal(process.pending(source,current.store),false);
        if(i<2) assert.equal(requests.filter(n=>n===3).length,0);
    }
    assert.deepEqual(writer,[3,7,11,15,19,23,27,31,35]);
    const tree=summaryLayers(current.store.summaryHistory,[],{chat:current.chat});
    const onlyRounds=structuredClone(current.store.summaryHistory.slice(0,15));
    for(const batch of onlyRounds) {delete batch.reviewLayers;delete batch.compressionNodes;}
    assert.equal(planNextCompression(onlyRounds,{chat:current.chat}),null);
    const gap=structuredClone(current.store.summaryHistory.slice(0,8));
    for(const batch of gap) {
        delete batch.compressionNodes;
        if(batch.endMesId===7) batch.reviewLayers=batch.reviewLayers.filter(node=>node.level!=='chapter');
    }
    assert.equal(summaryLayers(gap,[],{chat:current.chat}).parents.filter(n=>n.level==='chapter').length,3);
    assert.equal(planNextCompression(gap,{chat:current.chat}),null);
    const top=tree.roots[0]; assert.equal(top.depth,4); assert.equal(tree.roots.length,1);
    assert.equal(tree.byId.get(top.childIds[0]).childIds.length,3);
    assert.equal(requests.filter(n=>n===3).length,4);
    assert.equal(selectHistoryNodesBefore(current.store.summaryHistory,current.chat,36)[0].depth,4);
    const unrelated=structuredClone(current.store);
    unrelated.summaryHistory=unrelated.summaryHistory.filter(row=>row.endMesId!==5);
    assert.equal(summaryLayers(unrelated.summaryHistory,[],{chat:current.chat}).parents.some(n=>n.id===top.id),false);
    current.chat[5].mes='改选报价。';
    assert.equal(summaryLayers(current.store.summaryHistory,[],{chat:current.chat}).parents.some(n=>n.id===top.id),false);
});
