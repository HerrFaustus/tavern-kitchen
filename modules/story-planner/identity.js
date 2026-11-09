export function plannerOwner(identity, world) {
    return identity && world?.worldId && world?.branchId
        ? JSON.stringify([identity, world.worldId, world.branchId]) : '';
}
