/**
 * Retrieval metrics.
 *
 * Each eval query has exactly one known-relevant document (the post the query
 * was generated from), so these are written for the single-relevant-item case.
 */

/**
 * 1-based rank of `relevantId` in `rankedIds`, or null if it isn't present.
 */
export function rankOf(rankedIds: string[], relevantId: string): number | null {
	const index = rankedIds.indexOf(relevantId);
	return index === -1 ? null : index + 1;
}

/** 1/rank, or 0 if the relevant document was never retrieved. */
export function reciprocalRank(rank: number | null): number {
	return rank === null ? 0 : 1 / rank;
}

/** Whether the relevant document made the top k. */
export function hitAtK(rank: number | null, k: number): boolean {
	return rank !== null && rank <= k;
}

/**
 * nDCG at k. With a single relevant document of gain 1, the ideal DCG is 1, so
 * this reduces to 1/log2(rank+1) when the document is inside k.
 */
export function ndcgAtK(rank: number | null, k: number): number {
	if (rank === null || rank > k) return 0;
	return 1 / Math.log2(rank + 1);
}

export interface MetricSummary {
	queries: number;
	recallAt1: number;
	recallAt5: number;
	recallAt10: number;
	mrr: number;
	ndcgAt10: number;
	/** Queries where the relevant post was never retrieved at all. */
	misses: number;
}

/** Aggregate a set of per-query ranks into the summary above. */
export function summarise(ranks: (number | null)[]): MetricSummary {
	const n = ranks.length;
	if (n === 0) {
		throw new Error('summarise() needs at least one rank');
	}

	const mean = (fn: (rank: number | null) => number) =>
		ranks.reduce((sum, rank) => sum + fn(rank), 0) / n;

	return {
		queries: n,
		recallAt1: mean((r) => (hitAtK(r, 1) ? 1 : 0)),
		recallAt5: mean((r) => (hitAtK(r, 5) ? 1 : 0)),
		recallAt10: mean((r) => (hitAtK(r, 10) ? 1 : 0)),
		mrr: mean(reciprocalRank),
		ndcgAt10: mean((r) => ndcgAtK(r, 10)),
		misses: ranks.filter((r) => r === null).length,
	};
}

/**
 * Fraction of the query's words that also appear in the source document.
 *
 * LLM-generated queries tend to reuse the source document's vocabulary, which
 * inflates retrieval scores relative to real user queries. Reporting this makes
 * the size of that effect visible rather than leaving it as a caveat.
 */
export function lexicalOverlap(query: string, document: string): number {
	const words = (text: string) =>
		new Set(
			text
				.toLowerCase()
				.replace(/[^\w\s]/g, ' ')
				.split(/\s+/)
				.filter((word) => word.length > 3)
		);

	const queryWords = words(query);
	if (queryWords.size === 0) return 0;

	const documentWords = words(document);
	let shared = 0;
	for (const word of queryWords) {
		if (documentWords.has(word)) shared++;
	}

	return shared / queryWords.size;
}
