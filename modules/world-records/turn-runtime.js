// The host owns storage and chat lifetimes. Summary code receives only a pinned
// receipt and a synchronous guard; it never writes world effects itself.
let provider = null;
let required = false;
export function requireTurnRuntime() { required = true; }
export function registerTurnRuntime(runtime) {
    required = true;
    provider = runtime;
    return () => { if (provider === runtime) provider = null; };
}
export async function prepareMemorySources(start, end, options = {}) {
    if (!provider) {
        if (options.unified && required) throw new Error('世界内核尚未就绪，未调用独立更新模型；请等待后厨加载完成后重试');
        return null;
    }
    return provider.prepare(start, end, options);
}
export function assertMemorySources(prepared) { prepared?.assertCurrent(); }
export async function validateMemorySources(prepared) { await prepared?.validate(); }
export async function deliverMemorySources(prepared) { return prepared?.deliver?.(); }
