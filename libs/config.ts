// Dimension of the vectors shipped in output/brian_posts_vectors.json.
// Queries must embed at the same dimension as the index they hit, so this
// is the one place to change it if you re-embed at a different size.
//
// Kept free of imports and side effects so client components can read it
// without pulling in the Pinecone SDK or any server-only env vars.
export const EMBEDDING_DIMENSIONS = 1536;
