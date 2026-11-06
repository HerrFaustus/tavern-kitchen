import type { Involvement } from '../../../../story-state/situation-links.js';
import type { MaintenanceParticipant } from '../../../capabilities/maintenance/registry.js';
import type { WorldService } from '../application/service.js';
import { createWorldMaintenanceSession } from '../maintenance/session.js';
import type { WorldSettings } from '../types.js';

export function createWorldMaintenanceParticipant(world: WorldService, readSettings: () => WorldSettings, getInvolvement?: (identity:string) => Involvement[]): MaintenanceParticipant {
    return {
        id: 'world',
        isEnabled: mode => mode !== 'automatic' || !!(readSettings().subscribed || readSettings().peopleEvolution),
        async createSession(source, mode) {
            const current = await world.refreshCurrent();
            if (!source.chatIdentity || current.chatIdentity !== source.chatIdentity) { throw new Error('world_chat_changed'); }
            if (mode === 'automatic' && !(readSettings().subscribed || readSettings().peopleEvolution)) { return null; }
            const select = mode === 'automatic' && getInvolvement ? () => getInvolvement(source.chatIdentity).filter(row =>
                (row.kind === 'person' ? readSettings().peopleEvolution : row.kind === 'situation' && readSettings().subscribed)
                && (row.near || source.messages.some(message => message.index === row.wakeFloor && message.role === 'assistant'))) : undefined;
            if (select && !select().length) { return null; }
            return createWorldMaintenanceSession(world, mode, mode === 'automatic' ? readSettings : undefined, source.messages, select);
        },
    };
}
