/**
 * Atomic 9 GB application quota for the private R2 bucket.
 * Every R2 write must reserve bytes before bucket.put(). Any uncertain R2
 * outcome keeps its reservation until an inventory reconciliation proves
 * whether the object exists. This is not a Cloudflare billing hard cap.
 */
export const HARD_STOP_BYTES = 9 * 1000 * 1000 * 1000;
export const WARNING_BYTES = 8 * 1000 * 1000 * 1000;
export const MAX_OBJECT_BYTES = 20 * 1000 * 1000;

const quotaUsageSql = `
  SELECT
    COALESCE((SELECT SUM(byte_size) FROM storage_objects), 0) AS stored_bytes,
    COALESCE((SELECT SUM(byte_size) FROM upload_reservations), 0) AS reserved_bytes
`;

export async function readQuota(db) {
  const row = await db.prepare(quotaUsageSql).first();
  const storedBytes = Number(row?.stored_bytes || 0);
  const reservedBytes = Number(row?.reserved_bytes || 0);
  const totalBytes = storedBytes + reservedBytes;
  return {
    storedBytes, reservedBytes, totalBytes,
    warning: totalBytes >= WARNING_BYTES,
    uploadsAllowed: totalBytes < HARD_STOP_BYTES
  };
}

function propertyLimit(kind) { return kind === "photo" ? 10 : 1; }

export async function reserveUpload(db, {
  reservationId, objectKey, ownerUid, propertyId, objectKind, byteSize
}) {
  if (!reservationId || !objectKey || !ownerUid || !propertyId) throw new Error("Missing reservation identity");
  if (!["photo", "document"].includes(objectKind)) throw new Error("Invalid object kind");
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > MAX_OBJECT_BYTES) {
    throw new Error("File size is outside the allowed limit");
  }

  const result = await db.prepare(`
    INSERT INTO upload_reservations
      (reservation_id, object_key, owner_uid, property_id, object_kind, byte_size)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE
      (SELECT COALESCE(SUM(byte_size), 0) FROM storage_objects)
      + (SELECT COALESCE(SUM(byte_size), 0) FROM upload_reservations)
      + ? < ?
      AND (
        SELECT COUNT(*) FROM storage_objects
        WHERE property_id = ? AND object_kind = ?
      ) + (
        SELECT COUNT(*) FROM upload_reservations
        WHERE property_id = ? AND object_kind = ?
      ) < ?
  `).bind(
    reservationId, objectKey, ownerUid, propertyId, objectKind, byteSize,
    byteSize, HARD_STOP_BYTES,
    propertyId, objectKind,
    propertyId, objectKind, propertyLimit(objectKind)
  ).run();

  return Number(result?.meta?.changes || 0) === 1;
}

export async function commitUpload(db, { reservationId, objectKey }) {
  if (!reservationId || !objectKey) throw new Error("Missing commit identity");
  const reservation = await db.prepare(`
    SELECT object_key, owner_uid, property_id, object_kind, byte_size
    FROM upload_reservations WHERE reservation_id = ?
  `).bind(reservationId).first();

  if (!reservation) throw new Error("Reservation not found");
  if (reservation.object_key !== objectKey) throw new Error("Reservation object key mismatch");

  const results = await db.batch([
    db.prepare(`
      INSERT INTO storage_objects
        (object_key, owner_uid, property_id, object_kind, byte_size)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      objectKey, reservation.owner_uid, reservation.property_id,
      reservation.object_kind, reservation.byte_size
    ),
    db.prepare("DELETE FROM upload_reservations WHERE reservation_id = ?")
      .bind(reservationId)
  ]);
  if (!results?.[0]?.success || !results?.[1]?.success) {
    throw new Error("Could not finalize upload; reservation must be reconciled");
  }
  return true;
}

/**
 * Do not release a reservation merely because R2.put threw: the outcome can
 * be ambiguous (e.g. response lost after object creation). Keep it charged
 * against quota until reconciliation verifies object presence/absence.
 */
export async function forgetDeletedObject(db, objectKey) {
  if (!objectKey) throw new Error("Missing object key");
  return db.prepare("DELETE FROM storage_objects WHERE object_key = ?").bind(objectKey).run();
}
