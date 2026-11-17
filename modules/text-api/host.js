import { getRequestHeaders } from '../../../../../../script.js';
import { createIdentifier } from '../../shared/common/identifier.js';
import { setHostChatCompletionsRequestHeadersProvider } from '../../shared/host-llm/chat-completions/client.js';
import { getTextApiRepository } from './repository.js';
import { resolveBoundPreset } from './model.js';
import { connectionError, generateText } from './runtime.js';
import { countRemoteRequest } from './call-stats.js';
import { createTextApiRequestHandler } from './bridge.js';
import { snapshotTavernApi } from './tavern-import.js';

function encodeMessages(messages) {
    const bytes = new TextEncoder().encode(JSON.stringify(messages));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Read the live Tavern connection and send through the host's chat-completions
 * backend. This endpoint does not take SillyTavern's foreground Generate lock,
 * so a pre-send summary can safely call it from generate_interceptor.
 * Returns null for unsupported / non-chat-completion channels so the caller can
 * retain the legacy raw-generation fallback.
 */
async function generateHostDirect(options) {
    const [{ main_api }, { oai_settings, getChatCompletionModel }, { findSecret, SECRET_KEYS }] = await Promise.all([
        import('../../../../../../script.js'),
        import('../../../../../openai.js'),
        import('../../../../../secrets.js'),
    ]);
    if (main_api !== 'openai') return null;
    let snapshot;
    try {
        snapshot = await snapshotTavernApi({
            mainApi: main_api,
            settings: structuredClone(oai_settings),
            model: getChatCompletionModel(),
            findSecret,
            secretKeys: SECRET_KEYS,
        });
    } catch (error) {
        if (/不是聊天补全|暂不支持自动复制/.test(String(error?.message || error))) return null;
        throw error;
    }
    const { text } = await generateText(snapshot.preset, options);
    return { text };
}

export async function generateHost(preset, options) {
    const direct = await generateHostDirect(options);
    if (direct) return direct;
    const { messages, signal, onDelta } = options;
    const { streamingGeneration } = await import('../streaming-generation.js');
    const args = { as: 'user', nonstream: preset.stream ? 'false' : 'true', top64: encodeMessages(messages),
        id: `text-api-${createIdentifier()}` };
    if (preset.temperature != null) args.temperature = preset.temperature;
    if (preset.maxTokens != null) args.max_tokens = preset.maxTokens;
    const fields = { topP: 'top_p', topK: 'top_k', presencePenalty: 'presence_penalty', frequencyPenalty: 'frequency_penalty' };
    for (const [key, field] of Object.entries(fields)) if (preset.sampling?.[key]?.enabled) args[field] = preset.sampling[key].value;
    const task = await streamingGeneration.startRawGeneration(args, '', { signal, onDelta });
    const text = String(await task.completion || '');
    return { text };
}

export async function resolveTextApi(feature) {
    return resolveBoundPreset(await (await getTextApiRepository()).load(), feature);
}

export async function generateFeatureText(feature, options, snapshot) {
    let preset = snapshot;
    try {
        setHostChatCompletionsRequestHeadersProvider(() => getRequestHeaders());
        preset ??= await resolveTextApi(feature);
        return await countRemoteRequest(feature, dispatch => generateText(preset, { ...options, onDispatch(messages) {
            dispatch(); options.onDispatch?.(messages);
        } }, {generateHost}), options.agentTask);
    } catch (error) {
        const safe = connectionError(error, preset);
        throw safe;
    }
}

// The owning page verifies its iframe before dispatching.
export const handleTextApiRequest = createTextApiRequestHandler({
    getRepository: getTextApiRepository, generateHost,
    prepare: () => setHostChatCompletionsRequestHeadersProvider(() => getRequestHeaders()),
});
