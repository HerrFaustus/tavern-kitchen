import type { NormalizedMessageSnapshot } from '../../../capabilities/maintenance/accepted-turn-source.js';
import type { WorldContent } from '../../../domains/world/types.js';

type Proof = { scope: string; from: string; reason: string; quote: string };
export function checkProgress(before: WorldContent, after: WorldContent, scopes: string[], proofs: Proof[] = [],
    messages: readonly NormalizedMessageSnapshot[]) {
    for (const scope of scopes) {
        const overview = scope === 'overview';
        const id = scope.slice(5);
        const old = before.news.find(item => item.id === id);
        const next = after.news.find(item => item.id === id);
        const from = overview ? before.overview : old?.body || '';
        const to = overview ? after.overview : next?.body || '';
        if (from === to && (overview || (old?.title === next?.title && old?.situationId === next?.situationId && old?.subjectId === next?.subjectId))) {
            if (next && old?.progress) { next.progress = old.progress; }
            continue;
        }
        const matches = proofs.filter(proof => proof.scope === scope);
        const proof = matches[0];
        if (matches.length !== 1 || proof.from !== from) { throw new Error('每项变化须填写唯一的推进依据，from 须与当前旧状态一致。'); }
        const message = messages.find(item => item.role === 'assistant' && item.text.includes(proof.quote));
        if (!message) { throw new Error('推进依据必须逐字引用本次已接受的 AI 正文。'); }
        if (next) { next.progress = { from, reason: proof.reason, quote: proof.quote, floor: message.index }; }
    }
}
