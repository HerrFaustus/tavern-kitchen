import { chunkVectorsTable } from '../../data/db.js';
import { rankRawChunks } from '../retrieval/raw-ranking.js';

const VECTOR_LOOKUP_BATCH_SIZE = 400;

async function readRawChunkVectors(chatId, documents) {
    const chunkIds = [...new Set((documents || []).map(doc => doc?.chunkId).filter(Boolean))];
    if (!chunkIds.length) return [];
    const records = [];
    for (let i = 0; i < chunkIds.length; i += VECTOR_LOOKUP_BATCH_SIZE) {
        const keys = chunkIds.slice(i, i + VECTOR_LOOKUP_BATCH_SIZE).map(chunkId => [chatId, chunkId]);
        const rows = await chunkVectorsTable.where('[chatId+chunkId]').anyOf(keys).toArray();
        records.push(...rows);
    }
    return records;
}

// No resident snapshot, event vectors, scene extraction or graph. Both runtime
// backends use the same raw-only reader and deterministic scorer.
export async function searchRawRecords(chatId, documents, options) {
    let vectors = [];
    let vectorReadError = null;
    if (options.queryVector?.length && documents?.length) {
        try {
            vectors = await readRawChunkVectors(chatId, documents);
        } catch (error) {
            // WHY: 向量索引读取异常不应阻断关键词召回；捕获并显式记录降级原因，确保上下文召回持续可用。
            vectorReadError = error?.message || String(error);
            console.warn({ source: import.meta.url, operation: 'searchRawRecords', chatId }, error);
            vectors = [];
        }
    }
    const result = rankRawChunks(documents, vectors, options);
    return {
        ...result,
        stats: {
            ...result.stats,
            chatId,
            owner: 'raw-source',
            cacheMode: 'none',
            status: vectorReadError ? 'raw-vector-read-fallback' : 'raw-read-complete',
            chunks: documents.length,
            chunkVectors: result.stats.usableVectors,
            ...(vectorReadError ? { vectorReadError } : {}),
        },
    };
}
