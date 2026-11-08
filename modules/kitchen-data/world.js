import { emptyWorld, validateWorld, forkWorld, canonical } from '../world-records/domain.js';
import { createIdentifier } from '../../shared/common/identifier.js';

// Prepare an inactive namespace. A confirmed memory publication activates it.
export function createWorldCardData({ identity, storage, service, noteStore }) {
    return {
            async read() {
                const owner = identity(), world = await service.read();
                const notes = await noteStore.list(owner);
                if (owner !== identity()) throw new Error('聊天已切换');
                return { world, notes };
            },
            async stage(backup, notes, namespace, assertCurrent) {
                const owner = identity(), target = identity(namespace), before = await storage.read(owner);
                assertCurrent();
                const parsed = backup ? validateWorld(structuredClone(backup)) : emptyWorld(createIdentifier(), createIdentifier(), '导入的世界');
                const next = forkWorld(parsed, parsed.version, createIdentifier());
                await storage.update(target, () => ({ state: next, result: next }), () => { assertCurrent(); return owner === identity(); });
                await noteStore.putImported(target, notes.map(note => ({ ...structuredClone(note), owner: target, id: namespace + ':' + note.id })),
                    () => { assertCurrent(); return owner === identity(); });
                const current = await storage.read(owner);
                if (canonical(current) !== canonical(before)) throw new Error('导入期间世界数据已变化，请重试');
                return { assertCurrent: () => {
                    assertCurrent();
                    if (![owner, target].includes(identity())) throw new Error('聊天已切换');
                } };
            },
    };
}
