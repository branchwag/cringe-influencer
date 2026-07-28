import { processCsv, type ProcessedCsvRow } from '../libs/csv-processor.ts';
import { embedDocuments } from '../libs/ollama.ts';
import { dropNearDuplicates } from '../libs/dedupe.ts';
import { DEDUPE_SIMILARITY_THRESHOLD } from '../libs/config.ts';
import fs from 'fs';
import path from 'path';

interface IndexedPost {
	post: ProcessedCsvRow;
	/** Position in the original CSV, so output order stays stable. */
	order: number;
}

const preview = (text: string, length: number) =>
	text.replace(/\s+/g, ' ').slice(0, length);

async function main() {
	try {
		console.log('Processing CSV file...');
		const csvPath = 'data/brian_posts.csv';
		const posts = await processCsv(csvPath);

		console.log(`Found ${posts.length} valid posts`);

		console.log('Creating embeddings...');
		const texts = posts.map((post) => post.text);
		const embeddings = await embedDocuments(texts);

		// The corpus contains reposts of the same content. Consider the most
		// engaged copy first so that's the one kept when duplicates collapse.
		const indexed: IndexedPost[] = posts.map((post, order) => ({
			post,
			order,
		}));
		const ranked = [...indexed].sort(
			(a, b) => b.post.numImpressions - a.post.numImpressions
		);
		const rankedVectors = ranked.map((entry) => embeddings[entry.order]);

		console.log(
			`Removing near-duplicates at cosine >= ${DEDUPE_SIMILARITY_THRESHOLD}...`
		);
		const { kept, keptVectors, dropped } = dropNearDuplicates(
			ranked,
			rankedVectors,
			DEDUPE_SIMILARITY_THRESHOLD
		);

		for (const { item, duplicateOf, similarity } of dropped.slice(0, 10)) {
			console.log(
				`  ${similarity.toFixed(3)}  "${preview(item.post.text, 55)}..."` +
					`  dup of  "${preview(duplicateOf.post.text, 40)}..."`
			);
		}
		if (dropped.length > 10) {
			console.log(`  ...and ${dropped.length - 10} more`);
		}
		console.log(
			`Dropped ${dropped.length} duplicates, ${kept.length} posts remain`
		);

		// Restore original CSV order so the output file diffs cleanly.
		const restored = kept
			.map((entry, i) => ({ entry, vector: keptVectors[i] }))
			.sort((a, b) => a.entry.order - b.entry.order);

		console.log('Preparing vectors for Pinecone...');
		const vectors = restored.map(({ entry, vector }) => ({
			id: entry.post.id,
			values: vector,
			metadata: {
				text: entry.post.text,
				type: entry.post.type,
				firstName: entry.post.firstName,
				lastName: entry.post.lastName,
				numImpressions: entry.post.numImpressions,
				numViews: entry.post.numViews,
				numReactions: entry.post.numReactions,
				numComments: entry.post.numComments,
				numShares: entry.post.numShares,
				createdAt: entry.post.createdAt,
				link: entry.post.link,
				hashtags: entry.post.hashtags,
			},
		}));

		const outputPath = path.join(
			process.cwd(),
			'output',
			'brian_posts_vectors.json'
		);

		console.log('Saving vectors to JSON file...');
		fs.writeFileSync(outputPath, JSON.stringify(vectors, null, 2));

		console.log(`✅ Successfully created ${vectors.length} vectors`);
		console.log(`📁 Saved to: ${outputPath}`);
		console.log('Ready for Pinecone upload!');
	} catch (error) {
		console.error('❌ Error:', error);
		process.exit(1);
	}
}

main();
