-- JameenGhar R2 Guard quota ledger (D1)
-- Apply only to a NEW, dedicated D1 database on the safe rollout.
-- Never point this at an existing production database.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS storage_objects (
  object_key TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  property_id TEXT NOT NULL,
  object_kind TEXT NOT NULL CHECK (object_kind IN ('photo','document')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS upload_reservations (
  reservation_id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  owner_uid TEXT NOT NULL,
  property_id TEXT NOT NULL,
  object_kind TEXT NOT NULL CHECK (object_kind IN ('photo','document')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_storage_objects_owner ON storage_objects(owner_uid);
CREATE INDEX IF NOT EXISTS idx_storage_objects_property ON storage_objects(property_id);
CREATE INDEX IF NOT EXISTS idx_upload_reservations_created ON upload_reservations(created_at);
