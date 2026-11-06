import { isNarrativeReply } from './turn-source.js';

// End of the older prefix. Everything after it, including pending input, stays visible.
export function beforeRecentTurns(chat, end, keep) {
    let remaining = keep;
    for (let i = Math.min(end, chat.length - 1); i >= 0; i--) {
        if (!isNarrativeReply(chat[i])) continue;
        if (remaining === 0) return i;
        remaining--;
    }
    return -1;
}

export function crossesReviewInterval(chat, start, end, interval) {
    let turns = 0, prior = 0;
    for (let i = 0; i <= end && i < chat.length; i++) {
        if (isNarrativeReply(chat[i])) {
            turns++;
            if (i < start) prior++;
        }
    }
    return Math.floor(turns / interval) > Math.floor(prior / interval);
}
