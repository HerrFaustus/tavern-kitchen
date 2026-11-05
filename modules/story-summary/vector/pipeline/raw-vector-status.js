import { getAllChunks, getChunkVectorDescriptors, getMeta } from '../storage/chunk-store.js';
import { collectRawChunkMaterials } from './chunk-materials.js';
import { selectChunksForRepair } from './chunk-repair-policy.js';
import { getEngineFingerprint } from '../utils/embedder.js';

export async function inspectRawVectorStatus(chatId, chat, config) {
    const [stored, vectors, meta] = await Promise.all([getAllChunks(chatId), getChunkVectorDescriptors(chatId), getMeta(chatId)]);
    const materials = collectRawChunkMaterials(chat);
    const fingerprint = getEngineFingerprint(config);
    const missing = selectChunksForRepair(materials, stored, vectors, fingerprint, { verifySource: true });
    return { total: materials.length, missing: missing.length,
        missingFloors: new Set(missing.map(chunk => chunk.floor)).size,
        fingerprintMismatch: !!meta.fingerprint && meta.fingerprint !== fingerprint };
}
