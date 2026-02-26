## FTC RAG Chat

This project is a Next.js chat app with Retrieval-Augmented Generation (RAG) using Supabase pgvector.

## Setup

### 1. Configure environment

Copy `.env.example` to `.env` and fill in secrets.

```bash
OPENAI_API_KEY=your_openai_key
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
# Optional, usually leave unset
# OPENAI_EMBEDDING_DIMENSIONS=1536
OPENAI_EMBEDDING_TARGET_DIMENSIONS=384
GEMINI_API_KEY=your_gemini_api_key
GEMINI_PLANNER_MODEL=gemini-2.0-flash-lite
GEMINI_EASY_NONCODE_MODEL=gemini-2.0-flash
GEMINI_EASY_CODE_MODEL=gemini-2.0-flash
GEMINI_HARD_NONCODE_MODEL=gemini-2.5-pro
GEMINI_HARD_CODE_MODEL=gemini-2.5-pro

SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

RAG_MATCH_COUNT=6
RAG_CHUNK_SIZE=1200
RAG_CHUNK_OVERLAP=200
RAG_EMBED_BATCH_SIZE=20
RAG_EMBED_MAX_CHARS=24000
RAG_REQUIRE_SOURCE_URL=true
```

### 2. Create DB objects in Supabase

Run this SQL in Supabase SQL Editor:

- [rag_setup.sql](/Users/yl526/ftcrag/supabase/rag_setup.sql)

### 3. Install deps

```bash
npm install
```

## Document Upload Flow

### 1. Add files to `data/`

Supported file types:
- `.md`
- `.txt`
- `.csv`
- `.json`
- `.pdf` (requires `pdf-parse`, already in `package.json`)
- `.htm` / `.html`

### 2. Map each file to a source URL in `data/sources.json`

Format is `relative/path/from/data` -> `{ title, url }`.

Example:

```json
{
  "manuals/game-manual.md": {
    "title": "FTC Game Manual Part 1",
    "url": "https://www.firstinspires.org/resource-library/ftc/game-and-season-info"
  },
  "qa/official-qa.pdf": {
    "title": "Official Q&A",
    "url": "https://ftc-qa.firstinspires.org/"
  }
}
```

If `RAG_REQUIRE_SOURCE_URL=true`, ingestion fails when a file is missing from `sources.json`.

### 3. Ingest into Supabase vector DB

```bash
npm run rag:ingest
```

What ingestion does:
- reads files in `data/`
- extracts text (including PDF text)
- chunks text
- embeds chunks with OpenAI embeddings
- deletes old rows for each file path
- inserts fresh rows with metadata including `source_url` and `source_title`

### 4. Run app

```bash
npm run dev
```

## RAG Settings Explained

- `OPENAI_EMBEDDING_MODEL`
  - Model used to embed chunks and user query for vector search.
  - SQL currently expects 1536 dimensions (`text-embedding-3-small`).
- `OPENAI_EMBEDDING_DIMENSIONS`
  - Embedding vector length to request from OpenAI.
  - Optional. Leave unset to use provider/model native dimensions.
- `OPENAI_EMBEDDING_TARGET_DIMENSIONS`
  - Final dimension stored/queried in your vector DB after normalization.
  - Set your Supabase vector column and `match_documents` RPC to this value (default `384`).
- `VERTEXAI_KEY`
  - Back-compat alias for API-key mode.
- `GEMINI_API_KEY`
  - API key auth for Gemini Developer API (quickest setup).
- `VERTEX_ACCESS_TOKEN`
  - OAuth token for true Vertex AI endpoint auth.
- `VERTEX_PROJECT_ID`
  - Required with `VERTEX_ACCESS_TOKEN` for Vertex mode.
- `VERTEX_LOCATION`
  - Vertex region (default `us-central1`).
- `GOOGLECREDENTIALS`
  - Base64-encoded Google service account JSON.
  - When set, backend writes it to `/tmp/google-credentials.json`, sets `GOOGLE_APPLICATION_CREDENTIALS`, and mints Vertex access tokens automatically.
  - Use with `VERTEX_PROJECT_ID` (or rely on `project_id` inside credentials JSON).
- `GEMINI_PLANNER_MODEL`
  - Planner model that classifies the task and outputs RAG prompts.
- `GEMINI_EASY_NONCODE_MODEL`
  - Final model when task is easy + non-code.
- `GEMINI_EASY_CODE_MODEL`
  - Final model when task is easy + code.
- `GEMINI_HARD_NONCODE_MODEL`
  - Final model when task is hard + non-code.
- `GEMINI_HARD_CODE_MODEL`
  - Final model when task is hard + code.
- `RAG_MATCH_COUNT`
  - Number of top chunks retrieved per question.
  - Higher = more context, but can add noise.
- `RAG_CHUNK_SIZE`
  - Max characters per chunk before split.
  - Smaller = more precise retrieval; larger = more context per chunk.
- `RAG_CHUNK_OVERLAP`
  - Characters repeated between neighboring chunks.
  - Helps preserve context across boundaries.
- `RAG_EMBED_BATCH_SIZE`
  - How many chunks to embed per OpenAI request.
  - Higher can be faster, but larger requests.
- `RAG_EMBED_MAX_CHARS`
  - Approximate max total characters sent in one embedding request batch.
  - Prevents token-limit errors on large ingestion runs.
- `RAG_REQUIRE_SOURCE_URL`
  - If `true`, every file must have URL metadata in `data/sources.json`.

## MoE Pipeline

1. Save latest user question.
2. Run planner (`GEMINI_PLANNER_MODEL`) to emit JSON:
   - `needsCode`
   - `isHard`
   - `needsConversationContext`
   - `ragQueries[]`
3. Route to model slot:
   - easy + non-code -> `GEMINI_EASY_NONCODE_MODEL`
   - easy + code -> `GEMINI_EASY_CODE_MODEL`
   - hard + non-code -> `GEMINI_HARD_NONCODE_MODEL`
   - hard + code -> `GEMINI_HARD_CODE_MODEL`
4. Run RAG retrieval for all `ragQueries`.
5. Final model answers using retrieved context + conversation context (if flagged).

## Recommended defaults

Current defaults are good to start:
- `RAG_CHUNK_SIZE=1200`
- `RAG_CHUNK_OVERLAP=200`
- `RAG_MATCH_COUNT=6`

If answers are noisy, try:
- `RAG_CHUNK_SIZE=900`
- `RAG_MATCH_COUNT=4`

## Commands

```bash
npm run rag:ingest
npm run dev
npm run lint
```
