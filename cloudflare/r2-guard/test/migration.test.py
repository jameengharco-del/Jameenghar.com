from pathlib import Path
import sqlite3

migration = Path(__file__).resolve().parents[1] / "migrations" / "0001_storage_quota.sql"
db = sqlite3.connect(":memory:")
db.executescript(migration.read_text())

# The D1 migration must create the quota, reservation and payment idempotency ledgers.
tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
assert {"storage_objects", "upload_reservations", "payment_orders", "payment_webhook_events"} <= tables

# Exact file fingerprints are unique within one property for photos.
db.execute("INSERT INTO storage_objects(object_key,owner_uid,property_id,object_kind,byte_size,content_sha256) VALUES(?,?,?,?,?,?)",
           ("k1", "u1", "properties/p1", "photo", 123, "a" * 64))
try:
    db.execute("INSERT INTO storage_objects(object_key,owner_uid,property_id,object_kind,byte_size,content_sha256) VALUES(?,?,?,?,?,?)",
               ("k2", "u1", "properties/p1", "photo", 123, "a" * 64))
    raise AssertionError("duplicate photo fingerprint unexpectedly accepted")
except sqlite3.IntegrityError:
    pass

# The same photo bytes may be used on a different property.
db.execute("INSERT INTO storage_objects(object_key,owner_uid,property_id,object_kind,byte_size,content_sha256) VALUES(?,?,?,?,?,?)",
           ("k3", "u1", "properties/p2", "photo", 123, "a" * 64))

# Payment order idempotency is unique per booking and quote version.
db.execute("INSERT INTO payment_orders(idempotency_key,booking_id,quote_version,amount_paise,currency,guest_token_hash,state) VALUES(?,?,?,?,?,?,?)",
           ("b1:q1", "b1", 1, 10000, "INR", "a" * 64, "creating"))
try:
    db.execute("INSERT INTO payment_orders(idempotency_key,booking_id,quote_version,amount_paise,currency,guest_token_hash,state) VALUES(?,?,?,?,?,?,?)",
               ("b1:q1-retry", "b1", 1, 10000, "INR", "a" * 64, "creating"))
    raise AssertionError("duplicate booking quote unexpectedly accepted")
except sqlite3.IntegrityError:
    pass

print("D1 SQLite migration checks passed: quota schema, photo hash uniqueness, payment idempotency.")
