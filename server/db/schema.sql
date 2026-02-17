CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION immutable_unaccent(input_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
BEGIN
  RETURN public.unaccent(COALESCE(input_text, ''));
END;
$$;

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

CREATE INDEX IF NOT EXISTS idx_unified_items_title_lower_trgm
  ON unified_items USING GIN (lower(title) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_unified_items_summary_lower_trgm
  ON unified_items USING GIN (lower(summary) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_unified_items_description_lower_trgm
  ON unified_items USING GIN (lower(description) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_unified_items_author_lower_trgm
  ON unified_items USING GIN (lower(author) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_unified_items_native_id_lower_trgm
  ON unified_items USING GIN (lower(native_id) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_unified_items_search_vector
  ON unified_items
  USING GIN (
    (
      setweight(to_tsvector('simple'::regconfig, immutable_unaccent(lower(COALESCE(title, '')))), 'A') ||
      setweight(to_tsvector('simple'::regconfig, immutable_unaccent(lower(COALESCE(summary, '')))), 'B') ||
      setweight(to_tsvector('simple'::regconfig, immutable_unaccent(lower(COALESCE(description, '')))), 'C')
    )
  );

CREATE INDEX IF NOT EXISTS idx_unified_items_search_vector_v2
  ON unified_items
  USING GIN (
    (
      setweight(to_tsvector('simple'::regconfig, immutable_unaccent(lower(COALESCE(title, '')))), 'A') ||
      setweight(to_tsvector('simple'::regconfig, immutable_unaccent(lower(COALESCE(native_id, '')))), 'A') ||
      setweight(to_tsvector('simple'::regconfig, immutable_unaccent(lower(COALESCE(summary, '')))), 'B') ||
      setweight(to_tsvector('simple'::regconfig, immutable_unaccent(lower(COALESCE(author, '')))), 'B') ||
      setweight(to_tsvector('simple'::regconfig, immutable_unaccent(lower(COALESCE(description, '')))), 'C')
    )
  );

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

CREATE TABLE IF NOT EXISTS github_dashboard_history (
  id BIGSERIAL PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  event_type TEXT NOT NULL CHECK (event_type IN ('save', 'rollback', 'import', 'restore')),
  dashboard JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_github_dashboard_history_revision
  ON github_dashboard_history (revision DESC);

CREATE INDEX IF NOT EXISTS idx_github_dashboard_history_created
  ON github_dashboard_history (created_at DESC);

CREATE TABLE IF NOT EXISTS github_summary_jobs (
  id BIGSERIAL PRIMARY KEY,
  repo_id TEXT NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ NULL,
  locked_by TEXT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_summary TEXT NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_github_summary_jobs_status_next
  ON github_summary_jobs (status, next_run_at ASC);

CREATE INDEX IF NOT EXISTS idx_github_summary_jobs_repo_created
  ON github_summary_jobs (repo_id, created_at DESC);

CREATE TABLE IF NOT EXISTS github_summary_cache (
  repo_id TEXT PRIMARY KEY,
  metadata_hash TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_success_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_github_summary_cache_expiry
  ON github_summary_cache (expires_at ASC);

CREATE TABLE IF NOT EXISTS youtube_summary_jobs (
  id BIGSERIAL PRIMARY KEY,
  video_id TEXT NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ NULL,
  locked_by TEXT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_summary TEXT NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_youtube_summary_jobs_status_next
  ON youtube_summary_jobs (status, next_run_at ASC);

CREATE INDEX IF NOT EXISTS idx_youtube_summary_jobs_video_created
  ON youtube_summary_jobs (video_id, created_at DESC);

CREATE TABLE IF NOT EXISTS youtube_summary_cache (
  video_id TEXT PRIMARY KEY,
  metadata_hash TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  notebook_source_id TEXT NULL,
  notebook_id TEXT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_success_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_youtube_summary_cache_expiry
  ON youtube_summary_cache (expires_at ASC);

CREATE TABLE IF NOT EXISTS bookmark_summary_jobs (
  id BIGSERIAL PRIMARY KEY,
  bookmark_id TEXT NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ NULL,
  locked_by TEXT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_summary TEXT NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookmark_summary_jobs_status_next
  ON bookmark_summary_jobs (status, next_run_at ASC);

CREATE INDEX IF NOT EXISTS idx_bookmark_summary_jobs_bookmark_created
  ON bookmark_summary_jobs (bookmark_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bookmark_summary_cache (
  bookmark_id TEXT PRIMARY KEY,
  metadata_hash TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_success_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookmark_summary_cache_expiry
  ON bookmark_summary_cache (expires_at ASC);
