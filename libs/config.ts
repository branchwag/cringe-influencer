// Embedding configuration.
//
// This project uses nomic-embed-text served locally by Ollama rather than a
// hosted embedding API, so there is no embedding API key and no per-query
// cost. See README for the Ollama prerequisite.
//
// nomic-embed-text produces fixed 768-dimensional vectors. Unlike OpenAI's
// text-embedding-3-small it is not Matryoshka, so the size cannot be
// requested per call - the index must be created at exactly this dimension.
//
// This module deliberately has no imports and no side effects so that client
// components can read these values without pulling in server-only code.
export const EMBEDDING_DIMENSIONS = 768;

export const EMBEDDING_MODEL = 'nomic-embed-text';
