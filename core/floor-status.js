/** Validates required agents (`update`, `simulation`) and emits a non-blocking status notice if optional `planner` is unbound. */
export async function preflightOrderedFloorAgents({ floor, checkAgent, render, abort, throwOnRequired = false }) {
    // WHY: Check required agents before queue.beforeGeneration so an unconfigured-agent block
    // fails closed immediately instead of pausing generation indefinitely while waiting to resume.
    try {
        await checkAgent('update');
        await checkAgent('simulation');
    } catch (error) {
        render({ floor, message: error.message, error });
        abort?.(true);
        if (throwOnRequired) throw error;
        return false;
    }
    // WHY: StoryPlanner is optional until chapter compression triggers; warn non-blockingly so chat
    // generation is never aborted merely because the user has not bound a planner model yet.
    try {
        await checkAgent('planner');
    } catch (error) {
        render({ floor, message: `${error.message}（未配置编剧前暂不生成章节札记，正文继续）`, agent: 'planner' });
    }
    return true;
}

export function resolveFailureRoute(error) {
    const message = String(error?.message || error || '');
    if (/原文|来源不一致|来源|损坏|数据页|原位|回退|corrupt|mismatch/i.test(message)) return 'data';
    if (/世界|冲突|版本|分支|后楼|conflict|version|branch/i.test(message)) return 'world';
    return 'data';
}
