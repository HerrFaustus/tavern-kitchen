import { definePanelPrompt, panelEnabled } from '../../../../../core/panel-policy.js';
import { checkProgress } from './progress.js';
import type { NormalizedMessageSnapshot } from '../../../capabilities/maintenance/accepted-turn-source.js';
import { readSituationCatalog, type Involvement } from '../../../../story-state/situation-links.js';
import { safePromptJson } from '../../../capabilities/maintenance/prompt-safety.js';
import type { MaintenanceMode, MaintenanceSession } from '../../../capabilities/maintenance/registry.js';
import { editWorld } from '../../../domains/world/edit.js';
import { record } from '../../../domains/world/invariants.js';
import { worldContent } from '../../../domains/world/projection.js';
import { sameWorldContent, WORLD_LIMITS } from '../../../domains/world/types.js';
import type { WorldService } from '../application/service.js';
import { buildWorldDataMessage } from '../prompt-data.js';
import { buildWorldMaintenancePrompt } from './prompt.js';
import type { WorldSettings } from '../types.js';
import { WORLD_TOOLS } from '../tools/tool-contract.js';

// Failed atomic batches must be addressed; a read or unrelated edit cannot clear them.
function editScopes(args: unknown): string[] {
    if (!args || typeof args !== 'object' || Array.isArray(args)) { return ['call']; }
    const value = args as Record<string, unknown>;
    const scopes = 'overview' in value ? ['overview'] : [];
    const validId = (id: unknown): id is string => typeof id === 'string' && !!id.trim() && [...id].length <= WORLD_LIMITS.id;
    if (Array.isArray(value.upsert)) {
        for (const item of value.upsert) {
            if (item && validId(item.id)) { scopes.push(`news:${item.id}`); }
        }
    }
    if (Array.isArray(value.remove)) {
        for (const id of value.remove) { if (validId(id)) { scopes.push(`news:${id}`); } }
    }
    return scopes.length ? scopes : ['call'];
}

const catalogGuide = definePanelPrompt('situation','catalogGuide','局势目录引用','当前局势目录（资料）。幕后进展明确关联某条局势时填写 situationId，使用目录中的精确 ID，否则省略。相关性仅用于归档，不改变正文事实。\n');
const worldRule1 = definePanelPrompt('people|situation','worldRule1','推演目标','根据已完成的正文、设定和已有幕后记录，独立推演场外进展。使用 WorldRead 查看已有条目，WorldEdit 按稳定 ID 更新。没有合理进展时保持原状。');
const worldRule2 = definePanelPrompt('people|situation','worldRule2','对象与相关度','只推演本轮名单中的对象，upsert 每项须填对应 subjectId。near=true 是主角栏当前牵涉，每轮检查，最多写一个有依据的小变化；near=false 是此次唤醒的远景，只概括已生效的现状。两档均允许不变。不要代替主角行动，不更新全局概况。');
const worldRule3 = definePanelPrompt('people|situation','worldRule3','变化依据','每个自动新增、推进或撤下的条目都须提供 WorldEdit.progress：scope 为 news:加条目 ID（概况用 overview），from 原样复制旧正文，新建留空；新状态写入 body，quote 逐字引用本次已接受的正文，reason 说明这件新事如何使这一步成为可能。仅请求、愿望或时间经过不能证明行动已经完成；无据维持原状。');
const worldRule4 = definePanelPrompt('people|situation','worldRule4','篇幅与知情范围','只写与经过的故事时间相称、能从现状推导出的具体变化。正文事实优先，不替玩家行动，不让角色自动知晓幕后信息。以故事语言写简短的标题和内容。');
const worldRule5 = definePanelPrompt('people','worldRule5','人物议程','人物的 agendas 是仍有效的计划与长期目标。参考具体内容、条件约束和期限；只有正文证实进展才推演，切勿凭意图、到期或同伴的行动判定完成。');
const worldRule6 = definePanelPrompt('people','worldRule6','人物属性','人物的 profile 是已确认属性。推演行动时考虑当前职务、能力限制和伤病；只在有依据时改变情绪，不把一时的情绪写成性格，也不让其他人物无故知道秘密立场。');
const worldRule7 = definePanelPrompt('people','worldRule7','人物动向开启时','人物动向已开启：可推演已登场配角在场外的选择、目标和行动。人物条目的 ID 必须以 person- 开头。');
const worldRule8 = definePanelPrompt('people','worldRule8','人物动向关闭时','人物动向关闭。禁止改动人物条目或推演个人行动。');
const worldRule9 = definePanelPrompt('situation','worldRule9','局势进展开启时','局势进展已开启：可推演地区、组织和公共事件的发展。新条目 ID 以 situation- 开头；旧局势条目沿用原 ID。');
const worldRule10 = definePanelPrompt('situation','worldRule10','局势进展关闭时','局势进展关闭。禁止改动 overview 或局势条目。');

export function createWorldMaintenanceSession(world: WorldService, mode: MaintenanceMode, preferences?: () => WorldSettings, messages: readonly NormalizedMessageSnapshot[] = [], selectSubjects?: () => Involvement[]): MaintenanceSession {
    const settings = preferences?.();
    const permitted = (scope: string, flags: WorldSettings) => scope.startsWith('news:person-') ? !!flags.peopleEvolution : flags.subscribed;
    const touched = new Set<string>();
    const allowedNow = () => !preferences || [...touched].every(scope => permitted(scope, preferences()));
    const original = world.readCurrent();
    const catalog = readSituationCatalog(original.chatIdentity);
    const linked = new Set<string>();
    const linksCurrent = () => {
        if (!linked.size) { return true; }
        const ids = new Set(readSituationCatalog(original.chatIdentity).map(item => item.id));
        return [...linked].every(id => ids.has(id));
    };
    const expected = worldContent(original.world);
    const selected = selectSubjects?.();
    const subjectOf = (item: typeof expected.news[number]) => item.subjectId || (item.situationId ? 'situation/' + item.situationId : '');
    const visible = (content: typeof expected) => selected ? { overview: '', news: content.news.filter(item => selected.some(row => row.key === subjectOf(item))) } : content;
    const authorized = new Set<string>();
    const subjectsCurrent = () => {
        if (!selectSubjects) { return true; }
        const current = selectSubjects();
        return [...authorized].every(key => current.some(row => row.key === key && row.near === selected?.find(subject => subject.key === key)?.near));
    };
    let staged = structuredClone(expected);
    const failures = new Set<string>();
    let invalid = false;
    let committed = false;
    const active = () => {
        if ((!panelEnabled('people') && !panelEnabled('situation')) || invalid || committed) { throw new Error('world_session_inactive'); }
    };
    const changed = () => !sameWorldContent(expected, staged);
    return {
        participantId: 'world',
        commitPolicy: 'complete-run',
        prompt: settings ? [
            worldRule1(),
            selected ? worldRule2() : '',
            worldRule3(),
            worldRule4(),
            worldRule5(),
            worldRule6(),
            settings.peopleEvolution ? worldRule7() : worldRule8(),
            settings.subscribed ? worldRule9() : worldRule10(),
        ].join('\n') : buildWorldMaintenancePrompt(mode),
        dataMessages: [...(selected ? [{ role:'user' as const, content:'本轮对象：' + safePromptJson(selected) }] : []), ...(catalog.length && !selected ? [{ role: 'user' as const, content: catalogGuide() + safePromptJson(catalog.slice(0, 100)) }] : []), { role: 'user', content: buildWorldDataMessage(visible(expected)) }],
        tools: WORLD_TOOLS,
        executeTool(name, args) {
            active();
            if (name === 'WorldRead') { record(args, 'WorldRead', []); return visible(worldContent(staged)); }
            if (name !== 'WorldEdit') { throw new TypeError('Unknown world tool.'); }
            const result = editWorld(staged, args);
            const scopes = editScopes(args);
            const subjectsTouched = new Set<string>();
            if (result.ok && settings && scopes.some(scope => !permitted(scope, settings) || !permitted(scope, preferences!()))) {
                throw new Error('该类幕后演化已关闭，本批修改未写入。');
            }
            if (result.ok && selected) {
                for (const scope of scopes) {
                    const id = scope.slice(5), old = staged.news.find(item => item.id === id), next = result.data.news.find(item => item.id === id);
                    const key = next?.subjectId || (old && subjectOf(old));
                    const subject = selected.find(row => row.key === key);
                    if (scope === 'overview' || !subject || ((subject.kind === 'person') !== id.startsWith('person-'))
                        || (old && key !== subjectOf(old)) || (next && !next.subjectId)) {
                        throw new Error('此对象未获本轮推演授权，或条目与对象不匹配。');
                    }
                    subjectsTouched.add(subject.key);
                }
            }
            if (result.ok) {
                const changes = result.data.news.filter(item => scopes.includes('news:' + item.id) && item.situationId);
                if (changes.some(item => !catalog.some(record => record.id === item.situationId))) {
                    throw new Error('关联局势必须来自当前聊天的局势目录。');
                }
                if (settings) {
                    try {
                        const input = args as { progress?: Parameters<typeof checkProgress>[3] };
                        checkProgress(staged, result.data, scopes, input.progress, messages);
                    } catch (error) {
                        for (const scope of scopes) { failures.add(scope); }
                        throw error;
                    }
                }
                for (const scope of scopes) { touched.add(scope); }
                for (const key of subjectsTouched) { authorized.add(key); }
                staged = worldContent(result.data);
                linked.clear();
                for (const item of staged.news) {
                    if (item.situationId && expected.news.find(old => old.id === item.id)?.situationId !== item.situationId) { linked.add(item.situationId); }
                }
                if (scopes.some(scope => scope !== 'call')) { failures.delete('call'); }
                for (const scope of scopes) { if (scope !== 'call') { failures.delete(scope); } }
                result.errors = [...failures].map(scope => ({
                    path: 'WorldEdit',
                    message: scope === 'call'
                        ? 'An earlier failed edit still needs a valid correction before this publication can be saved.'
                        : scope === 'overview'
                            ? 'An earlier failed batch included overview. Resubmit the desired or unchanged overview in WorldEdit.'
                            : `An earlier failed batch included article ID ${scope.slice(5)}. Resolve it in WorldEdit with a complete upsert within the writing limits or remove (deletes it if present).`,
                }));
            } else { for (const scope of scopes) { failures.add(scope); } }
            return { ...result, data: visible(result.data) };
        },
        canCommit: () => !invalid && !committed && !failures.size && allowedNow() && subjectsCurrent() && changed(),
        getResult: () => ({ status: failures.size ? 'failed' : changed() ? 'updated' : 'unchanged', changed: !failures.size && changed() }),
        async commit(beforeCommit) {
            active();
            if (failures.size) { throw new Error('world_edits_unresolved'); }
            if (!changed()) { return; }
            const guard = () => !invalid && allowedNow() && subjectsCurrent() && linksCurrent() && beforeCommit();
            const result = await world.replaceContent(original.identityKey, expected, staged, guard, mode === 'automatic' ? 'host' : 'immediate');
            committed = true;
            return result;
        },
        invalidate() { invalid = true; },
    };
}
