export const PERSON_SECTIONS = {
    人物特征: ['外貌', '体型', '衣着', '性格'],
    身份与立场: ['身份', '职务', '阵营'],
    当前状态: ['身体状况', '当前情绪'],
    能力与专长: ['能力与专长'],
};
export const PERSON_FIELDS = new Set(Object.values(PERSON_SECTIONS).flat());
export const POSSESSION_ROLES = {owner:'所有人', 保管人:'保管人', 使用人:'使用人'};
export const RELATION_PREFIX = '关系身份/';

export function validatePersonField(subject, field, value, entities) {
    if (field !== '保管人' && field !== '使用人' && !field.startsWith(RELATION_PREFIX)) return;
    const person = entity => ['person','subject'].includes(entity?.kind);
    const peer = value?.entityId && entities.find(entity => entity.id === value.entityId);
    if (field === '保管人' || field === '使用人') {
        if (!['item','place','subject'].includes(subject.kind)) throw new Error('保管人和使用人须记录在物品或资产上');
        if (value !== null && (!(person(peer) || peer?.kind === 'organization') || Object.keys(value).length !== 1)) {
            throw new Error('保管人和使用人须引用已有的人物或组织');
        }
    }
    if (field.startsWith(RELATION_PREFIX)) {
        const target = field.slice(RELATION_PREFIX.length);
        if (!person(subject) || target === subject.id || !entities.some(entity => entity.id === target && person(entity))) throw new Error('关系身份须连接两个不同的人物');
        if (value !== null && (peer?.id !== target || typeof value.role !== 'string' || !value.role.trim() || value.role.length > 200 || Object.keys(value).length !== 2)) {
            throw new Error('关系身份须引用对方编号并写明本人角色');
        }
        if (value && peer.fields?.[RELATION_PREFIX + subject.id]?.value?.entityId === subject.id) throw new Error('双方已有关系身份，请更新原方向的记录');
    }
}
