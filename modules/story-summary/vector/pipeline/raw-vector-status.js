import { getAllChunks, getChunkVectorDescriptors, getMeta } from '../storage/chunk-store.js';
import { collectRawChunkMaterials } from './chunk-materials.js';
import { selectChunksForRepair } from './chunk-repair-policy.js';
import { getEngineFingerprint } from '../utils/embedder.js';

export async function inspectRawVectorStatus(chatId, chat, config) {
    const [stored, vectors, meta] = await Promise.all([getAllChunks(chatId), getChunkVectorDescriptors(chatId), getMeta(chatId)]);
    const materials = collectRawChunkMaterials(chat);
    const fingerprint = getEngineFingerprint(config);
    const matchingDims = [...new Set(vectors
        .filter(item => item.valid && item.fingerprint === fingerprint && Number.isInteger(item.dims) && item.dims > 0)
        .map(item => item.dims))];
    const explicitDims = Number(config?.embeddingApi?.dims || config?.embeddingApi?.dimensions || config?.vectorDims || 0);
    const expectedDims = explicitDims > 0 ? explicitDims : (Number(meta?.dims) > 0 ? Number(meta.dims) : null);
    const dimsMismatch = matchingDims.length > 1
        || (expectedDims != null && matchingDims.some(dims => dims !== expectedDims));
    const missing = selectChunksForRepair(materials, stored, vectors, fingerprint, { verifySource: true, expectedDims });
    return { total: materials.length, missing: missing.length,
        missingFloors: new Set(missing.map(chunk => chunk.floor)).size,
        dimsMismatch,
        fingerprintMismatch: (!!meta.fingerprint && meta.fingerprint !== fingerprint) || dimsMismatch };
}
