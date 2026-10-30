import { extension_prompts, extension_prompt_types, extension_prompt_roles } from '../../../../../../script.js';
import { registerGenerateInterceptor, unregisterGenerateInterceptor, GENERATE_INTERCEPTOR_ORDER } from '../../shared/common/generate-interceptor.js';
import { usesStoryRecall } from '../story-summary/generate/recall-policy.js';

const ID = 'world-authority', KEY = 'tavernKitchenWorldAuthority';
export function installWorldAuthorityGeneration({ getContext, prepare, onError = error => console.error('[TavernKitchen] 世界状态读取失败', error) }) {
    const clear = () => { delete extension_prompts[KEY]; };
    registerGenerateInterceptor(ID, async (_chat, _size, abort, type) => {
        delete extension_prompts[KEY];
        if (!usesStoryRecall(type)) return;
        const query = (getContext().chat || []).slice(-3).map(message => message.mes || '').join('\n');
        try {
            const value = await prepare(query);
            if (value) extension_prompts[KEY] = { value, position: extension_prompt_types.IN_CHAT, depth: 1, role: extension_prompt_roles.SYSTEM };
        } catch (error) { abort(true); onError(error); }
    }, GENERATE_INTERCEPTOR_ORDER.STORY_SUMMARY - 2);
    return Object.assign(() => { unregisterGenerateInterceptor(ID); clear(); }, { clear });
}
