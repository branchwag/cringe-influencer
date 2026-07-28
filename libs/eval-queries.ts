import fs from 'fs';
import path from 'path';

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

/** Small instruct model - generation is CPU-bound, so size costs real time. */
export const QUERY_MODEL = process.env.EVAL_QUERY_MODEL ?? 'qwen2.5:3b';

export interface EvalQuery {
	/** id of the post this query was generated from - the relevant document. */
	postId: string;
	query: string;
}

const PROMPT = (post: string) => `Below is a LinkedIn post. Write ONE short search query that someone might type into a search box to find this post.

Rules:
- 5 to 10 words.
- Paraphrase. Do not copy distinctive phrases or unusual wording from the post.
- Plain words separated by spaces. No hyphens joining words, no quotes, no punctuation at the end.
- Output ONLY the query and nothing else.

Post:
${post}`;

/**
 * Models drift off-format even at low temperature, so take the first line,
 * strip any wrapping quotes, and undo hyphen-joined output.
 */
function cleanQuery(raw: string): string | null {
	let query = (raw ?? '').trim().split('\n')[0].trim();
	query = query.replace(/^["'`]+|["'`]+$/g, '');
	query = query.replace(/^(query|search query)\s*:\s*/i, '');
	query = query.replace(/-+/g, ' ');
	query = query.replace(/\s+/g, ' ').trim();

	const words = query.split(' ').filter(Boolean);
	if (words.length < 3 || words.length > 16) return null;

	return query;
}

async function generateOne(post: string): Promise<string | null> {
	const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: QUERY_MODEL,
			prompt: PROMPT(post),
			stream: false,
			options: { temperature: 0.3, num_predict: 40 },
		}),
	});

	if (!response.ok) {
		throw new Error(
			`Ollama returned ${response.status} generating an eval query. ` +
				`Is "${QUERY_MODEL}" pulled? Try: ollama pull ${QUERY_MODEL}`
		);
	}

	const data = (await response.json()) as { response?: string };
	return cleanQuery(data.response ?? '');
}

/**
 * Generate one query per post, `concurrency` at a time.
 *
 * Generation is CPU-bound and slow (~9s per query at concurrency 4), so
 * results are cached to disk by the caller and reused across eval runs. Using
 * the same queries for every configuration is also what makes the comparison
 * meaningful.
 */
export async function generateQueries(
	posts: { id: string; text: string }[],
	concurrency: number = 4,
	onProgress?: (done: number, total: number) => void
): Promise<EvalQuery[]> {
	const results: EvalQuery[] = [];
	let done = 0;

	for (let i = 0; i < posts.length; i += concurrency) {
		const batch = posts.slice(i, i + concurrency);
		const queries = await Promise.all(
			batch.map((post) =>
				generateOne(post.text.replace(/\s+/g, ' ').slice(0, 900))
			)
		);

		batch.forEach((post, index) => {
			const query = queries[index];
			if (query) results.push({ postId: post.id, query });
		});

		done += batch.length;
		onProgress?.(done, posts.length);
	}

	return results;
}

export function cachePath(): string {
	return path.join(process.cwd(), 'output', 'eval_queries.json');
}

export function loadCached(): EvalQuery[] | null {
	const file = cachePath();
	if (!fs.existsSync(file)) return null;
	return JSON.parse(fs.readFileSync(file, 'utf8')) as EvalQuery[];
}

export function saveCache(queries: EvalQuery[]): void {
	fs.writeFileSync(cachePath(), JSON.stringify(queries, null, 2));
}
