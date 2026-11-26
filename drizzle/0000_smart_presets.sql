CREATE TABLE smart_presets (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT COLLATE NOCASE NOT NULL,
  settings TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, id),
  UNIQUE (owner_id, name)
);
