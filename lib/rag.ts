import { OpenAI } from "openai";
import { createClient } from "@supabase/supabase-js";

export const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = process.env.OPENAI_EMBEDDING_DIMENSIONS
  ? Number(process.env.OPENAI_EMBEDDING_DIMENSIONS)
  : null;
export const EMBEDDING_TARGET_DIMENSIONS = Number(process.env.OPENAI_EMBEDDING_TARGET_DIMENSIONS ?? "384");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  { auth: { persistSession: false } }
);

type RetrievedChunk = {
  id: string;
  content: string;
  source: string;
  metadata: Record<string, unknown> | null;
  similarity: number;
};

function metadataString(metadata: Record<string, unknown> | null, key: string): string | null {
  if (!metadata) return null;
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function assertRagEnv() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
}

function normalizeEmbedding(embedding: number[]): number[] {
  const sourceDim = embedding.length;
  const targetDim = EMBEDDING_TARGET_DIMENSIONS;

  if (sourceDim === targetDim) return embedding;

  if (sourceDim > targetDim && sourceDim % targetDim === 0) {
    const ratio = sourceDim / targetDim;
    const normalized = new Array<number>(targetDim).fill(0);
    for (let i = 0; i < targetDim; i += 1) {
      let sum = 0;
      for (let j = 0; j < ratio; j += 1) {
        sum += embedding[i * ratio + j];
      }
      normalized[i] = sum / ratio;
    }
    return normalized;
  }

  if (sourceDim > targetDim) return embedding.slice(0, targetDim);

  const padded = embedding.slice();
  while (padded.length < targetDim) padded.push(0);
  return padded;
}

export function buildChunks(text: string, chunkSize = 1200, overlap = 200): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    const end = Math.min(start + chunkSize, cleaned.length);
    chunks.push(cleaned.slice(start, end));
    if (end >= cleaned.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  assertRagEnv();
  if (texts.length === 0) return [];

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
    ...(EMBEDDING_DIMENSIONS ? { dimensions: EMBEDDING_DIMENSIONS } : {}),
  });

  const embeddings = response.data.map((d) => d.embedding);
  for (const emb of embeddings) {
    if (EMBEDDING_DIMENSIONS && emb.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding dimension mismatch from provider. Expected ${EMBEDDING_DIMENSIONS}, got ${emb.length}.`
      );
    }
  }

  return embeddings.map(normalizeEmbedding);
}

export async function searchRelevantChunks(query: string, matchCount = 6): Promise<RetrievedChunk[]> {
  assertRagEnv();
  const [queryEmbedding] = await embedTexts([query]);
  if (!queryEmbedding) return [];

  const { data, error } = await supabase.rpc("match_documents", {
    query_embedding: queryEmbedding,
    match_count: matchCount,
  });

  if (error) {
    throw error;
  }

  return (data ?? []) as RetrievedChunk[];
}

export function buildRagSystemPrompt(contextChunks: RetrievedChunk[]) {
  if (contextChunks.length === 0) {
    return [
      "You are FTC Assistant.",
      "No external context was retrieved. Answer carefully and state uncertainty when needed.",
    ].join("\n");
  }

  const context = contextChunks
    .map((chunk, i) => {
      const sourceUrl = metadataString(chunk.metadata, "source_url");
      const sourceTitle = metadataString(chunk.metadata, "source_title");
      const header = [
        `[${i + 1}] Source: ${sourceTitle ?? chunk.source}`,
        sourceUrl ? `URL: ${sourceUrl}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      return `${header}\n${chunk.content}`;
    })
    .join("\n\n---\n\n");

  return [
    "You are FTC Assistant. Use the retrieved context below when relevant.",
    "Read every reference note closely before deciding your answer.",
    "Each reference note is a retrieved chunk and may be incomplete or cut mid-sentence/mid-code.",
    "Treat missing lines before/after a chunk as unknown; do not assume omitted content.",
    "If a code sample appears truncated, you may complete it with a best-effort reconstruction.",
    "When you reconstruct missing code, explicitly label what is inferred vs what is directly supported by notes.",
    "Prefer conservative, compilable completions and call out assumptions that affect behavior.",
    "Base conclusions on note evidence, not prior assumptions.",
    "If context is insufficient, say what is missing instead of guessing.",
    "Use these reference notes silently to improve factual accuracy.",
    "Do not mention that these notes exist.",
    "",
    "Reference notes:",
    context,
  ].join("\n");
}
