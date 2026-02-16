CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS unified_items (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'youtube', 'bookmark')),
  type TEXT NOT NULL CHECK (type IN ('repository', 'video', 'bookmark')),
  native_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  description TEXT NOT NULL,
  url TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  author TEXT NULL,
  language TEXT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unified_items_provider_native_id
  ON unified_items (provider, native_id);

CREATE INDEX IF NOT EXISTS idx_unified_items_provider_updated
  ON unified_items (provider, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_unified_items_type_updated
  ON unified_items (type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_unified_items_status_updated
  ON unified_items (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_unified_items_tags_gin
  ON unified_items USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_unified_items_title_trgm
  ON unified_items USING GIN (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_unified_items_summary_trgm
  ON unified_items USING GIN (summary gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_unified_items_description_trgm
  ON unified_items USING GIN (description gin_trgm_ops);

CREATE TABLE IF NOT EXISTS unified_notes (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'youtube', 'bookmark')),
  item_id TEXT NOT NULL REFERENCES unified_items(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_unified_notes_provider_created
  ON unified_notes (provider, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_unified_notes_item_created
  ON unified_notes (item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS unified_meta (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
