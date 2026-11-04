-- Recreate only short-lived admission state after a durable-table SQL restore.
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
