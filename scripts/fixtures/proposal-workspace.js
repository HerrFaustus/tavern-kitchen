import { createKitchenWorkspace, bindKitchenSurface } from '../../core/kitchen-workspace.js';
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
        nature:'established_fact',certainty:'explicit',groupId:'trade',evidence});
    const update = prepareWorldUpdate({basis:{worldId:state.worldId,branchId:state.branchId,version:state.version},
        proposals:[change('hero','coins',10,5),change('smith','coins',0,5),change('sword','owner',{entityId:'smith'},{entityId:'hero'}),
            {type:'field',entityId:'smith',field:'真实身份',before:{present:false},value:'隐藏的幕后首脑',
                nature:'established_fact',certainty:'uncertain',groupId:'secret',evidence}],
        conflicts:[],acknowledgedReceipts:input.executionReceipts.map(item=>item.commandId)},input);
    memory.store.summaryHistory.push({worldUpdate:update,sourceReceipt:receipt,summary:'买下铁剑。',endMesId:1});
    await archive.prepare();
    let host = null;
    let ui = null;
    async function openView(view) {
        if (!host) {
            const { loadBuildEntry } = await import(/* @vite-ignore */ '/scripts/extensions/third-party/tavern-kitchen/core/build-assets.js');
            host = globalThis.document.createElement('div');
            host.className = 'tk-embedded-host';
            const shadow = host.attachShadow({ mode: 'open' });
            const surface = globalThis.document.createElement('div');
            surface.className = 'tk-surface tk-embedded tk-follow-host';
            shadow.append(surface);
            workspace.getMount('situation').append(host);
            bindKitchenSurface(host, surface);
            const mod = await loadBuildEntry('apps/story-summary', shadow, { includeEmbedded: true });
            ui = mod.mountStorySummaryUI({
                root: shadow,
                surface,
                postToHost(msg) {
                    if (msg.type === 'FRAME_READY') {
                        ui.receiveHostMessage({ source:'TavernKitchen', type:'LOAD_PANEL_CONFIG', config:{} });
                        ui.receiveHostMessage({ source:'TavernKitchen', type:'KITCHEN_MEMORY_VIEW', view:workspace.isActive('situation') ? 'world' : workspace.isActive('data') ? 'data' : 'people' });
                    }
                },
            });
            host.dispatchEvent(new CustomEvent('tk-surface-ready'));
        } else if (ui) {
            ui.receiveHostMessage({ source:'TavernKitchen', type:'KITCHEN_MEMORY_VIEW', view });
        }
        if (view === 'data') archive.showRecovery(host);
    }
    workspace.configure({ actions:{situation:()=>openView('world'),people:()=>openView('people'),data:()=>openView('data')} });
    globalThis.fixture = {workspace,archive,service,errors,chat,read:async()=>{const next=await service.read();
        return {worldId:next.worldId,branchId:next.branchId,version:next.version,entities:next.entities,updates:worldUpdates(next),receipts:next.receipts};}};
    await workspace.open('situation');
}
