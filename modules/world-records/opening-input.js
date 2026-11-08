export function openingMessages(chat = []) {
    const opening = [];
    let fresh = true;
    for (const row of chat) {
        if (row.is_system || typeof row.mes !== 'string' || !row.mes.trim()) continue;
        if (!opening.length || row.is_user && !opening.some(item => item.is_user)) opening.push(row);
        else {
            fresh = false;
            if (opening.some(item => item.is_user)) break;
        }
    }
    return { fresh, messages: opening.map(row => ({
        role: row.is_user ? 'user' : 'assistant', name: row.name || '', text: row.mes,
    })) };
}

export async function collectOpening(ctx, { globals, extraBooks, chatBook, loadBook }) {
    const inputs = [];
    const books = new Set([...globals, chatBook, ctx.powerUserSettings?.persona_description_lorebook].filter(Boolean));
    const cards = ctx.groupId != null && ctx.groupId !== ''
        ? (ctx.groups?.find(group => String(group.id) === String(ctx.groupId))?.members || []).map(avatar =>
            Object.values(ctx.characters || {}).find(card => card.avatar === avatar))
        : [ctx.characters?.[ctx.characterId]];
    const add = (key, label, value) => { if (value) inputs.push({ key: JSON.stringify(key), label, text: value }); };
    const player = ctx.name1 || '';
    add(['player'], '主角', player);
    add(['scenario'],'当前聊天的情境设定',ctx.chatMetadata?.scenario);
    add(['persona'], '玩家设定', ctx.powerUserSettings?.persona_description);
    for (const card of cards.filter(Boolean)) {
        const data = card.data || card;
        for (const field of ['name','description','personality','scenario','system_prompt','post_history_instructions','mes_example']) {
            add(['card',card.avatar,field], `角色卡 · ${card.name} · ${field}`, data[field] || card[field]);
        }
        for (const book of [data.extensions?.world, ...extraBooks(card)].filter(Boolean)) books.add(book);
        if (!data.extensions?.world && data.character_book?.entries) {
            for (const [key, entry] of Object.entries(data.character_book.entries)) {
                if (entry.enabled !== false) add(['embedded',card.avatar,key], `内嵌世界书 · ${entry.comment || key}`, entry.content);
            }
        }
    }
    for (const name of [...books].sort()) {
        const book = await loadBook(name);
        if (!book?.entries) throw new Error(`读取世界书「${name}」失败`);
        for (const [key, entry] of Object.entries(book.entries)) {
            if (entry.disable) continue;
            const keys = [...(Array.isArray(entry.key) ? entry.key : []),...(Array.isArray(entry.keysecondary) ? entry.keysecondary : [])];
            add(['book',name,key], [name,entry.comment || key,keys.join('、')].filter(Boolean).join(' · '), entry.content);
        }
    }
    for (const row of openingMessages(ctx.chat).messages) add(['opening',row.role], `开场${row.role === 'user' ? '玩家输入' : '白'} · ${row.name || row.role}`, row.text);
    return { player, inputs };
}

