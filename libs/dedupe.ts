/**
 * Near-duplicate removal over embedding vectors.
 *
 * Uses a greedy pass rather than connected components on purpose. With
 * clustering, A~B and B~C merges A and C even when A and C aren't similar to
 * each other, so a chain of small differences can collapse genuinely distinct
 * posts. The greedy pass compares each candidate only against items already
 * kept, so nothing is dropped unless it is directly similar to a survivor.
 */

/** Cosine similarity of two equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}

export interface DroppedItem<T> {
	item: T;
	/** The kept item this was judged a duplicate of. */
	duplicateOf: T;
	similarity: number;
}

export interface DedupeResult<T> {
	kept: T[];
	keptVectors: number[][];
	dropped: DroppedItem<T>[];
}

/**
 * Drop items whose vector is at or above `threshold` cosine similarity to an
 * item already kept.
 *
 * Items are considered in the order given, so sort by whatever should win
 * before calling — the first occurrence of a duplicate is the one retained.
 */
export function dropNearDuplicates<T>(
	items: T[],
	vectors: number[][],
	threshold: number
): DedupeResult<T> {
	if (items.length !== vectors.length) {
		throw new Error(
			`items and vectors must be the same length, got ${items.length} and ${vectors.length}`
		);
	}

	// Pre-normalise once so the inner loop is a plain dot product.
	const normalised = vectors.map((v) => {
		const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
		return norm === 0 ? v : v.map((x) => x / norm);
	});

	const kept: T[] = [];
	const keptVectors: number[][] = [];
	const keptNormalised: number[][] = [];
	const dropped: DroppedItem<T>[] = [];

	for (let i = 0; i < items.length; i++) {
		const candidate = normalised[i];
		let duplicateOfIndex = -1;
		let bestSimilarity = 0;

		for (let k = 0; k < keptNormalised.length; k++) {
			const other = keptNormalised[k];
			let dot = 0;
			for (let d = 0; d < candidate.length; d++) {
				dot += candidate[d] * other[d];
			}

			if (dot >= threshold && dot > bestSimilarity) {
				bestSimilarity = dot;
				duplicateOfIndex = k;
			}
		}

		if (duplicateOfIndex === -1) {
			kept.push(items[i]);
			keptVectors.push(vectors[i]);
			keptNormalised.push(candidate);
		} else {
			dropped.push({
				item: items[i],
				duplicateOf: kept[duplicateOfIndex],
				similarity: bestSimilarity,
			});
		}
	}

	return { kept, keptVectors, dropped };
}
