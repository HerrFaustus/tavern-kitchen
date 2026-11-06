import { memoryDigest } from '../story-summary/data/memory-policy.js';
import { currentTurns } from './turn-ledger.js';
import { isCurrentStoryProposal } from './world-story-state.js';

export function proposalTurn(state, proposal) {
    const turns = currentTurns(state).filter(turn => turn.source.start <= proposal.evidence.floor && turn.source.end >= proposal.evidence.floor);
    return turns.length === 1 ? turns[0] : null;
}

// Legacy proposals remain single, manual decisions. A declared dependency group
// is scoped to its narrative turn, never to a transport request alone.
export function proposalGroups(state, update) {
    const groups = new Map();
    update.proposals.forEach((proposal, index) => {
        const turn = proposalTurn(state, proposal);
        const key = proposal.groupId ? memoryDigest([turn?.id || proposal.evidence.floor, proposal.groupId]) : `legacy:${index}`;
        if (!groups.has(key)) groups.set(key, { indices: [], turn });
        groups.get(key).indices.push(index);
    });
    const combined = [...groups.values()];
    const participants = group => new Set(group.indices.flatMap(index => {
        const proposal = update.proposals[index];
        return proposal.type === 'field' && ['coins', '金币', 'owner', '归属'].includes(proposal.field)
            ? [proposal.entityId, proposal.before?.value?.entityId, proposal.value?.entityId].filter(Boolean) : [];
    }));
    // A transfer and its resource changes must stay together even if a model
    // mistakenly gave them different group IDs. Shared transaction participants
    // make a conservative dependency; unrelated descriptive fields stay separate.
    for (let index = 0; index < combined.length; index++) {
        for (let other = index + 1; other < combined.length; other++) {
            if (!combined[index].turn || combined[index].turn.id !== combined[other].turn?.id) continue;
            const linked = participants(combined[index]), targets = participants(combined[other]);
            if (![...linked].some(id => targets.has(id))) continue;
            combined[index].indices.push(...combined[other].indices); combined.splice(other, 1);
            // Merging can reveal a transitive dependency on an earlier group.
            index = -1; break;
        }
    }
    return combined.map(group => ({ ...group, indices: group.indices.sort((a, b) => a - b) }));
}

export function clearProposal(proposal, source) {
    if (!proposal.groupId || proposal.certainty !== 'explicit') return false;
    if (source && source.messages.find(item => item.floor === proposal.evidence.floor)?.role !== 'assistant') return false;
    if (proposal.nature !== 'established_fact' && !(proposal.type === 'story' && isCurrentStoryProposal(proposal)
        && ['belief', 'intention'].includes(proposal.nature))) return false;
    // This is a conservative veto, not a second semantic model. The model's
    // explicit label alone must not turn qualified evidence into a world fact.
    const message = source?.messages.find(item => item.floor === proposal.evidence.floor)?.text || proposal.evidence.quote;
    const start = message.indexOf(proposal.evidence.quote), end = start + proposal.evidence.quote.length;
    const left = Math.max(...['。', '！', '？', '\n'].map(mark => message.lastIndexOf(mark, start - 1)));
    const next = message.slice(end).search(/[。！？\n]/);
    const sentence = message.slice(left + 1, next < 0 ? message.length : end + next);
    const closure = proposal.type === 'story' && proposal.record?.kind === 'situation'
        && (proposal.record.remove || proposal.record.status !== 'open');
    if (closure && /请求|申请|恳求|提议|商议|建议|希望|盼望|是否|能否|request(?:ed)?\b|propos(?:e|ed)\b/i.test(sentence)) return false;
    if (proposal.nature === 'established_fact' && /可能|也许|或许|似乎|据说|传闻|打算|计划|准备|如果|假如|尚未|没有|并未|未曾|不曾|并非|想要|将会|may\b|might\b|perhaps\b|plans? to\b|not\b/i.test(sentence)) return false;
    return true;
}
