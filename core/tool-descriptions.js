import { definePanelPrompt } from './panel-policy.js';

// Tool names and validation constraints stay in the program. Every explanatory string uses the panel setting.
export function editableToolDescriptions(panel, prefix, definition) {
    const copy = JSON.parse(JSON.stringify(definition));
    const fields = new Map();
    function collect(node, path) {
        if (!node || typeof node !== 'object') return;
        if (typeof node.description === 'string') fields.set(path, node);
        for (const [key, value] of Object.entries(node)) collect(value, path ? path + '.' + key : key);
    }
    collect(copy.function, 'function');
    const defaults = Object.fromEntries([...fields].map(([path, node]) => [path, node.description]));
    const template = JSON.stringify(defaults, null, 2);
    function parse(value) {
        if (!value.trim()) return {};
        let result;
        try { result = JSON.parse(value); } catch { throw new Error('工具说明需要有效的 JSON 对象'); }
        if (!result || typeof result !== 'object' || Array.isArray(result) ||
            Object.entries(result).some(([key, text]) => !fields.has(key) || typeof text !== 'string')) {
            throw new Error('请保留已有字段名，并使用文本填写说明');
        }
        return result;
    }
    const name = copy.function.name;
    const read = definePanelPrompt(panel, prefix + '.' + name, name + ' · 工具与参数说明（JSON）', template, parse);
    let previous = template, descriptions = defaults;
    for (const [path, node] of fields) {
        Object.defineProperty(node, 'description', {enumerable:true, configurable:true, get() {
            const current = read();
            if (current !== previous) {
                descriptions = parse(current);
                previous = current;
            }
            return descriptions[path] ?? '';
        }});
    }
    return copy;
}
