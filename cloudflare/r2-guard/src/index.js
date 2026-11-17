import { verifyFirebaseIdToken, authorizeOwnerAndProperty } from "./auth.js";
import {
  readQuota, reserveUpload, commitUpload, releaseFailedUpload,
  MAX_OBJECT_BYTES
} from "./quota.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  }
});

const safeEqual = (a, b) => typeof a === "string" && typeof b === "string" && a === b;

function bearer(request) {
  const value = request.headers.get("authorization") || "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Sign in is required");
  return match[1];
}

function allowedType(kind, contentType) {
  if (kind === "photo") return ["image/jpeg", "image/png", "image/webp"].includes(contentType);
  if (kind === "document") return contentType === "application/pdf";
  return false;
}

function hasValidMagic(kind, bytes, contentType) {
  const b = new Uint8Array(bytes);
  if (kind === "document") {
    return b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 &&
      b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;
  }
  if (contentType === "image/jpeg") return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (contentType === "image/png") return b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;
  if (contentType === "image/webp") return b.length >= 12 &&
    String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.slice(8, 12)) === "WEBP";
  return false;
}

async function authenticate(request, env) {
  const token = bearer(request);
  const claims = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
  return { token, claims };
}

async function upload(request, url, env) {
  if (!env.STORAGE || !env.QUOTA_DB || !env.FIREBASE_PROJECT_ID || !env.OWNER_ADMIN_UID) {
    return json({ error: "Secure storage is not configured; uploads remain closed." }, 503);
  }

  const { token, claims } = await authenticate(request, env);
  const propertyId = url.searchParams.get("propertyId") || "";
  const kind = url.searchParams.get("kind") || "";
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(propertyId)) return json({ error: "Invalid property ID." }, 400);
  if (!["photo", "document"].includes(kind)) return json({ error: "Invalid file category." }, 400);

  await authorizeOwnerAndProperty({
    projectId: env.FIREBASE_PROJECT_ID,
    token,
    claims,
    propertyId,
    ownerAdminUid: env.OWNER_ADMIN_UID
  });

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 1 || declaredLength > MAX_OBJECT_BYTES) {
    return json({ error: "File must be between 1 byte and 20 MB." }, 413);
  }
  const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!allowedType(kind, contentType)) return json({ error: "Only JPG, PNG, WEBP photos and PDF documents are accepted." }, 415);

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength !== declaredLength || !hasValidMagic(kind, bytes, contentType)) {
    return json({ error: "File content does not match its declared type or size." }, 415);
  }

  const ownerUid = claims.sub;
  const reservationId = crypto.randomUUID();
  const objectKey = `owners/${ownerUid}/properties/${propertyId}/${kind}/${crypto.randomUUID()}`;
  const reserved = await reserveUpload(env.QUOTA_DB, {
    reservationId, ownerUid, propertyId, objectKind: kind, byteSize: bytes.byteLength
  });
  if (!reserved) {
    const quota = await readQuota(env.QUOTA_DB);
    return json({
      error: "Storage limit reached. New uploads are paused at the 9 GB safety limit.",
      code: "STORAGE_QUOTA_REACHED",
      warning: quota.warning,
      usedBytes: quota.totalBytes
    }, 507);
  }

  try {
    await env.STORAGE.put(objectKey, bytes, {
      httpMetadata: { contentType, cacheControl: "private, no-store" },
      customMetadata: { ownerUid, propertyId, kind }
    });
  } catch {
    await releaseFailedUpload(env.QUOTA_DB, reservationId);
    return json({ error: "File storage failed. No upload was completed." }, 503);
  }

  // If metadata finalization fails, keep the reservation (fail closed) for reconciliation.
  await commitUpload(env.QUOTA_DB, { reservationId, objectKey });
  const quota = await readQuota(env.QUOTA_DB);
  return json({
    success: true,
    objectKey,
    kind,
    sizeBytes: bytes.byteLength,
    warning: quota.warning,
    message: quota.warning ? "Storage is above 8 GB. Owner review is required before further growth." : "File securely stored."
  }, 201);
}

async function download(request, url, env) {
  if (!env.STORAGE || !env.QUOTA_DB || !env.FIREBASE_PROJECT_ID || !env.OWNER_ADMIN_UID) {
    return json({ error: "Secure storage is not configured." }, 503);
  }
  const { token, claims } = await authenticate(request, env);
  const objectKey = url.searchParams.get("key") || "";
  if (!objectKey || objectKey.length > 500 || objectKey.includes("..")) {
    return json({ error: "Invalid file reference." }, 400);
  }
  const record = await env.QUOTA_DB.prepare(
    "SELECT owner_uid, property_id, object_kind, byte_size FROM storage_objects WHERE object_key = ?"
  ).bind(objectKey).first();
  if (!record) return json({ error: "File not found." }, 404);

  const profile = await (async () => {
    const { getFirestoreDocument } = await import("./auth.js");
    return getFirestoreDocument(env.FIREBASE_PROJECT_ID, token, `users/${claims.sub}`);
  })();
  const role = profile?.role?.stringValue;
  const isAdmin = safeEqual(claims.sub, env.OWNER_ADMIN_UID) && role === "admin";
  if (!isAdmin && (role !== "property_owner" || claims.email_verified !== true || record.owner_uid !== claims.sub)) {
    return json({ error: "You are not allowed to access this file." }, 403);
  }

  const object = await env.STORAGE.get(objectKey);
  if (!object) return json({ error: "File not found in storage." }, 404);
  const contentType = record.object_kind === "document" ? "application/pdf" : (object.httpMetadata?.contentType || "application/octet-stream");
  return new Response(object.body, {
    headers: {
      "content-type": contentType,
      "content-length": String(record.byte_size),
      "content-disposition": record.object_kind === "document" ? "attachment" : "inline",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ service: "jameenghar-r2-guard", status: "secure-upload-staged", uploadsEnabled: false });
    }
    if (url.pathname === "/upload" && request.method === "POST") {
      try { return await upload(request, url, env); }
      catch (error) { return json({ error: error?.message || "Upload rejected." }, 403); }
    }
    if (url.pathname === "/download" && request.method === "GET") {
      try { return await download(request, url, env); }
      catch (error) { return json({ error: error?.message || "Download rejected." }, 403); }
    }
    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      return json({ error: "Admin storage operations are not enabled." }, 503);
    }
    return json({ error: "Not found." }, 404);
  }
};
