import { load, JSON_SCHEMA } from 'js-yaml';

export const requestFields = [
    ['includeBody', '主体参数', 'temperature: 0.7'],
    ['excludeBody', '排除主体参数', '- top_p'],
    ['includeHeaders', '包含请求标头', 'X-Client-Name: TavernKitchen'],
];

export function supportsRequestExtras(provider) {
    return ['openai-compatible', 'openai-responses', 'anthropic', 'sillytavern-openai-compatible'].includes(provider);
}

export function parseRequestExtras(config) {
    const result = {};
    for (const [key, label] of requestFields) {
        const raw = config.requestExtras?.[key];
        if (!raw?.trim()) continue;
        try {
            const value = load(raw, {schema: JSON_SCHEMA});
            if (key === 'excludeBody') {
                if (!value || !['string','object'].includes(typeof value)) throw Error();
                const names = typeof value === 'string' ? [value] : Array.isArray(value) ? value : Object.keys(value);
                if (!names.every(name => typeof name === 'string' && name.trim())) throw Error();
                result[key] = names;
            } else {
                if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
                if (key === 'includeHeaders') {
                    if (!Object.values(value).every(v => ['string','number','boolean'].includes(typeof v))) throw Error();
                    result[key] = Object.fromEntries(new Headers(value));
                } else result[key] = value;
            }
        } catch { throw new Error(label + '格式无效，请检查 YAML 或 JSON。'); }
    }
    return result;
}

export function fetchWithExtras(config) {
    const extras = parseRequestExtras(config);
    if (!Object.keys(extras).length) return globalThis.fetch.bind(globalThis);
    return (url, init = {}) => {
        const headers = new Headers(init.headers);
        for (const [key,value] of Object.entries(extras.includeHeaders || {})) headers.set(key,value);
        let body = init.body;
        if (typeof body === 'string' && (extras.includeBody || extras.excludeBody)) {
            const data = { ...JSON.parse(body), ...extras.includeBody };
            for (const name of extras.excludeBody || []) delete data[name];
            body = JSON.stringify(data);
        }
        return fetch(url, { ...init, headers, body });
    };
}
