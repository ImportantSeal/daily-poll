CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  question TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published'))
);

CREATE TABLE IF NOT EXISTS aggregates (
  question_id TEXT NOT NULL,
  segment TEXT NOT NULL,
  count_a INTEGER NOT NULL DEFAULT 0,
  count_b INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (question_id, segment),
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dedupe_votes (
  question_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  country TEXT,
  device_type TEXT,
  PRIMARY KEY (question_id, dedupe_key),
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_questions_status_date
  ON questions(status, date DESC);

CREATE INDEX IF NOT EXISTS idx_dedupe_votes_created_at
  ON dedupe_votes(created_at);
