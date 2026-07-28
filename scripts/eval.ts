/**
 * Retrieval eval.
 *
 * Generates a synthetic query per sampled post, then measures how well each
 * retrieval configuration finds the post the query came from.
 *
 * First-stage retrieval runs locally by brute-force cosine over the vectors in
 * output/, so comparing embedding configurations needs no Pinecone index.
 * Pinecone is only used for the rerank leg, since that model is hosted.
 *
 *   yarn eval              use cached queries if present
 *   EVAL_N=50 yarn eval    sample size (default 100)
 *   EVAL_REGEN=1 yarn eval force query regeneration
 */
import fs from 'fs';
import dotenv from 'dotenv';
import { embedQuery } from '../libs/ollama.ts';
import { rerank } from '../libs/pinecone.ts';
import { cosineSimilarity } from '../libs/dedupe.ts';
import {
	rankOf,
	summarise,
	lexicalOverlap,
	type MetricSummary,
} from '../libs/metrics.ts';
import {
	generateQueries,
	loadCached,
	saveCache,
	QUERY_MODEL,
	type EvalQuery,
} from '../libs/eval-queries.ts';

dotenv.config();

/** How many first-stage results are handed to the reranker. */
const RERANK_CANDIDATES = 20;

/**
 * Pinecone's free tier allows 60 rerank requests per minute for
 * bge-reranker-v2-m3 and returns 429 past that. Stay under it deliberately -
 * an eval that trips the limit halfway through wastes the whole run.
 */
const RERANK_PER_MINUTE = 50;
const MIN_RERANK_INTERVAL_MS = 60_000 / RERANK_PER_MINUTE;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let lastRerankAt = 0;

async function throttledRerank(
	query: string,
	documents: { id: string; text: string }[]
) {
	const waitFor = MIN_RERANK_INTERVAL_MS - (Date.now() - lastRerankAt);
	if (waitFor > 0) await sleep(waitFor);
	lastRerankAt = Date.now();

	try {
		return await rerank(query, documents, RERANK_CANDIDATES);
	} catch (error) {
		const is429 = String(error).includes('429');
		if (!is429) throw error;

		// Back off for a full window, then try once more.
		console.log('  rate limited by Pinecone, waiting 60s...');
		await sleep(60_000);
		lastRerankAt = Date.now();
		return await rerank(query, documents, RERANK_CANDIDATES);
	}
}

interface Vector {
	id: string;
	values: number[];
	metadata: { text: string };
}

function sample<T>(items: T[], n: number, seed = 42): T[] {
	// Deterministic shuffle so runs are comparable.
	let state = seed;
	const random = () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy.slice(0, n);
}

function table(rows: [string, MetricSummary][]): void {
	const pct = (x: number) => (x * 100).toFixed(1).padStart(6);
	const num = (x: number) => x.toFixed(4).padStart(7);
	console.log(
		'\n  config          recall@1  recall@5  recall@10      MRR   nDCG@10  misses'
	);
	console.log('  ' + '-'.repeat(72));
	for (const [name, m] of rows) {
		console.log(
			`  ${name.padEnd(14)}  ${pct(m.recallAt1)}%   ${pct(m.recallAt5)}%    ${pct(
				m.recallAt10
			)}%  ${num(m.mrr)}   ${num(m.ndcgAt10)}  ${String(m.misses).padStart(6)}`
		);
	}
}

async function main() {
	const vectors: Vector[] = JSON.parse(
		fs.readFileSync('output/brian_posts_vectors.json', 'utf8')
	);
	const byId = new Map(vectors.map((v) => [v.id, v]));
	console.log(`Corpus: ${vectors.length} vectors`);

	const n = Number(process.env.EVAL_N ?? 100);
	let queries: EvalQuery[] | null = process.env.EVAL_REGEN
		? null
		: loadCached();

	if (queries) {
		console.log(`Using ${queries.length} cached queries from output/`);
	} else {
		const posts = sample(vectors, n).map((v) => ({
			id: v.id,
			text: v.metadata.text,
		}));
		console.log(
			`Generating ${posts.length} queries with ${QUERY_MODEL} (slow, CPU-bound)...`
		);
		queries = await generateQueries(posts, 4, (done, total) => {
			if (done % 20 === 0 || done === total) {
				console.log(`  ${done}/${total}`);
			}
		});
		saveCache(queries);
		console.log(`Cached ${queries.length} queries to output/eval_queries.json`);
	}

	// How much of each query's vocabulary is lifted from its source post.
	const overlap =
		queries.reduce((sum, q) => {
			const post = byId.get(q.postId);
			return sum + (post ? lexicalOverlap(q.query, post.metadata.text) : 0);
		}, 0) / queries.length;

	console.log(`\nRunning retrieval over ${queries.length} queries...`);
	const baselineRanks: (number | null)[] = [];
	const rerankedRanks: (number | null)[] = [];

	for (const [i, { postId, query }] of queries.entries()) {
		const queryVector = await embedQuery(query);

		const scored = vectors
			.map((v) => ({ id: v.id, score: cosineSimilarity(queryVector, v.values) }))
			.sort((a, b) => b.score - a.score);

		const rankedIds = scored.map((s) => s.id);
		baselineRanks.push(rankOf(rankedIds, postId));

		const candidates = scored.slice(0, RERANK_CANDIDATES).map((s) => ({
			id: s.id,
			text: byId.get(s.id)?.metadata.text ?? '',
		}));
		const reranked = await throttledRerank(query, candidates);
		const rerankedIds = reranked.data.map(
			(r: { index: number }) => candidates[r.index].id
		);
		rerankedRanks.push(rankOf(rerankedIds, postId));

		if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${queries.length}`);
	}

	// The reranker only ever sees the top RERANK_CANDIDATES, so comparing it
	// against a vector ranking of the whole corpus is unfair - the vector row
	// can never "miss" because the answer is always somewhere in 719 results.
	// Truncating the vector ranking to the same candidate set isolates ordering
	// quality, which is the thing the reranker is actually claiming to improve.
	const truncatedRanks = baselineRanks.map((rank) =>
		rank !== null && rank <= RERANK_CANDIDATES ? rank : null
	);

	table([
		['vector (all)', summarise(baselineRanks)],
		[`vector (top${RERANK_CANDIDATES})`, summarise(truncatedRanks)],
		['+ rerank', summarise(rerankedRanks)],
	]);

	const ceiling = 1 - summarise(truncatedRanks).misses / queries.length;
	console.log(
		`\n  The reranker only sees the top ${RERANK_CANDIDATES} vector results, so it can` +
			`\n  reorder but never recover a miss. Compare it against the "top${RERANK_CANDIDATES}" row,` +
			`\n  which is the same candidate set in vector order.` +
			`\n  Ceiling from first-stage recall@${RERANK_CANDIDATES}: ${(ceiling * 100).toFixed(1)}%`
	);
	console.log(
		`\n  Mean lexical overlap between query and source post: ${(overlap * 100).toFixed(
			1
		)}%` +
			`\n  Generated queries reuse the source vocabulary, so absolute numbers run` +
			`\n  optimistic. Use them to compare configurations, not as a quality score.`
	);
}

main().catch((error) => {
	console.error('❌ Eval failed:', error);
	process.exit(1);
});
