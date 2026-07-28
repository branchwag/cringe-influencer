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

// Cosine similarity at or above which two posts are treated as the same post
// and the lower-engagement one is dropped before upload.
//
// The corpus contains a lot of reposts: the same post truncated or expanded,
// updated figures ("over 500 developers" -> "about 700 developers"), and the
// same anecdote with the subject swapped. Exact text matching only finds 11 of
// these out of 820, so the check has to be similarity-based.
//
// 0.97 was chosen by inspection. Everything from 0.97 up is a genuine repost.
// By 0.90 it starts merging distinct posts on a shared topic, e.g. "A 4 step
// guide to creating a side project" with "The recipe for an amazing side
// project", which are different posts and should both be kept.
export const DEDUPE_SIMILARITY_THRESHOLD = 0.97;
