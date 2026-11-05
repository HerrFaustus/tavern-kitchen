import { chunkVectorsTable } from '../../data/db.js';
import { rankRawChunks } from '../retrieval/raw-ranking.js';

// No resident snapshot, event vectors, scene extraction or graph. Both runtime
// backends use the same raw-only reader and deterministic scorer.
export async function searchRawRecords(chatId, documents, options) {
    const vectors = options.queryVector?.length
        ? await chunkVectorsTable.where('chatId').equals(chatId).toArray() : [];
    const result = rankRawChunks(documents, vectors, options);
    return { ...result, stats: { ...result.stats, chatId, owner: 'raw-source', cacheMode: 'none', status: 'raw-read-complete',
        chunks: documents.length, chunkVectors: result.stats.usableVectors } };
}
