# Cringe Influencer RAG

This is my go at [Brian Jenney's](https://github.com/projectshft) Cringe Influencer RAG tutorial, forked from [projectshft/cringe-influencer](https://github.com/projectshft/cringe-influencer). The original build, the walkthrough video, and the data are all his; I'm tinkering on top of it. Everything below is his write-up unless noted otherwise.

A Next.js application that uses RAG (Retrieval Augmented Generation) to search through LinkedIn posts, create embeddings, and generate content in an authentic voice.

[Live Walkthrough Video](https://share.descript.com/view/JNWta1T8TKX)

## ⚠️ Where this differs from the original

Everything below is a change from [projectshft/cringe-influencer](https://github.com/projectshft/cringe-influencer).
Pinecone is the one piece that's unchanged — it still stores the vectors and
provides the reranking model, and still needs an API key.

### 1. Embeddings run locally, not on OpenAI

**The original uses OpenAI for embeddings. This fork runs `nomic-embed-text`
locally through [Ollama](https://ollama.com) instead.**

-   **No OpenAI API key, and no cost per query.** Embedding runs on your own
    machine.
-   **You must have Ollama installed and the model pulled** on whatever machine
    runs this, including wherever you deploy it. There is no hosted fallback —
    if Ollama isn't reachable, search fails with an error telling you so.
-   **Vectors are 768-dimensional**, not 1536. `nomic-embed-text` has a fixed
    output size, so the Pinecone index must be created at 768.
-   **The vectors in `output/` were regenerated.** They are not the ones from
    the original repo, which were OpenAI's.
-   nomic's `search_query:` / `search_document:` task prefixes are applied
    inside `libs/ollama.ts` so call sites can't forget them.

### 2. The corpus is deduplicated

The source CSV contains a lot of reposted content — the same post truncated or
expanded, figures updated between postings ("over 500 developers" → "about 700
developers"), and the same anecdote with the subject swapped. Duplicates crowd
each other out of the results, so `yarn embed` now drops near-duplicates at
cosine ≥ 0.97 (`DEDUPE_SIMILARITY_THRESHOLD` in `libs/config.ts`), keeping the
highest-impression copy of each.

Exact text matching only finds 11 of these out of 820, so the check has to be
similarity-based. The threshold was picked by inspection: everything from 0.97
up is a genuine repost, while by 0.90 it starts merging distinct posts on a
shared topic. At 0.97 this drops **101 posts, leaving 719**.

The effect is visible in results. Searching "hiring junior engineers" used to
return the same "Junior developers are inherently risky" post three times in
the top five; now it appears once and the freed slots hold different posts.

`data/brian_posts.csv` is left untouched — dedup happens in the pipeline, so
changing the threshold only means re-running `yarn embed`.

### 3. Bugs fixed from the original

These were all present in the upstream repo:

-   **Search could never return anything.** Queries embedded at 512 dimensions
    while the shipped vectors were 1536, so Pinecone rejected every query on
    dimension mismatch.
-   **The index name was hardcoded** to `'brian-clone'` in all four query
    paths, so setting `PINECONE_INDEX_NAME` only affected the upload script.
-   **`yarn embed` couldn't run.** It pointed at
    `../mini_rag/app/data/brian_posts.csv`, a path that only existed on the
    original author's machine. The file ships here as `data/brian_posts.csv`.
-   **Custom theme colours silently didn't work.** Tailwind v4 is CSS-first and
    doesn't auto-load `tailwind.config.js`, so `@apply text-craigslist-blue`
    failed and links rendered unstyled. Moved to a `@theme` block.

### 4. Housekeeping

-   **Dependencies patched.** `yarn audit` went from 2 critical and 27 high
    advisories to zero, including an RCE in Next.js. (Sent upstream as a PR.)
-   **All TypeScript.** The libs existed as parallel `.ts` and `.js` copies;
    Next resolved the `.js` one while `tsc` resolved the `.ts` one, so the file
    being typechecked was never the file that ran. The `.js` copies are gone and
    the scripts run as `.ts` under Node's native type stripping.

## 🚀 Quick Start

### Prerequisites

-   Node.js (v22+)
-   Yarn package manager
-   [Ollama](https://ollama.com) installed and running, with `nomic-embed-text`
    pulled (see Step 4)
-   Pinecone account (free tier available)

### Step 1: Clone and Install

```bash
git clone https://github.com/branchwag/cringe-influencer.git
cd cringe-influencer
yarn install --frozen-lockfile
```

### Step 2: Set Up Environment Variables

Create a `.env` file in the project root:

```bash
# Required for vector database
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX_NAME=your_index_name

# Optional. Defaults to http://localhost:11434 if unset.
# OLLAMA_HOST=http://localhost:11434
```

No OpenAI key is needed — embeddings run locally.

### Step 3: Set Up Pinecone (Free Tier)

1. Sign up at [Pinecone](https://www.pinecone.io/) (free tier includes 1 index)
2. Copy your API key from the Pinecone console into your `.env`
3. Pick an index name and set it as `PINECONE_INDEX_NAME` in your `.env`

**Do not create the index in the Pinecone console.** Stop after setting those
two values — `yarn upload` (Step 5) creates the index for you, reading the
dimension straight from the vector file so it can't be set wrong.

> **Why this matters.** Pinecone's "Create a new index" screen leads with cards
> for embedding models (`text-embedding-3-small`, `llama-text-embed-v2`, and so
> on). Those create an index with **integrated embedding**, where you send
> Pinecone raw text and it embeds server-side with that model. This project
> doesn't work that way — it embeds locally with `nomic-embed-text` and uploads
> finished 768d vectors. Picking a model card puts a hosted embedding model back
> in the loop and won't match your vectors.
>
> The failure is also quiet: if an index already exists with the wrong
> dimension, the upload script warns and stops rather than fixing it, so the
> mismatch surfaces at upload time rather than at creation.

<details>
<summary>If you really do want to create it by hand</summary>

Choose **Manual configuration** — not any of the embedding-model cards — and
set:

-   **Dimensions**: 768 (the vectors in `output/` are 768d)
-   **Metric**: cosine
-   **Cloud**: any region (e.g. aws/us-east-1)

The name must match `PINECONE_INDEX_NAME` exactly.

</details>

### Step 4: Set Up Ollama

This replaces the original's OpenAI step. Nothing here costs money and no API
key is involved.

1. Install Ollama from [ollama.com/download](https://ollama.com/download)
2. Pull the embedding model:

    ```bash
    ollama pull nomic-embed-text
    ```

3. Make sure Ollama is serving. It usually starts on its own after install; if
   not, run `ollama serve`. Confirm it's up:

    ```bash
    curl http://localhost:11434/api/tags
    ```

**Deploying?** Ollama has to be installed, running, and reachable on whatever
machine serves the app — it is not bundled. If Ollama lives on a different host
than the app, point `OLLAMA_HOST` at it. Note this rules out platforms where you
can't run a background service alongside the app, so a plain Vercel deploy won't
work without hosting Ollama separately.

### Step 5: Upload Vectors to Pinecone

```bash
yarn upload
```

This creates the index named by `PINECONE_INDEX_NAME` if it doesn't exist yet —
at dimension 768, metric `cosine`, serverless on `aws/us-east-1` — then uploads
the vectors from `output/brian_posts_vectors.json` into it.

If an index by that name already exists with a different dimension, the script
warns and stops without uploading. Delete it in the console and re-run (the free
tier allows one index, so you may need to clear an old one anyway).

### Step 6: Run the Application

```bash
yarn dev
```

Visit [http://localhost:3000](http://localhost:3000) to use the application.

## 🔍 Using the Application

1. Enter a search query in the text area (e.g., "AI startup advice")
2. Click the SEARCH button
3. View results from both basic vector search and re-ranked results
4. Compare how the re-ranking improves search relevance

## 📁 Project Structure

-   `app/` - Next.js application files
    -   `api/` - API routes for search and re-ranking
    -   `components/` - React components
-   `data/` - Source data files
-   `libs/` - Utility libraries for Ollama embeddings and Pinecone
-   `scripts/` - Scripts for embedding and uploading vectors
-   `output/` - Generated vector files

## 🛠️ Available Scripts

-   `yarn dev` - Start development server
-   `yarn build` - Build for production
-   `yarn start` - Start production server
-   `yarn embed` - Generate embeddings from source data
-   `yarn upload` - Upload vectors to Pinecone

## 📚 Learning Resources

For those interested in the technology behind this application:

-   [Essence of Linear Algebra](https://www.youtube.com/playlist?list=PLZHQObOWTQDPD3MizzM2xVFitgF8hE_ab) - Visual introduction to vectors
-   [Neural Networks](https://www.youtube.com/playlist?list=PLZHQObOWTQDNU6R1_67000Dx_ZCJB-3pi) - How neural networks work
-   [Transformers, explained](https://www.youtube.com/watch?v=SZorAJ4I-sA) - Understanding the transformer architecture

## Join Parsity.io if you want to learn the skills to create production-grade full stack AI applications.
