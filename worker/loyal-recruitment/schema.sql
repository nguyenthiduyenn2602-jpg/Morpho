CREATE TABLE IF NOT EXISTS recruit_candidates (
  qq               TEXT    PRIMARY KEY,
  submitted_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recruit_submitted
  ON recruit_candidates(submitted_at);

CREATE TABLE IF NOT EXISTS recruit_ratelimit (
  bucket   TEXT    PRIMARY KEY,
  count    INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
