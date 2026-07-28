const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
const EMBEDDING_MODEL = 'nomic-embed-text';

// nomic-embed-text is trained with task prefixes and expects them. Indexed
// content gets "search_document: " and incoming queries get "search_query: ".
// Mixing these up (or omitting them) measurably degrades retrieval, so they
// are applied here rather than left to call sites.
const DOCUMENT_PREFIX = 'search_document: ';
const QUERY_PREFIX = 'search_query: ';

/**
 * @param {string[]} inputs
 * @returns {Promise<number[][]>}
 */
async function embed(inputs) {
	let response;

	try {
		response = await fetch(`${OLLAMA_HOST}/api/embed`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
		});
	} catch (error) {
		throw new Error(
			`Could not reach Ollama at ${OLLAMA_HOST}. Is it running? ` +
				`Start it with "ollama serve" and make sure you have pulled ` +
				`the model with "ollama pull ${EMBEDDING_MODEL}".`,
			{ cause: error }
		);
	}

	if (!response.ok) {
		throw new Error(
			`Ollama returned ${response.status} ${response.statusText}: ` +
				`${await response.text()}`
		);
	}

	const data = await response.json();

	if (!data.embeddings?.length) {
		throw new Error(
			`Ollama returned no embeddings for ${inputs.length} input(s).`
		);
	}

	return data.embeddings;
}

/**
 * Embed a single search query.
 * @param {string} query
 * @returns {Promise<number[]>}
 */
export async function embedQuery(query) {
	const [embedding] = await embed([`${QUERY_PREFIX}${query}`]);
	return embedding;
}

/**
 * Embed documents for indexing. Batched so a large corpus doesn't go up as
 * one enormous request.
 * @param {string[]} texts
 * @param {number} [batchSize]
 * @returns {Promise<number[][]>}
 */
export async function embedDocuments(texts, batchSize = 32) {
	const embeddings = [];

	for (let i = 0; i < texts.length; i += batchSize) {
		const batch = texts.slice(i, i + batchSize);
		const batchEmbeddings = await embed(
			batch.map((text) => `${DOCUMENT_PREFIX}${text}`)
		);

		embeddings.push(...batchEmbeddings);
		console.log(
			`Embedded ${Math.min(i + batchSize, texts.length)}/${texts.length}`
		);
	}

	return embeddings;
}
