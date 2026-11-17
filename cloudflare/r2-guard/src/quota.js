/**
 * Atomic 9 GB application quota for the private R2 bucket.
 *
 * IMPORTANT:
 * - This module is not a Cloudflare billing hard cap.
 * - Every R2 write must reserve bytes here before bucket.put().
 * - Never expose the bucket publicly or write to it outside this Worker.
 * - D1 batch() executes the statements as one transaction.
 */
export const HARD_STOP_BYTES = 9 * 1000 * 1000 * 1000; // 9.00 decimal GB
export const WARNING_BYTES = 8 * 1000 * 1000 * 1000;  // 8.00 decimal GB
export const MAX_OBJECT_BYTES = 20 * 1000 * 1000;     // 20 MB per object

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
    storedBytes,
    reservedBytes,
    totalBytes,
    warning: totalBytes >= WARNING_BYTES,
    uploadsAllowed: totalBytes < HARD_STOP_BYTES
  };
}

/**
 * Atomically reserves capacity. Concurrent requests cannot all pass based on
 * the same stale count: the conditional INSERT is serialized by SQLite/D1.
 * Returns false when the quota would reach or exceed 9 GB.
 */
export async function reserveUpload(db, {
  reservationId, ownerUid, propertyId, objectKind, byteSize
}) {
  if (!reservationId || !ownerUid || !propertyId) throw new Error("Missing reservation identity");
  if (!["photo", "document"].includes(objectKind)) throw new Error("Invalid object kind");
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > MAX_OBJECT_BYTES) {
    throw new Error("File size is outside the allowed limit");
  }

  const result = await db.prepare(`
    INSERT INTO upload_reservations
      (reservation_id, owner_uid, property_id, object_kind, byte_size)
    SELECT ?, ?, ?, ?, ?
    WHERE
      (SELECT COALESCE(SUM(byte_size), 0) FROM storage_objects)
      + (SELECT COALESCE(SUM(byte_size), 0) FROM upload_reservations)
      + ? < ?
  `).bind(
    reservationId, ownerUid, propertyId, objectKind, byteSize,
    byteSize, HARD_STOP_BYTES
  ).run();

  return Number(result?.meta?.changes || 0) === 1;
}

/**
 * Finalize only after R2.put() succeeds. A failed DB finalize leaves the
 * reservation in place (fail-closed); reconcile it rather than freeing bytes
 * blindly because the object may already exist in R2.
 */
export async function commitUpload(db, {
  reservationId, objectKey
}) {
  if (!reservationId || !objectKey) throw new Error("Missing commit identity");

  const reservation = await db.prepare(`
    SELECT owner_uid, property_id, object_kind, byte_size
    FROM upload_reservations WHERE reservation_id = ?
  `).bind(reservationId).first();

  if (!reservation) throw new Error("Reservation not found");

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
    throw new Error("Could not finalize upload; reservation retained if transaction rolled back");
  }
  return true;
}

/** Release only when R2.put() definitely failed before creating an object. */
export async function releaseFailedUpload(db, reservationId) {
  if (!reservationId) throw new Error("Missing reservation identity");
  return db.prepare("DELETE FROM upload_reservations WHERE reservation_id = ?")
    .bind(reservationId).run();
}

/**
 * Delete metadata only after the R2 object deletion has succeeded.
 * A failed metadata delete conservatively over-counts storage, never undercounts.
 */
export async function forgetDeletedObject(db, objectKey) {
  if (!objectKey) throw new Error("Missing object key");
  return db.prepare("DELETE FROM storage_objects WHERE object_key = ?")
    .bind(objectKey).run();
}
