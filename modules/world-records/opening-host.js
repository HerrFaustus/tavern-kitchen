import { getCharaFilename } from '../../../../../utils.js';
import { loadWorldInfo, METADATA_KEY, selected_world_info, world_info } from '../../../../../world-info.js';
import { generateFeatureText, resolveTextApi } from '../text-api/host.js';
import { HOST_PROVIDER } from '../text-api/model.js';
import { collectOpening, openingMessages } from './opening-input.js';
import { initializeOpening } from './opening.js';
import { readMapBeforeOpening } from './map-store.js';
import { openingOperations } from './opening-projection.js';

export function createOpeningHost({getContext,identity,service}) {
    let pending;
    let generation = 0;
    function run({manual = false,signal} = {}) {
        if (!manual) return;
        const ctx = getContext(), owner = identity(), opening = openingMessages(ctx.chat);
        if (!owner) throw new Error('请先打开一段聊天');
        const epoch = generation, scope = service.scopeVersion(), basis = JSON.stringify(opening);
        const key = JSON.stringify([owner,scope,basis]);
        if (pending?.key === key) return pending.promise;
        const guard = () => epoch === generation && owner === identity() && scope === service.scopeVersion()
            && basis === JSON.stringify(openingMessages(getContext().chat));
        const readInput = () => {
            const current = getContext();
            return collectOpening(current,{globals:selected_world_info || [],chatBook:current.chatMetadata?.[METADATA_KEY],
                extraBooks:card => world_info.charLore?.find(entry => entry.name === getCharaFilename(null,{manualAvatarKey:card.avatar}))?.extraBooks || [],
                loadBook:loadWorldInfo});
        };
        const controller = new AbortController();
        const activeSignal = signal ? AbortSignal.any([signal,controller.signal]) : controller.signal;
        const task = {key,controller};
        let preset;
        task.promise = initializeOpening({service,readInput,guard,oldChat:!opening.fresh,signal:activeSignal,project:openingOperations,prepareMap:readMapBeforeOpening,
            async write(messages,abortSignal) {
                preset ??= await resolveTextApi('opening');
                if (preset.provider === HOST_PROVIDER) throw new Error('请在「世界 → 世界生成」下方选择独立模型');
                return (await generateFeatureText('opening',{messages,signal:abortSignal,timeoutMs:120000},preset)).text;
            }}).finally(() => { if (pending === task) pending = null; });
        pending = task;
        return task.promise;
    }
    return Object.assign(run,{cancel() { generation++; pending?.controller.abort(); pending = null; }});
}

