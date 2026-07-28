import { upsertVectors, type VectorRecord } from '../libs/pinecone.ts';
import { Pinecone } from '@pinecone-database/pinecone';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const pc = new Pinecone({
	apiKey: process.env.PINECONE_API_KEY ?? '',
});

async function createIndexIfNeeded(
	indexName: string,
	dimension: number
): Promise<boolean> {
	try {
		const indexList = await pc.listIndexes();
		const existingIndex = indexList.indexes?.find(
			(idx) => idx.name === indexName
		);

		if (existingIndex) {
			console.log(`Index '${indexName}' already exists`);
			if (existingIndex.dimension !== dimension) {
				console.warn(
					`⚠️  Index dimension mismatch: expected ${dimension}, got ${existingIndex.dimension}`
				);
				console.log(
					`You may need to delete the existing index or use a different name`
				);
				return false;
			}
			return true;
		}

		console.log(
			`Creating index '${indexName}' with dimension ${dimension}...`
		);
		await pc.createIndex({
			name: indexName,
			dimension: dimension,
			metric: 'cosine',
			spec: {
				serverless: {
					cloud: 'aws',
					region: 'us-east-1',
				},
			},
		});

		console.log(`✅ Index '${indexName}' created successfully`);
		return true;
	} catch (error) {
		console.error('Error managing index:', error);
		return false;
	}
}

async function uploadVectorsToPinecone() {
	try {
		const vectorsPath = path.join(
			process.cwd(),
			'output',
			'brian_posts_vectors.json'
		);

		if (!fs.existsSync(vectorsPath)) {
			throw new Error(`Vectors file not found at: ${vectorsPath}`);
		}

		console.log('Loading vectors from file...');
		const vectorsData = fs.readFileSync(vectorsPath, 'utf8');
		const vectors: VectorRecord[] = JSON.parse(vectorsData);

		if (vectors.length === 0) {
			throw new Error('No vectors found in file');
		}

		const dimension = vectors[0].values.length;
		console.log(
			`Found ${vectors.length} vectors with dimension ${dimension}`
		);

		const indexName = process.env.PINECONE_INDEX_NAME ?? '';

		if (!indexName) {
			throw new Error('PINECONE_INDEX_NAME is not set in your .env');
		}
		const indexReady = await createIndexIfNeeded(indexName, dimension);

		if (!indexReady) {
			throw new Error('Index is not ready for upload');
		}

		console.log(`Uploading to Pinecone index: ${indexName}`);

		await upsertVectors(indexName, vectors);

		console.log('✅ Successfully uploaded all vectors to Pinecone!');
		console.log(
			`📊 Uploaded ${vectors.length} vectors to index '${indexName}'`
		);
	} catch (error) {
		console.error('❌ Error uploading vectors:', error);
		process.exit(1);
	}
}

uploadVectorsToPinecone();
