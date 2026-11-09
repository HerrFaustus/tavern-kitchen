import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { IDBFactory } from 'fake-indexeddb';
import { parseHTML } from 'linkedom';
import { createWorldStorage } from './storage.js';
import { createWorldService } from './service.js';
import { createWorldRecoveryPanel } from './recovery-panel.js';
import { currentTurns, turnEffectConflicts } from './turn-ledger.js';
import { isRangeSourceCurrent } from '../story-summary/data/turn-source.js';

async function fixture(t) {
    const {document,window}=parseHTML('<html><body><section id="history" hidden></section></body></html>');
    const create=document.createElement.bind(document);
    document.createElement=(tag,...args)=>{const node=create(tag,...args);
        if(tag==='select'){let value='';Object.defineProperty(node,'value',{get:()=>value,set:next=>{value=String(next);}});}
        node.focus ||= ()=>{};return node;};
    const storage=createWorldStorage({indexedDB:new IDBFactory()});t.after(()=>storage.close());
    const chat=[{mes:'买剑',is_user:true,send_date:'u'},{mes:'付五金币，拿到剑。',send_date:'a'}];
    let identity='chat-a',seq=0,summary='summary';
    const service=createWorldService({storage,getIdentity:()=>identity,id:()=>`branch-${++seq}`,
        isSourceCurrent:turn=>!!turn && isRangeSourceCurrent(turn.source,chat)});
    let state=await service.syncTurns(chat),turn=currentTurns(state)[0];
    const source={module:'narrative',key:turn.id,label:'正文'};
    state=(await service.commit(service.effectCommand(state,turn.id,'sword',
        [{type:'create',id:'sword',kind:'item',name:'铁剑',source}], '秘密行动'))).state;
    const original=state;
    state=(await service.commit(service.command(state,[{type:'set',entityId:'sword',field:'description',value:'新刻痕',
        source:{module:'manual',key:'fixture',label:'手动'}}],'后续修改'))).state;
    const root=document.querySelector('#history');
    const panel=createWorldRecoveryPanel({service,getIdentity:()=>identity,getStamp:()=>JSON.stringify([chat,summary]),
        readState:()=>service.syncTurns(chat)});
    panel.mount(root);await panel.refresh();
    const click=text=>{const b=[...root.querySelectorAll('button')].find(node=>node.textContent===text);assert.ok(b,text);b.click();return b;};
    const set=(name,value)=>{const node=root.querySelector(`[aria-label="${name}"]`);assert.ok(node,name);node.value=value;node.dispatchEvent(new window.Event('change',{bubbles:true}));};
    const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await setImmediate();}assert.fail(root.textContent);};
    return {root,panel,service,storage,chat,state,original,click,set,wait,setIdentity:value=>{identity=value;service.invalidate();},setSummary:value=>{summary=value;}};
}

test('restore forks history, preserves the old branch, and can switch back without disclosing event titles',async t=>{
    const f=await fixture(t);assert.doesNotMatch(f.root.textContent,/秘密行动|新刻痕/);
    f.set('恢复到的世界版本',String(f.original.version));f.click('恢复到此版本');
    assert.match(f.root.textContent,/聊天和总结不变/);
    const confirm=f.click('确认恢复');confirm.click();
    await f.wait(()=>f.root.textContent.includes('已切换到第'));
    let next=await f.service.read();assert.notEqual(next.branchId,f.state.branchId);assert.equal(next.version,f.original.version);
    assert.equal(next.entities[0].fields.description,undefined);assert.deepEqual(next.receipts,f.original.receipts);
    assert.equal((await f.service.branches()).length,2);
    f.set('保留的世界分支',f.state.branchId);f.click('切换分支');f.click('确认切换');
    await f.wait(()=>f.root.textContent.includes(`已切换到第 ${f.state.version} 版`));
    next=await f.service.read();assert.equal(next.branchId,f.state.branchId);assert.equal(next.entities[0].fields.description.value,'新刻痕');
    assert.equal((await f.service.branches()).length,2);
});

test('changed source recommends a version before the first affected receipt and resolves its conflict on synchronization',async t=>{
    const f=await fixture(t);f.chat[1].mes='没有买剑。';await f.panel.refresh();
    assert.match(f.root.textContent,new RegExp(`建议恢复到第 ${f.original.version-1} 版`));
    assert.equal(f.root.querySelector('[aria-label="恢复到的世界版本"]').value,String(f.original.version-1));
    f.click('恢复到此版本');f.click('确认恢复');await f.wait(()=>f.root.textContent.includes('已切换到第'));
    const restored=await f.service.syncTurns(f.chat);assert.deepEqual(turnEffectConflicts(restored),[]);
    assert.equal(restored.entities.length,0);assert.equal((await f.service.branches()).length,2);
});

test('moving an unchanged source to another floor does not suggest a destructive rollback',async t=>{
    const f=await fixture(t);f.chat.unshift({mes:'更早的开场。',send_date:'opening'});
    await f.panel.refresh();
    assert.doesNotMatch(f.root.textContent,/正文来源有变|建议恢复/);
    assert.deepEqual(turnEffectConflicts(await f.service.read()),[]);
    assert.equal((await f.service.read()).entities[0].name,'铁剑');
});

test('stale summary or branch scope rejects a previously displayed confirmation without replacing the world',async t=>{
    const f=await fixture(t);f.click('恢复到此版本');f.setSummary('changed');f.click('确认恢复');
    await f.wait(()=>!!f.root.querySelector('[role="alert"]'));assert.match(f.root.textContent,/已变化/);
    assert.equal((await f.service.read()).branchId,f.state.branchId);assert.equal((await f.service.branches()).length,1);
    f.click('重新读取');await f.wait(()=>!f.root.querySelector('[role="alert"]'));
    f.click('恢复到此版本');const fork=await f.service.fork(f.state,f.state.version);
    await f.service.selectBranch(f.state.branchId,fork);
    f.click('确认恢复');await f.wait(()=>!!f.root.querySelector('[role="alert"]'));
    assert.equal((await f.service.read()).branchId,f.state.branchId);assert.equal((await f.service.branches()).length,2);
});

test('a source change during the IndexedDB transaction aborts the fork',async t=>{
    const f=await fixture(t);f.click('恢复到此版本');
    const update=f.storage.update;f.storage.update=(...args)=>{f.chat[1].mes='正文改了';return update(...args);};
    f.click('确认恢复');await f.wait(()=>!!f.root.querySelector('[role="alert"]'));
    assert.equal((await f.service.read()).branchId,f.state.branchId);assert.equal((await f.service.branches()).length,1);
});

test('invalid custom version is rejected and no-chat view never creates a world',async t=>{
    const f=await fixture(t);f.set('恢复到的世界版本','custom');
    const field=f.root.querySelector('[aria-label="其他世界版本"]');field.value='-1';f.click('恢复到此版本');
    assert.match(f.root.textContent,/有效版本号/);assert.equal((await f.service.branches()).length,1);
    f.setIdentity('');f.panel.reset();await f.panel.refresh();assert.match(f.root.textContent,/选择聊天后/);
});

test('a failed branch list remains retryable without changing the current world',async t=>{
    const f=await fixture(t),branches=f.service.branches;
    f.service.branches=async()=>{throw new Error('暂时无法读取');};
    await f.panel.refresh();assert.match(f.root.textContent,/暂时无法读取/);
    f.service.branches=branches;f.click('重新读取');
    await f.wait(()=>!!f.root.querySelector('[aria-label="恢复到的世界版本"]'));
    assert.equal((await f.service.read()).branchId,f.state.branchId);
});

test('a newer world version marks the shown recovery choices stale',async t=>{
    const f=await fixture(t),next=await f.service.commit(f.service.command(f.state,[{type:'set',entityId:'sword',field:'description',value:'另一处刻痕',
        source:{module:'manual',key:'fixture',label:'手动'}}],'更新'));
    f.panel.noteChange(next.state);assert.match(f.root.textContent,/请重新读取/);
    f.click('恢复到此版本');f.click('确认恢复');await f.wait(()=>f.root.textContent.includes('档案已更新'));
    assert.equal((await f.service.read()).version,next.state.version);
});
