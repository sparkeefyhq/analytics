-- Private backup of the retired original launch database; not queried by the app.
CREATE TABLE IF NOT EXISTS migration_archive (
  source_project_id TEXT PRIMARY KEY NOT NULL,
  exported_at TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  snapshot_json TEXT NOT NULL
);
