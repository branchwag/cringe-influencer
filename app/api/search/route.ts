import { NextRequest, NextResponse } from 'next/server';
import { embedQuery } from '../../../libs/ollama';
import { queryVectors, INDEX_NAME } from '../../../libs/pinecone';

export async function POST(request: NextRequest) {
	try {
		const { query, topK = 5 } = await request.json();

		if (!query) {
			return NextResponse.json(
				{ error: 'Query is required' },
				{ status: 400 }
			);
		}

		console.log(`Searching for: "${query}"`);

		const queryEmbedding = await embedQuery(query);

		const results = await queryVectors(
			INDEX_NAME,
			queryEmbedding,
			topK,
			true
		);

		const documents = results.map((match: any) => ({
			id: match.id,
			score: match.score,
			text: match.metadata?.text || 'No text available',
			type: match.metadata?.type,
			firstName: match.metadata?.firstName,
			lastName: match.metadata?.lastName,
			numImpressions: match.metadata?.numImpressions,
			numViews: match.metadata?.numViews,
			numReactions: match.metadata?.numReactions,
			numComments: match.metadata?.numComments,
			numShares: match.metadata?.numShares,
			createdAt: match.metadata?.createdAt,
			link: match.metadata?.link,
			hashtags: match.metadata?.hashtags,
		}));

		return NextResponse.json({
			query,
			documents,
			total: documents.length,
		});
	} catch (error) {
		console.error('Search error:', error);
		return NextResponse.json(
			{ error: 'Internal server error' },
			{ status: 500 }
		);
	}
}
