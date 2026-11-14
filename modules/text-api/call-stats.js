// Only numeric provider counters and predefined error descriptions enter the diagnostic snapshot.
const tokenFields = {
    inputTokens: ['input_tokens', 'prompt_tokens', 'inputTokens', 'promptTokenCount'],
    outputTokens: ['output_tokens', 'completion_tokens', 'outputTokens', 'candidatesTokenCount'],
    totalTokens: ['total_tokens', 'totalTokens', 'totalTokenCount'],
    cacheReadTokens: ['cache_read_input_tokens', 'cachedContentTokenCount'],
    cacheWriteTokens: ['cache_creation_input_tokens'],
};

function tokenUsage(raw) {
    const usage = {};
    for (const [key, aliases] of Object.entries(tokenFields)) {
        const value = aliases.map(field => raw?.[field]).find(n => Number.isSafeInteger(n) && n >= 0);
        if (value !== undefined) usage[key] = value;
    }
    return Object.keys(usage).length ? usage : undefined;
}

function errorDescription(error) {
    if (/超时|timed? ?out|deadline/i.test(error.message)) return '请求超时';
    if (error.name === 'AbortError') return '请求已取消';
    const status = error.message.match(/(?:\bHTTP\s*|^)([45]\d{2})\b/i);
    if (status) return 'HTTP ' + status[1];
    if (/network|fetch failed|failed to fetch/i.test(error.message)) return '网络连接失败';
    return '模型请求失败';
}

export function createCallStats({ now = Date.now, timer = () => performance.now() } = {}) {
    let features = new Map(), tasks = new Map();
    const recent = [];
    return {
        task(feature) {
            const scope = tasks, agent = ({summary:'update', memory:'update', opening:'update', world:'simulation', planner:'planner'})[feature];
            let started = false;
            return () => {
                if (agent && !started && scope === tasks) tasks.set(agent,(tasks.get(agent) || 0) + 1);
                started = true;
            };
        },
        start(feature) {
            const started = timer(), scope = features;
            let finished = false;
            return (rawUsage, error) => {
                if (scope !== features || finished) return;
                finished = true;
                const ms = Math.max(0, Math.round(timer() - started)), at = now();
                const usage = tokenUsage(rawUsage);
                const totals = features.get(feature) || { calls: 0, failures: 0, totalMs: 0, lastError: '', lastAt: null };
                const message = error ? errorDescription(error) : '';
                totals.calls++;
                totals.totalMs += ms;
                totals.lastAt = at;
                if (error) { totals.failures++; totals.lastError = message; }
                if (usage) {
                    totals.usage ??= {};
                    for (const [key, value] of Object.entries(usage)) totals.usage[key] = (totals.usage[key] || 0) + value;
                }
                features.set(feature, totals);
                recent.push({ feature, at, ms, ...(message && { error: message }), ...(usage && { usage }) });
                if (recent.length > 100) recent.shift();
            };
        },
        snapshot() { return structuredClone({ features: Object.fromEntries(features), ...(tasks.size && {tasks:Object.fromEntries(tasks)}), recent }); },
        clear() { features = new Map(); tasks = new Map(); recent.length = 0; },
    };
}

export const featureCalls = createCallStats();

export async function countRemoteRequest(feature, run, task = featureCalls.task(feature)) {
    let finish;
    const dispatch = () => { task(); finish ??= featureCalls.start(feature); };
    try { const result = await run(dispatch); finish?.(result?.usage ?? result?.responseInfo?.usage); return result; }
    catch (error) { finish?.(undefined,error); throw error; }
}
