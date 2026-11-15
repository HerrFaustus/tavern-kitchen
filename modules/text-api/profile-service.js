import { getRequestHeaders } from '../../../../../../script.js';
import { setHostChatCompletionsRequestHeadersProvider } from '../../shared/host-llm/chat-completions/client.js';
import { HOST_PROVIDER } from './model.js';
import { getTextApiRepository } from './repository.js';
import { listTextModels, testTextConnection } from './runtime.js';
import { importCurrentTavernApi } from './tavern-import.js';
import { createIdentifier } from '../../shared/common/identifier.js';
import { featureCalls } from './call-stats.js';
export async function handleProfileRequest(data, signal) {
    if (data.action === 'dialog') {
        const { Popup, POPUP_TYPE, POPUP_RESULT } = globalThis.SillyTavern.getContext();
        const text = document.createElement('p');
        text.textContent = String(data.message || '');
        if (data.kind === 'input') {
            const result = await new Popup(text, POPUP_TYPE.INPUT, String(data.initial || '')).show();
            return typeof result === 'string' ? result : null;
        }
        if (data.kind === 'confirm') return await new Popup(text, POPUP_TYPE.CONFIRM).show() === POPUP_RESULT.AFFIRMATIVE;
        throw new Error('无法识别对话框');
    }
    if (data.action === 'clear-call-stats') featureCalls.clear();
    if (data.action === 'call-stats' || data.action === 'clear-call-stats') return featureCalls.snapshot();
    const repository = await getTextApiRepository();
    if (data.action === 'load') return repository.load();
    if (data.action === 'mutate') {
        const result = await repository.mutate(data.feature || 'library', data.mutation);
        globalThis.window?.dispatchEvent?.(new Event('tavernKitchen:floor-settings'));
        return result;
    }
    setHostChatCompletionsRequestHeadersProvider(() => getRequestHeaders());
    if (data.action === 'models') return listTextModels(data.preset, { signal });
    if (data.action === 'test') {
        const dependencies = data.preset?.provider === HOST_PROVIDER ? { generateHost: (await import('./host.js')).generateHost } : {};
        return testTextConnection(data.preset, { signal }, dependencies);
    }
    if (data.action === 'import') {
        const imported = await importCurrentTavernApi(data.connectionOnly === true);
        signal?.throwIfAborted();
        const current = await repository.load();
        const base = data.connectionOnly ? '酒馆连接副本' : '酒馆主接口副本';
        let name = base, n = 2;
        while (current.presets.some(p => p.name === name)) name = base + ' ' + n++;
        const id = createIdentifier();
        const settings = await repository.mutate('library', { type: 'add', id, name, preset: imported.preset });
        globalThis.window?.dispatchEvent?.(new Event('tavernKitchen:floor-settings'));
        return { settings, id, message: imported.message };
    }
    throw new Error('未知的配置操作');
}
