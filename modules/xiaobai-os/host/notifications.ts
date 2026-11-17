import { showAgentNotice } from '../../../core/agent-status.js';

export function notifySillyTavernSuccess({ title, message }: { title: string; message: string }): void {
    showAgentNotice({ level: 'success', message: `${title}：${message}`, timeoutMs: 8_000 });
}
