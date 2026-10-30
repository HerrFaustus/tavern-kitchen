// Native display/prompt-only regex: raw chat text keeps the reviewable payload.
const ID = 'tavern-kitchen-main-reply-summary';
export function installFloorDisplayFilter(settings) {
    if (!settings) return () => {};
    settings.regex ||= [];
    const previous = settings.regex.find(rule => rule.id === ID);
    const rule = { id: ID, scriptName: '后厨 · 主回复总结（显示与发送时隐藏）',
        findRegex: '/<kitchen_summary\\b[^>]*>[\\s\\S]*?(?:<\\/kitchen_summary\\s*>|$)/gi',
        replaceString: '', trimStrings: [], placement: [2], disabled: false,
        markdownOnly: true, promptOnly: true, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null };
    if (previous) settings.regex.splice(settings.regex.indexOf(previous), 1, rule);
    else settings.regex.push(rule);
    return () => { const at = settings.regex.indexOf(rule); if (at >= 0) settings.regex.splice(at, 1); };
}
