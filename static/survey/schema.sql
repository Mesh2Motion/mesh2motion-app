CREATE TABLE IF NOT EXISTS responses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT    NOT NULL,
  question  TEXT    NOT NULL,
  answer  TEXT    NOT NULL,
  submitted_at TEXT   NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS animation_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  rig_type     TEXT    NOT NULL,
  description  TEXT    NOT NULL,
  submitted_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
