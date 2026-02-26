create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  chunk_index integer not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists documents_source_chunk_idx
  on public.documents (source, chunk_index);

create index if not exists documents_embedding_idx
  on public.documents
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create or replace function public.match_documents (
  query_embedding vector(1536),
  match_count int default 6
)
returns table (
  id uuid,
  source text,
  chunk_index integer,
  content text,
  metadata jsonb,
  similarity float
)
language sql
as $$
  select
    d.id,
    d.source,
    d.chunk_index,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  from public.documents d
  order by d.embedding <=> query_embedding
  limit match_count;
$$;
