-- Phase 1 schema. The `records` table is FROZEN once seeded.

CREATE TABLE IF NOT EXISTS records (
  id            INTEGER PRIMARY KEY,
  artist        TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  year          INTEGER,
  genres        TEXT    NOT NULL,
  styles        TEXT    NOT NULL,
  format        TEXT,
  vinyl_color   TEXT,
  cover_image   TEXT    NOT NULL,
  thumbnail     TEXT    NOT NULL,
  discogs_url   TEXT,
  rating        INTEGER,
  date_added    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS extensions (
  id                   TEXT PRIMARY KEY,
  title                TEXT NOT NULL,
  prompt               TEXT NOT NULL,
  status               TEXT NOT NULL,
  category             TEXT,
  reason               TEXT,
  artifact_ref         TEXT,
  last_commit_sha      TEXT,
  last_commit_message  TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
  id           TEXT PRIMARY KEY,
  prompt       TEXT NOT NULL,
  extension_id TEXT,
  status       TEXT NOT NULL,
  reason       TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_extensions_status ON extensions(status);
CREATE INDEX IF NOT EXISTS idx_extensions_created_at ON extensions(created_at DESC);
