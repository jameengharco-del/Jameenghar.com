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
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
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


-- Idempotency ledger for Daybnb payment orders. Unique booking+quote prevents
-- concurrent clicks/retries from creating duplicate provider orders.
CREATE TABLE IF NOT EXISTS payment_orders (
  idempotency_key TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  quote_version INTEGER NOT NULL CHECK (quote_version > 0),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  currency TEXT NOT NULL CHECK (currency = 'INR'),
  guest_token_hash TEXT NOT NULL,
  provider_order_id TEXT UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('creating','created','paid','failed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (booking_id, quote_version)
);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  provider_event_id TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_booking ON payment_orders(booking_id);
