import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import process from "node:process";
import { OpenAI } from "openai";
import { createClient } from "@supabase/supabase-js";

const DATA_DIR = path.resolve(process.cwd(), "data");
const SOURCES_MANIFEST_PATH = path.join(DATA_DIR, "sources.json");
const SUPPORTED_EXTENSIONS = new Set([".md", ".txt", ".csv", ".json", ".pdf", ".htm", ".html"]);

function loadEnvFile(filePath) {
  if (!fsSync.existsSync(filePath)) return;
  const raw = fsSync.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Ingestion should be deterministic from repo-local env files.
    process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = process.env.OPENAI_EMBEDDING_DIMENSIONS
  ? Number(process.env.OPENAI_EMBEDDING_DIMENSIONS)
  : null;
const EMBEDDING_TARGET_DIMENSIONS = Number(process.env.OPENAI_EMBEDDING_TARGET_DIMENSIONS ?? "384");
const CHUNK_SIZE = Number(process.env.RAG_CHUNK_SIZE ?? "1200");
const CHUNK_OVERLAP = Number(process.env.RAG_CHUNK_OVERLAP ?? "200");
const BATCH_SIZE = Number(process.env.RAG_EMBED_BATCH_SIZE ?? "20");
const EMBED_MAX_CHARS_PER_REQUEST = Number(process.env.RAG_EMBED_MAX_CHARS ?? "24000");
const REQUIRE_SOURCE_URL = (process.env.RAG_REQUIRE_SOURCE_URL ?? "true").toLowerCase() !== "false";

function assertEnv() {
  const missing = [];
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (!process.env.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return listFiles(fullPath);
      return fullPath;
    })
  );
  return files.flat();
}

function normalizeRelativePath(filePath) {
  return filePath.split(path.sep).join("/");
}

async function loadSourcesManifest() {
  try {
    const raw = await fs.readFile(SOURCES_MANIFEST_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("sources.json must be a JSON object keyed by relative file path.");
    }
    return parsed;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      if (REQUIRE_SOURCE_URL) {
        throw new Error(
          `Missing data/sources.json. Create it to map each file to a canonical URL.`
        );
      }
      return {};
    }
    throw error;
  }
}

function buildChunks(text) {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];

  const chunks = [];
  let start = 0;
  while (start < cleaned.length) {
    const end = Math.min(start + CHUNK_SIZE, cleaned.length);
    chunks.push(cleaned.slice(start, end));
    if (end >= cleaned.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP);
  }
  return chunks;
}

function normalizeEmbedding(embedding) {
  const sourceDim = embedding.length;
  const targetDim = EMBEDDING_TARGET_DIMENSIONS;

  if (sourceDim === targetDim) return embedding;

  // If source is an integer multiple of target, average buckets.
  if (sourceDim > targetDim && sourceDim % targetDim === 0) {
    const ratio = sourceDim / targetDim;
    const normalized = new Array(targetDim).fill(0);
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

async function embedTexts(texts, openai) {
  if (texts.length === 0) return [];
  const allEmbeddings = [];

  // Batch by both count and approximate token budget (via char count).
  let i = 0;
  while (i < texts.length) {
    const batch = [];
    let batchChars = 0;
    while (i < texts.length && batch.length < BATCH_SIZE) {
      const next = texts[i];
      const nextChars = next.length;

      if (batch.length > 0 && batchChars + nextChars > EMBED_MAX_CHARS_PER_REQUEST) {
        break;
      }

      batch.push(next);
      batchChars += nextChars;
      i += 1;
    }

    // Ensure forward progress even if a single item exceeds char budget.
    if (batch.length === 0) {
      batch.push(texts[i]);
      i += 1;
    }

    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
      ...(EMBEDDING_DIMENSIONS ? { dimensions: EMBEDDING_DIMENSIONS } : {}),
    });
    const rawEmbeddings = response.data.map((row) => row.embedding);
    if (rawEmbeddings.length > 0 && !EMBEDDING_DIMENSIONS) {
      console.log(`Embedding dimension detected: ${rawEmbeddings[0].length} (model=${EMBEDDING_MODEL})`);
    }
    for (const emb of rawEmbeddings) {
      if (EMBEDDING_DIMENSIONS && emb.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Embedding dimension mismatch from provider. Expected ${EMBEDDING_DIMENSIONS}, got ${emb.length}. ` +
            `Model=${EMBEDDING_MODEL}. Align DB vector size + RPC with actual output, or fix provider/model config.`
        );
      }
    }
    allEmbeddings.push(...rawEmbeddings.map(normalizeEmbedding));
  }

  return allEmbeddings;
}

async function extractText(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".pdf") {
    let pdfParse;
    try {
      const mod = await import("pdf-parse");
      pdfParse = mod.default ?? mod;
    } catch {
      throw new Error(
        "PDF support requires `pdf-parse`. Run `npm install pdf-parse` and retry."
      );
    }
    const buffer = await fs.readFile(filePath);
    const parsed = await pdfParse(buffer);
    return parsed?.text ?? "";
  }

  if (extension === ".htm" || extension === ".html") {
    const html = await fs.readFile(filePath, "utf8");
    return htmlToText(html);
  }

  return fs.readFile(filePath, "utf8");
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function getSourceInfo(relativePath, manifest) {
  const normalized = normalizeRelativePath(relativePath);
  const sourceInfo = manifest[normalized];
  if (!sourceInfo || typeof sourceInfo !== "object") {
    if (REQUIRE_SOURCE_URL) {
      throw new Error(
        `Missing source entry for "${normalized}" in data/sources.json.`
      );
    }
    return {
      sourceUrl: null,
      sourceTitle: normalized,
    };
  }

  const sourceUrl = typeof sourceInfo.url === "string" ? sourceInfo.url.trim() : "";
  const sourceTitle =
    typeof sourceInfo.title === "string" && sourceInfo.title.trim().length > 0
      ? sourceInfo.title.trim()
      : normalized;

  if (!sourceUrl && REQUIRE_SOURCE_URL) {
    throw new Error(`Missing URL for "${normalized}" in data/sources.json.`);
  }

  return {
    sourceUrl: sourceUrl || null,
    sourceTitle,
  };
}

async function ingestFile(filePath, manifest, { openai, supabase }) {
  const relativePath = normalizeRelativePath(path.relative(DATA_DIR, filePath));
  let content = await extractText(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const { sourceUrl, sourceTitle } = getSourceInfo(relativePath, manifest);
  let chunks = buildChunks(content);

  if (chunks.length === 0 && extension === ".pdf") {
    const base = filePath.slice(0, -path.extname(filePath).length);
    const fallbackCandidates = [`${base}.htm`, `${base}.html`];
    for (const fallbackPath of fallbackCandidates) {
      try {
        await fs.access(fallbackPath);
        content = await extractText(fallbackPath);
        chunks = buildChunks(content);
        if (chunks.length > 0) {
          console.log(
            `PDF extraction empty for ${relativePath}; using fallback ${path.basename(fallbackPath)} text.`
          );
          break;
        }
      } catch {
        // no fallback file at this path
      }
    }
  }

  if (chunks.length === 0) {
    console.log(`Skipping ${relativePath} (no content)`);
    return { source: relativePath, chunkCount: 0 };
  }

  const embeddings = await embedTexts(chunks, openai);
  const rows = chunks.map((chunk, index) => ({
    source: relativePath,
    content: chunk,
    chunk_index: index,
    metadata: {
      source: relativePath,
      source_url: sourceUrl,
      source_title: sourceTitle,
      chunk_index: index,
    },
    embedding: embeddings[index],
  }));

  const { error: deleteError } = await supabase.from("documents").delete().eq("source", relativePath);
  if (deleteError) throw deleteError;

  const { error: insertError } = await supabase.from("documents").insert(rows);
  if (insertError) throw insertError;

  console.log(`Ingested ${relativePath} (${chunks.length} chunks) -> ${sourceUrl ?? "no-url"}`);
  return { source: relativePath, chunkCount: chunks.length };
}

async function main() {
  assertEnv();
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const supabase = createClient(
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } }
  );

  try {
    await fs.access(DATA_DIR);
  } catch {
    console.log(`No data directory found at ${DATA_DIR}. Create it and add docs first.`);
    return;
  }

  const manifest = await loadSourcesManifest();
  const allFiles = await listFiles(DATA_DIR);
  const files = allFiles.filter((file) => {
    const extension = path.extname(file).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) return false;
    if (path.resolve(file) === path.resolve(SOURCES_MANIFEST_PATH)) return false;
    return true;
  });

  if (files.length === 0) {
    console.log("No supported files found in data/. Add .md, .txt, .csv, .json, or .pdf files.");
    return;
  }

  let totalChunks = 0;
  for (const file of files) {
    const { chunkCount } = await ingestFile(file, manifest, { openai, supabase });
    totalChunks += chunkCount;
  }

  console.log(`Done. Ingested ${files.length} files and ${totalChunks} chunks.`);
}

main().catch((error) => {
  console.error("Ingestion failed:", error);
  process.exit(1);
});
