import { cosineSimilarity, toFloat32 } from '../runtime/scoring.js';
import { inputDigest } from '../utils/vector-input-digest.js';

const normalize = value => String(value || '').normalize('NFKC').toLowerCase();

// One source of candidates: current raw chunks. Tags only help locate a chunk;
// they never become evidence or a second vector document.
export function rankRawChunks(documents, records, { queryVector, queryTerms = [], fingerprint, limit = 40 } = {}) {
    const terms = [...new Set(queryTerms.map(normalize).filter(term => term.trim().length >= 2))].slice(0, 48);
    const vectors = new Map(records.map(record => [record.chunkId, record]));
    const rows = documents.map(chunk => {
        const sourceHash = inputDigest('chunk', chunk.text);
        const record = vectors.get(chunk.chunkId);
        let vector = null;
        try {
            const value = record?.fingerprint === fingerprint && record?.sourceHash === sourceHash ? toFloat32(record.vector) : null;
            if (queryVector?.length && value?.length === queryVector.length && (record.dims == null || record.dims === value.length) && Array.from(value).every(Number.isFinite)
                && value.some(number => number !== 0)) vector = value;
        } catch { vector = null; }
        const text = normalize(chunk.text);
        const tags = normalize((chunk.tags || []).join(' '));
        return { ...chunk, sourceHash, _vectorPresent: !!vector,
            _cosineScore: vector ? cosineSimilarity(queryVector, vector) : 0,
            _terms: terms.filter(term => text.includes(term) || tags.includes(term)) };
    });
    const frequencies = new Map(terms.map(term => [term, rows.filter(row => row._terms.includes(term)).length]));
    for (const row of rows) row._lexicalScore = row._terms.reduce((score, term) => score + Math.log(1 + rows.length / (1 + frequencies.get(term))), 0);
    const stable = (a, b) => a.floor - b.floor || a.chunkIdx - b.chunkIdx;
    const dense = rows.filter(row => row._vectorPresent && row._cosineScore >= 0.35)
        .sort((a, b) => b._cosineScore - a._cosineScore || stable(a, b)).slice(0, limit);
    const lexical = rows.filter(row => row._lexicalScore > 0)
        .sort((a, b) => b._lexicalScore - a._lexicalScore || stable(a, b)).slice(0, limit);
    const pool = new Map();
    for (const channel of [dense, lexical]) channel.forEach((row, index) => {
        const item = pool.get(row.chunkId) || { ...row, _score: 0 };
        item._score += 1 / (60 + index + 1);
        pool.set(row.chunkId, item);
    });
    return {
        chunks: [...pool.values()].sort((a, b) => b._score - a._score || stable(a, b)).slice(0, limit)
            .map(({ _terms, tags, ...row }) => row),
        stats: { documents: rows.length, usableVectors: rows.filter(row => row._vectorPresent).length,
            denseHits: dense.length, lexicalHits: lexical.length, candidates: pool.size },
    };
}
