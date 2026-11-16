import { getAllChunks, getChunkVectorDescriptors, getMeta, updateMeta, saveChunks, saveChunkVectors } from '../storage/chunk-store.js';
import { collectChunkMaterials, collectRawChunkMaterials } from './chunk-materials.js';
import { embed, getEngineFingerprint } from '../utils/embedder.js';
import { getEmbeddingFailureDetails } from '../llm/embedding-failure.js';
import { selectChunksForRepair } from './chunk-repair-policy.js';
import { inputDigest } from '../utils/vector-input-digest.js';
import { trackVectorActivity } from '../runtime/vector-activity.js';

const REPAIR_BATCH_SIZE = 20;

/** 自动维护与手动补齐共用：按已保存材料补向量，不重新解释已有楼层。 */
export async function repairMissingChunks(options) {
    return trackVectorActivity({ chatId: options.chatId, phase: 'l1-vector-repair', api: options.vectorConfig?.embeddingApi, unit: 'chunks' },
        activity => repairMissingChunksInner(options, activity));
}

async function repairMissingChunksInner({ chatId, chat, vectorConfig, signal, shouldCancel, onProgress, commit = task => task() }, activity) {
    const isCancelled = () => signal?.aborted || shouldCancel?.() === true;
    let repaired = 0;
    const chunks = [];
    let phase = 'read';
    const cancelled = () => ({ success: false, cancelled: true, repaired, chunks });
    try {
        if (isCancelled()) return cancelled();
        const fingerprint = getEngineFingerprint(vectorConfig);
        const meta = await getMeta(chatId);
        if (meta.fingerprint && meta.fingerprint !== fingerprint) {
            return { success: false, repaired, chunks, code: 'fingerprint_mismatch' };
        }
        const [stored, vectors] = await Promise.all([getAllChunks(chatId), getChunkVectorDescriptors(chatId)]);
        if (isCancelled()) return cancelled();
        const explicitDims = Number(vectorConfig?.embeddingApi?.dims || vectorConfig?.embeddingApi?.dimensions || vectorConfig?.vectorDims || 0) || null;
        let currentDims = explicitDims || (Number(meta.dims) > 0 ? Number(meta.dims) : null);
        let recordedDims = Number(meta.dims) > 0 ? Number(meta.dims) : null;
        let currentLastFloor = Number.isInteger(meta.lastChunkFloor) ? meta.lastChunkFloor : -1;
        const matchingDims = [...new Set(vectors
            .filter(item => item.valid && item.fingerprint === fingerprint && Number.isInteger(item.dims) && item.dims > 0)
            .map(item => item.dims))];
        if (matchingDims.length > 1 || (currentDims != null && matchingDims.some(dims => dims !== currentDims))) {
            return { success: false, repaired, chunks, code: 'dims_mismatch' };
        }
        if (!currentDims && matchingDims.length === 1) currentDims = matchingDims[0];
        const verifySource = vectorConfig.retrievalMode === 'raw';
        const materials = verifySource ? collectRawChunkMaterials(chat) : collectChunkMaterials(chat, stored, vectors);
        const missing = selectChunksForRepair(materials, stored, vectors, fingerprint, { verifySource, expectedDims: currentDims });
        activity.update({ total: missing.length });
        const storedIds = new Set(stored.map(chunk => chunk.chunkId));
        const storedTexts = new Map(stored.map(chunk => [chunk.chunkId, chunk.text]));
        const newMaterials = materials.filter(chunk => !storedIds.has(chunk.chunkId) || verifySource && storedTexts.get(chunk.chunkId) !== chunk.text);
        if (newMaterials.length) {
            phase = 'materials';
            await commit(() => saveChunks(chatId, newMaterials));
            chunks.push(...newMaterials);
            if (isCancelled()) return cancelled();
        }
        onProgress?.(0, missing.length);
        for (let i = 0; i < missing.length; i += REPAIR_BATCH_SIZE) {
            if (isCancelled()) return cancelled();
            const batch = missing.slice(i, i + REPAIR_BATCH_SIZE);
            phase = 'embedding';
            activity.update({ state: 'embedding', activeUnits: batch.length });
            const embeddings = await embed(batch.map(chunk => chunk.text), vectorConfig, { signal });
            if (isCancelled()) return cancelled();
            const batchDims = embeddings[0]?.length || null;
            if (currentDims && batchDims && currentDims !== batchDims) {
                return {
                    success: false,
                    repaired,
                    chunks,
                    code: 'dims_mismatch',
                    error: new Error(`Embedding 维度变化：期望 ${currentDims}，实际 ${batchDims}`),
                };
            }
            phase = 'write';
            activity.update({ state: 'saving', activeUnits: 0 });
            await commit(() => saveChunkVectors(chatId, batch.map((chunk, index) => ({
                chunkId: chunk.chunkId, vector: embeddings[index], sourceHash: inputDigest('chunk', chunk.text),
            })), fingerprint));
            repaired += batch.length;
            currentDims ??= batchDims;
            // WHY: 每完成一个批次立即推进已验证连续楼层水位线 lastChunkFloor 与实测维度 dims，
            // 防止修复中途取消或单批超时导致已提交批次重复回退到旧水位。
            const remaining = missing.slice(i + batch.length);
            const remainingMinFloor = remaining.length
                ? Math.min(...remaining.map(chunk => Number(chunk.floor ?? chat.length)))
                : chat.length;
            const nextFloor = Math.max(currentLastFloor, Math.min(chat.length - 1, remainingMinFloor - 1));
            if (nextFloor > currentLastFloor || (currentDims && recordedDims !== currentDims) || meta.fingerprint !== fingerprint) {
                phase = 'metadata';
                await commit(() => updateMeta(chatId, {
                    ...(nextFloor > currentLastFloor ? { lastChunkFloor: nextFloor } : {}),
                    ...(currentDims ? { dims: currentDims } : {}),
                    fingerprint,
                }));
                currentLastFloor = nextFloor;
                if (currentDims) recordedDims = currentDims;
            }
            activity.update({ completed: repaired });
            onProgress?.(repaired, missing.length);
        }
        if (isCancelled()) return cancelled();
        phase = 'metadata';
        if (currentLastFloor !== chat.length - 1 || meta.fingerprint !== fingerprint || (repaired > 0 && currentDims && recordedDims !== currentDims)) {
            await commit(() => updateMeta(chatId, {
                lastChunkFloor: chat.length - 1,
                ...(repaired > 0 && currentDims ? { dims: currentDims } : {}),
                fingerprint,
            }));
        }
        return { success: true, repaired, chunks };
    } catch (error) {
        if (isCancelled()) return cancelled();
        if (phase === 'embedding') {
            return { success: false, repaired, chunks, ...getEmbeddingFailureDetails(error), error };
        }
        const code = phase === 'materials'
            ? 'chunk_write_failed'
            : phase === 'write'
                ? 'vector_write_failed'
                : phase === 'metadata'
                    ? 'metadata_write_failed'
                    : 'chunk_read_failed';
        return { success: false, repaired, chunks, code, error };
    }
}
