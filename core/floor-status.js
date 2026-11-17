/** Validates required agents (`update`, `simulation`) and emits a non-blocking status notice if optional `planner` is unbound. */
export async function preflightOrderedFloorAgents({ floor, checkAgent, render, abort, throwOnRequired = false }) {
    // WHY: Check required agents before queue.beforeGeneration so an unconfigured-agent block
    // fails closed immediately instead of pausing generation indefinitely while waiting to resume.
    try {
        await checkAgent('update');
        await checkAgent('simulation');
    } catch (error) {
        render({ floor, message: error.message, error });
        abort?.();
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

/** Builds `#tk-floor-status` strictly without manual proposal review cards (`0.2.36`). */
export function renderFloorStatus({
    doc,
    info,
    hasChat,
    onRetry,
    onOpenAgent,
    onOpenRecovery,
}) {
    if (!info) return null;
    const statusNode = doc.createElement('div');
    statusNode.id = 'tk-floor-status';
    statusNode.setAttribute('role', info.error ? 'alert' : 'status');
    const title = doc.createElement('span');
    title.textContent = hasChat ? `后厨 · 第 ${info.floor + 1} 楼 · ${info.message}` : `后厨 · ${info.message}`;
    statusNode.append(title);

    const appendButton = (parent, label, action) => {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'menu_button';
        b.textContent = label;
        b.addEventListener('click', () => {
            Promise.resolve().then(action).catch(e => { title.textContent = e.message; });
        });
        parent.append(b);
    };

    if (info.error) {
        appendButton(statusNode, '重试本楼', onRetry);
        appendButton(
            statusNode,
            info.error.agent ? '前往设置' : '查看恢复',
            () => (info.error.agent ? onOpenAgent(info.error.agent) : onOpenRecovery(resolveFailureRoute(info.error))),
        );
    } else if (info.agent) {
        appendButton(statusNode, '前往设置', () => onOpenAgent(info.agent));
    }

    return statusNode;
}
