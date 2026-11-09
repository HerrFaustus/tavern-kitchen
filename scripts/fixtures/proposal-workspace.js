import { createKitchenWorkspace } from '../../core/kitchen-workspace.js';
import { isTrustedMessage } from '../../core/iframe-messaging.js';
import { createWorldArchive } from '../../modules/world-records/host.js';
import { getWorldBridge } from '../../modules/world-records/bridge.js';
import { storyIdentityKey, readWorldSources } from '../../modules/world-records/sources.js';
import { captureStoryIdentity } from '../../modules/xiaobai-os/host/story-identity.js';
import { buildUpdateContext, worldUpdates } from '../../modules/world-records/update-context.js';
import { prepareWorldUpdate } from '../../modules/world-records/update-result.js';

// Isolated, synthetic chat. The same archive, service and IndexedDB code run in
// the host; only the Tavern context and summary frame messages are fixtures.
export async function mountFixture() {
    const chat = [
        { mes: '买下铁剑。', is_user: true, send_date: 'u' },
        { mes: '主角原有10金币、铁匠原有0金币。主角支付五金币，铁匠收到五金币，铁剑交给主角。', send_date: 'a' },
    ];
    const context = { chatId:'isolated-proposal-test', characterId:0, characters:[{avatar:'fixture.png'}], name1:'主角', chat };
    const memory = { enabled:true, store:{ summaryHistory:[], json:{} } };
    const errors = [];
    const workspace = createKitchenWorkspace({});
    const archive = createWorldArchive({ getContext:()=>context, getMemorySnapshot:()=>memory, getMount:id=>workspace.getMount(id),
        isVisible:id=>workspace.isActive(id), onError:error=>errors.push(error.message) });
    const { service } = getWorldBridge(storyIdentityKey(captureStoryIdentity(context)));
    let state = await service.syncTurns(chat);
    const source = {module:'manual',key:'fixture',label:'开局'};
    state = (await service.commit(service.command(state,[
        ...[['hero','主角','person'],['smith','铁匠','person'],['sword','铁剑','item']]
            .map(([id,name,kind])=>({type:'create',id,name,kind,source})),
        {type:'set',entityId:'hero',field:'coins',value:10,source},
        {type:'set',entityId:'smith',field:'coins',value:0,source},
        {type:'set',entityId:'sword',field:'owner',value:{entityId:'smith'},source},
    ],'开局'))).state;
    const storyIdentity = storyIdentityKey(captureStoryIdentity(context));
    state = await service.sync(readWorldSources().filter(item=>item.identity===storyIdentity));
    const receipt = service.memorySourceReceipt(state,chat,0,1);
    const input = buildUpdateContext(state,memory.store,chat,receipt);
    const evidence = {floor:1,quote:'主角支付五金币，铁匠收到五金币，铁剑交给主角。'};
    const change = (entityId,field,before,value) => ({type:'field',entityId,field,before:{present:true,value:before},value,
        nature:'established_fact',certainty:'uncertain',groupId:'trade',evidence});
    const update = prepareWorldUpdate({basis:{worldId:state.worldId,branchId:state.branchId,version:state.version},
        proposals:[change('hero','coins',10,5),change('smith','coins',0,5),change('sword','owner',{entityId:'smith'},{entityId:'hero'}),
            {type:'field',entityId:'smith',field:'真实身份',before:{present:false},value:'隐藏的幕后首脑',
                nature:'established_fact',certainty:'uncertain',groupId:'secret',evidence}],
        conflicts:[],acknowledgedReceipts:input.executionReceipts.map(item=>item.commandId)},input);
    memory.store.summaryHistory.push({worldUpdate:update,sourceReceipt:receipt,summary:'买下铁剑。',endMesId:1});
    await service.syncTurns(chat,{history:memory.store.summaryHistory});
    let frame;
    function openView(view) {
        if (!frame) {
            frame = globalThis.document.createElement('iframe');
            frame.addEventListener('load',()=>workspace.attachFrame(frame));
            // eslint-disable-next-line no-restricted-syntax -- The listener checks the origin and owning iframe below.
            globalThis.addEventListener('message',event=>{
                if (!isTrustedMessage(event,frame,'TavernKitchen-StoryFrame')) return;
                const reply = data => frame.contentWindow.postMessage({source:'TavernKitchen',...data},globalThis.location.origin);
                if (event.data.type === 'FRAME_READY') {
                    reply({type:'LOAD_PANEL_CONFIG',config:{}});
                    reply({type:'KITCHEN_MEMORY_VIEW',view:workspace.isActive('situation') ? 'world' : workspace.isActive('data') ? 'data' : 'people'});
                }
            });
            frame.src='/scripts/extensions/third-party/tavern-kitchen/modules/story-summary/story-summary.html';
            workspace.getMount('situation').append(frame);
        } else frame.contentWindow.postMessage({source:'TavernKitchen',type:'KITCHEN_MEMORY_VIEW',view},globalThis.location.origin);
        if (view === 'world') archive.showProposals(frame);
        if (view === 'data') archive.showRecovery(frame);
    }
    workspace.configure({ actions:{situation:()=>openView('world'),people:()=>openView('people'),data:()=>openView('data')},
        panelSwitch:()=>({enabled:true,label:'启用局势',change(){}}) });
    globalThis.fixture = {workspace,archive,service,errors,chat,read:async()=>{const next=await service.read();
        return {worldId:next.worldId,branchId:next.branchId,version:next.version,entities:next.entities,updates:worldUpdates(next),receipts:next.receipts};}};
    await workspace.open('situation');
}
