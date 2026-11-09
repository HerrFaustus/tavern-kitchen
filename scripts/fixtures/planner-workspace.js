import { createKitchenWorkspace } from '../../core/kitchen-workspace.js';
import { createWorldArchive } from '../../modules/world-records/host.js';
import { getWorldBridge } from '../../modules/world-records/bridge.js';
import { storyIdentityKey, notifyWorldSourcesChanged } from '../../modules/world-records/sources.js';
import { captureStoryIdentity } from '../../modules/xiaobai-os/host/story-identity.js';
import { installPlanner } from '../../modules/story-planner/host.js';

// Fictional chat and model result; real workspace, world and note IndexedDB.
export async function mountPlannerFixture() {
    const fixture = globalThis.__plannerFixture;
    const context = { chatId:'planner-fixture', characterId:0, characters:[{avatar:'fixture.png'}],
        name1:'旅人', chat:[{mes:'旅人来到码头。',is_user:true}], getTokenCountAsync:async()=>30 };
    const memory = { enabled:true, store:{summaryHistory:[],json:{}} };
    const workspace = createKitchenWorkspace({});
    const archive = createWorldArchive({getContext:()=>context,getMemorySnapshot:()=>memory,getMount:id=>workspace.getMount(id),
        isVisible:id=>workspace.isActive(id),onError:error=>fixture.errors.push(error.message)});
    const { service } = getWorldBridge(storyIdentityKey(captureStoryIdentity(context)));
    await service.ensure();
    const planner = installPlanner({snapshot:archive.plannerSnapshot,loadSnapshot:archive.loadPlannerSnapshot,
        isVisible:()=>workspace.isActive('planner'),getContext:()=>context});
    workspace.configure({actions:{planner:()=>planner.open(workspace.getMount('planner'),workspace.getControls())},
        panelSwitch:()=>({enabled:true,label:'启用编剧',change(){}})});
    Object.assign(fixture, {
        generate:async()=>{ await fixture.interceptor(context.chat,8192,()=>{},'normal',{}); return fixture.prompts['kitchen-chapter-note']?.value; },
        failNext:()=>{ fixture.failNextRequest = true; },
        editSource:()=>{ context.chat[0].mes='旅人改走山路。'; notifyWorldSourcesChanged(); },
        restoreSource:()=>{ context.chat[0].mes='旅人来到码头。'; notifyWorldSourcesChanged(); },
        fork:async()=>{ const current=await service.read(); fixture.originalBranch=current.branchId; await service.fork(current,0); },
        restore:async()=>{ const current=await service.read(); await service.selectBranch(fixture.originalBranch,current); },
    });
    await workspace.open('planner');
}
