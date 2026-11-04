CREATE TABLE comment_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  accepting INTEGER NOT NULL DEFAULT 0 CHECK (accepting IN (0, 1)),
  daily_limit INTEGER NOT NULL DEFAULT 100 CHECK (daily_limit BETWEEN 1 AND 10000),
  pending_limit INTEGER NOT NULL DEFAULT 200 CHECK (pending_limit BETWEEN 1 AND 10000),
  source_window_limit INTEGER NOT NULL DEFAULT 3 CHECK (source_window_limit BETWEEN 1 AND 100),
  source_daily_limit INTEGER NOT NULL DEFAULT 10 CHECK (source_daily_limit BETWEEN 1 AND 1000),
  last_cleanup INTEGER,
  last_backup INTEGER,
  backup_key TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO comment_settings (id) VALUES (1);

CREATE TABLE comment_posts (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  accepting INTEGER NOT NULL DEFAULT 1 CHECK (accepting IN (0, 1))
);
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES comment_posts(id),
  parent_id TEXT REFERENCES comments(id),
  author TEXT NOT NULL CHECK (length(author) BETWEEN 1 AND 80),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  moderated_at INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'spam')),
  is_owner INTEGER NOT NULL DEFAULT 0 CHECK (is_owner IN (0, 1))
);
CREATE INDEX comments_public ON comments(post_id, status, created_at, id);
CREATE INDEX comments_queue ON comments(status, created_at);
CREATE TABLE comment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX comment_events_date ON comment_events(created_at);

-- Transient records deliberately have no FK to comments: deleting spam must not
-- replenish the source/day allowance. These tables are excluded from backups.
CREATE TABLE comment_admissions (
  request_id TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX admissions_source ON comment_admissions(source_hash, created_at);
CREATE INDEX admissions_day ON comment_admissions(created_at);
CREATE INDEX admissions_duplicate ON comment_admissions(post_id, source_hash, body_hash, created_at);

-- SQLite serializes writes. Admission and comment insertion run in one D1 batch;
-- RAISE(ABORT) rolls the batch back, including a preceding post upsert.
CREATE TRIGGER comment_admit BEFORE INSERT ON comment_admissions BEGIN
  SELECT CASE WHEN (SELECT accepting FROM comment_settings WHERE id = 1) != 1
    THEN RAISE(ABORT, 'COMMENTS_PAUSED') END;
  SELECT CASE WHEN COALESCE((SELECT accepting FROM comment_posts WHERE id = NEW.post_id), 0) != 1
    THEN RAISE(ABORT, 'POST_CLOSED') END;
  SELECT CASE WHEN (SELECT count(*) FROM comments WHERE status = 'pending') >=
    (SELECT pending_limit FROM comment_settings WHERE id = 1)
    THEN RAISE(ABORT, 'QUEUE_FULL') END;
  SELECT CASE WHEN (SELECT count(*) FROM comment_admissions WHERE created_at >= NEW.created_at - (NEW.created_at % 86400)) >=
    (SELECT daily_limit FROM comment_settings WHERE id = 1)
    THEN RAISE(ABORT, 'DAILY_LIMIT') END;
  SELECT CASE WHEN (SELECT count(*) FROM comment_admissions WHERE source_hash = NEW.source_hash AND created_at >= NEW.created_at - 600) >=
    (SELECT source_window_limit FROM comment_settings WHERE id = 1)
    THEN RAISE(ABORT, 'SOURCE_LIMIT') END;
  SELECT CASE WHEN (SELECT count(*) FROM comment_admissions WHERE source_hash = NEW.source_hash AND created_at >= NEW.created_at - (NEW.created_at % 86400)) >=
    (SELECT source_daily_limit FROM comment_settings WHERE id = 1)
    THEN RAISE(ABORT, 'SOURCE_LIMIT') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM comment_admissions WHERE post_id = NEW.post_id AND source_hash = NEW.source_hash AND body_hash = NEW.body_hash AND created_at >= NEW.created_at - 600)
    THEN RAISE(ABORT, 'DUPLICATE_COMMENT') END;
END;
