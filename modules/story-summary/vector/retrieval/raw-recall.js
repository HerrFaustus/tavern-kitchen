import { getContext } from '../../../../../../../extensions.js';
import { getPublishedSummaryStore } from '../../data/store.js';
import { memoryTagsByFloor } from '../../data/memory-tags.js';
import { captureRangeSource, isRangeSourceCurrent, messageCandidates } from '../../data/turn-source.js';
import { chunkMessage } from '../pipeline/chunk-text.js';
import { cleanRecallMessageText } from '../utils/text-filter.js';
import { getTokenizerSnapshot, injectEntities } from '../utils/tokenizer.js';
import { getRawEntityVocabulary } from './raw-vocabulary.js';
import { embed, getEngineFingerprint } from '../utils/embedder.js';
import { getMeta } from '../storage/chunk-store.js';
import { boundRecallEmbeddingSegment } from './recall-query-bounds.js';
import { searchRawRecallRuntime } from '../runtime/runtime.js';
import { rerank } from '../llm/reranker.js';
import { throwIfSignalAborted } from '../../../../shared/common/abort-utils.js';
import { recordRecallFallback, recordRecallObservation, recordRecallRuntimeProgress } from '../../recall-diagnostics.js';

export async function recallRawMemory(vectorConfig, { hiddenThrough, focusOnly = false, excludeLastAi = false, signal = null,
    diagnostics, withQueryEmbedding } = {}) {
    const { chatId, chat = [] } = getContext();
    const store = getPublishedSummaryStore();
    const empty = { chunks: [], focusCharacters: [], stats: { documents: 0, candidates: 0 } };
    if (!chatId || !chat.length || hiddenThrough < 0) return empty;
    if (excludeLastAi && !chat.at(-1)?.is_user) hiddenThrough = Math.min(hiddenThrough, chat.length - 2);
    const queryMessages = chat.slice(0, excludeLastAi && !chat.at(-1)?.is_user ? -1 : undefined).slice(-3);
    const query = boundRecallEmbeddingSegment(queryMessages.map(message => `${message.name || (message.is_user ? '用户' : '角色')}：${cleanRecallMessageText(message.mes || '')}`).join('\n'));
    if (!query.trim()) return empty;
    const vocabulary = getRawEntityVocabulary(store, getContext());
    injectEntities(vocabulary.lexicon, vocabulary.displayMap, vocabulary.blockedTerms);
    const tokenizer = getTokenizerSnapshot();
    const focusCharacters = [...new Set(tokenizer.extractEntities(query))];
    if (focusOnly) return { ...empty, focusCharacters };
    const source = captureRangeSource(chat, 0, chat.length - 1);
    const assertCurrent = () => {
        throwIfSignalAborted(signal);
        if (getContext()?.chatId !== chatId || !isRangeSourceCurrent(source, getContext()?.chat || [])) {
            throw Object.assign(new Error('召回期间正文来源已变化'), { name: 'AbortError' });
        }
    };
    const omitted = new Set((store?.summaryHistory || []).filter(batch => batch.floorEntry?.omitted).map(batch => batch.floorEntry.floor));
    const tags = memoryTagsByFloor(store, chat);
    const documents = chat.slice(0, hiddenThrough + 1).flatMap((message, floor) => omitted.has(floor) ? []
        : chunkMessage(floor, message).map(chunk => ({ ...chunk, tags: tags.get(floor) || [], candidate: messageCandidates(message).selected })));
    if (!documents.length) return empty;
    const normalizedQuery = query.normalize('NFKC').toLowerCase();
    const tagTerms = [...new Set([...tags.values()].flat())].filter(term => normalizedQuery.includes(term.normalize('NFKC').toLowerCase()));
    const terms = [...new Set([...tagTerms, ...tokenizer.tokenizeForIndex(query).slice(-32)])].slice(0, 48);
    let queryVector = null;
    const fingerprint = getEngineFingerprint(vectorConfig);
    const meta = await getMeta(chatId);
    assertCurrent();
    if (vectorConfig.embeddingApi?.key && meta.fingerprint === fingerprint && (meta.lastChunkFloor ?? -1) >= 0) {
        if (diagnostics) diagnostics.stage = 'raw-embed';
        try {
            const request = () => embed([query], vectorConfig, { signal, timeout: 15000 });
            [queryVector] = await (withQueryEmbedding ? withQueryEmbedding(request) : request());
            if (!queryVector?.length || !Array.from(queryVector).every(Number.isFinite)) throw new Error('原文查询向量无效');
        } catch (error) {
            queryVector = null;
            assertCurrent();
            recordRecallFallback(diagnostics, 'raw-embedding', error);
        }
    }
    assertCurrent();
    if (diagnostics) diagnostics.stage = 'raw-retrieval';
    const result = await searchRawRecallRuntime(chatId, documents, {
        queryVector, queryTerms: terms, fingerprint, signal,
        onProgress: event => recordRecallRuntimeProgress(diagnostics, event),
    });
    assertCurrent();
    recordRecallObservation(diagnostics, 'raw', { phase: 'candidates', mode: queryVector ? 'hybrid' : 'keyword', documentCount: result.stats.documents });
    // One bounded pool; no event/floor rerank or graph expansion.
    if (vectorConfig.rerankApi?.key && result.chunks.length > 1) {
        if (diagnostics) diagnostics.stage = 'raw-rerank';
        try {
            const ranked = await rerank(query, result.chunks.map(chunk => chunk.text), { topN: result.chunks.length, signal });
            assertCurrent();
            if (ranked.failed || !Array.isArray(ranked.results)) throw new Error(ranked.diagnostic?.kind || 'rerank_failed');
            const scores = new Map(ranked.results.filter(item => Number.isFinite(item.relevance_score)).map(item => [item.index, item.relevance_score]));
            result.chunks = result.chunks.map((chunk, index) => ({ ...chunk, _rerankScore: scores.get(index) ?? 0 }))
                .sort((a, b) => b._rerankScore - a._rerankScore || b._score - a._score);
        } catch (error) {
            assertCurrent();
            recordRecallFallback(diagnostics, 'raw-rerank', error);
        }
    }
    return { ...result, focusCharacters, source };
}
