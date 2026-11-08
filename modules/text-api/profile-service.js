import { getRequestHeaders } from '../../../../../../script.js';
import { setHostChatCompletionsRequestHeadersProvider } from '../../shared/host-llm/chat-completions/client.js';
import { savePanelPrompt } from '../../core/panel-policy.js';
import { connectionProbe } from './prompts.js';
import { HOST_PROVIDER } from './model.js';
import { getTextApiRepository } from './repository.js';
import { listTextModels, testTextConnection } from './runtime.js';
import { importCurrentTavernApi } from './tavern-import.js';
import { createIdentifier } from '../../shared/common/identifier.js';
export async function handleProfileRequest(data, signal) {
    const repository = await getTextApiRepository();
    if (data.action === 'load') {
        const settings = await repository.load();
        return data.feature === 'library' ? { ...settings, testMessage: connectionProbe() } : settings;
    }
    if (data.action === 'save-test-message' && data.feature === 'library') {
        const value = data.message;
        if (value !== null && (typeof value !== 'string' || !value.trim())) throw new Error('请输入测试消息');
        await savePanelPrompt('connectionProbe', value ?? undefined);
        return connectionProbe();
    }
    if (data.action === 'mutate') return repository.mutate(data.feature || 'library', data.mutation);
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
        return { settings, id, message: imported.message };
    }
    throw new Error('未知的配置操作');
}
