import { verifyFirebaseIdToken, authorizeOwnerAndProperty } from "./auth.js";
import {
  readQuota, reserveUpload, commitUpload,
  MAX_OBJECT_BYTES
} from "./quota.js";
import {
  verifyRazorpayCheckoutSignature, verifyRazorpayWebhookSignature,
  isCapturedPayment, createRazorpayOrder, sha256Hex, fetchRazorpayPayment
} from "./payments.js";
import { getAdminDocument, patchAdminDocument } from "./firestore-admin.js";
import { sendZohoOwnerNotification } from "./zoho-mail.js";

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

async function readLimitedBody(request, maxBytes) {
  if (!request.body) throw new Error("File body is missing");
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("File exceeds maximum size");
        throw new Error("File exceeds the 20 MB upload limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  })[char]);
}

async function notifyCrmLeadCreated(request, env) {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    return json({ error: "Notification service is not configured." }, 503);
  }
  const { claims } = await authenticate(request, env);
  const body = await request.json().catch(() => ({}));
  const leadId = String(body.leadId || "");
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(leadId)) return json({ error: "Invalid lead reference." }, 400);
  const lead = await getAdminDocument(env, "leads", leadId);
  if (!lead) return json({ error: "Lead not found." }, 404);
  const data = lead.fields;
  if (data.source !== "crm" || data.createdBy !== claims.sub) {
    return json({ error: "You can notify only for a CRM lead you created." }, 403);
  }
  if (data.ownerNotificationSent === true) return json({ success: true, alreadySent: true });
  const html = [
    "<h2>New CRM Lead Created — JameenGhar</h2>",
    "<p>A consultant has created a new lead in JameenGhar CRM.</p>",
    "<table cellpadding='6' cellspacing='0' border='1' style='border-collapse:collapse'>",
    ["Lead ID",leadId],["Customer",data.customerName],["Phone",data.phone],
    ["Email",data.email],["Enquiry Type",data.enquiryType],["Location",data.propertyLocation],
    ["Budget",data.budget],["Created By",data.createdByName],["Requirement",data.message]
      .map(([label,value])=>"<tr><th align='left'>"+label+"</th><td>"+escapeHtml(value||"—")+"</td></tr>").join(""),
    "</table><p>Open the Owner Dashboard to assign and manage this lead.</p>"
  ].join("");
  const sent = await sendZohoOwnerNotification({
    env, subject: "New CRM Lead: " + String(data.customerName || leadId).slice(0,100), html
  });
  await patchAdminDocument(env, "leads", leadId, {
    ownerNotificationSent: true, ownerNotificationSentAt: new Date(),
    ownerNotificationMessageId: sent.messageId || ""
  });
  return json({ success: true, notified: true });
}

async function paymentStatus(request, env) {
  if (env.PAYMENTS_ENABLED !== "true") return json({ error: "Daybnb payments are disabled pending merchant and cost approval.", code: "PAYMENTS_DISABLED" }, 503);
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    return json({ error: "Secure payment service is not fully configured." }, 503);
  }
  const body = await request.json().catch(() => ({}));
  const bookingId = String(body.bookingId || "");
  const accessToken = String(body.accessToken || "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(bookingId) || !/^[a-f0-9]{64}$/.test(accessToken)) {
    return json({ error: "Invalid booking reference or payment access token." }, 400);
  }
  const booking = await getAdminDocument(env, "daybnbBookings", bookingId);
  if (!booking || await sha256Hex(accessToken) !== booking.fields.paymentAccessTokenHash) {
    return json({ error: "Invalid booking access token." }, 403);
  }
  const data = booking.fields;
  const ready = data.bookingStage === "awaiting_payment" && data.paymentStatus === "ready_for_checkout";
  const paid = data.paymentStatus === "paid" && data.bookingStage === "confirmed";
  return json({
    success: true,
    bookingId,
    bookingStage: data.bookingStage || "awaiting_owner_confirmation",
    paymentStatus: data.paymentStatus || "not_started",
    quoteReady: ready,
    paymentConfirmed: paid,
    amountPaise: ready || paid ? Number(data.totalAmountPaise || 0) : null,
    currency: data.currency || "INR",
    quoteExpiresAt: ready && data.quoteExpiresAt ? data.quoteExpiresAt : null
  });
}

async function paymentCreateOrder(request, env) {
  if (env.PAYMENTS_ENABLED !== "true") return json({ error: "Daybnb payments are disabled pending merchant and cost approval.", code: "PAYMENTS_DISABLED" }, 503);
  if (!env.QUOTA_DB || !env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY || !env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    return json({ error: "Secure payment service is not fully configured." }, 503);
  }
  const body = await request.json().catch(() => ({}));
  const bookingId = String(body.bookingId || "");
  const accessToken = String(body.accessToken || "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(bookingId) || !/^[a-f0-9]{64}$/.test(accessToken)) {
    return json({ error: "Invalid booking reference or payment access token." }, 400);
  }
  const booking = await getAdminDocument(env, "daybnbBookings", bookingId);
  if (!booking) return json({ error: "Booking not found." }, 404);
  const data = booking.fields;
  if (await sha256Hex(accessToken) !== data.paymentAccessTokenHash) return json({ error: "Invalid booking access token." }, 403);
  if (data.bookingStage !== "awaiting_payment" || data.paymentStatus !== "ready_for_checkout") {
    return json({ error: "Owner approval and final price are required before payment." }, 409);
  }
  if (!data.quoteExpiresAt || Date.parse(data.quoteExpiresAt) <= Date.now()) {
    return json({ error: "This approved quote has expired. Please ask the property team for a new quote." }, 409);
  }
  const quoteVersion = Number(data.quoteVersion);
  const amountPaise = Number(data.totalAmountPaise);
  const currency = data.currency || "INR";
  const key = `${bookingId}:q${quoteVersion}`;
  const existing = await env.QUOTA_DB.prepare("SELECT * FROM payment_orders WHERE idempotency_key = ?").bind(key).first();
  if (existing?.state === "created" && existing.provider_order_id) {
    await patchAdminDocument(env, "daybnbBookings", bookingId, {
      paymentStatus: "created", paymentProvider: "razorpay", gatewayOrderId: existing.provider_order_id,
      paymentAmountPaise: existing.amount_paise, updatedAt: new Date()
    });
    return json({ orderId: existing.provider_order_id, amount: existing.amount_paise, currency: existing.currency, keyId: env.RAZORPAY_KEY_ID, bookingId, quoteVersion });
  }
  if (existing?.state === "creating") return json({ error: "A payment order is already being prepared. Please wait and refresh." }, 409);
  if (!existing) {
    const insert = await env.QUOTA_DB.prepare(
      "INSERT OR IGNORE INTO payment_orders (idempotency_key, booking_id, quote_version, amount_paise, currency, guest_token_hash, state) VALUES (?, ?, ?, ?, ?, ?, 'creating')"
    ).bind(key, bookingId, quoteVersion, amountPaise, currency, data.paymentAccessTokenHash).run();
    if (!insert.meta?.changes) return json({ error: "A payment order request is already in progress. Please retry shortly." }, 409);
  } else {
    const retry = await env.QUOTA_DB.prepare("UPDATE payment_orders SET state='creating', updated_at=CURRENT_TIMESTAMP WHERE idempotency_key=? AND state='failed'").bind(key).run();
    if (!retry.meta?.changes) return json({ error: "This payment order is already being retried. Please wait and refresh." }, 409);
  }
  let order;
  try {
    order = await createRazorpayOrder({
      keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET,
      bookingId, quoteVersion, amountPaise, currency
    });
  } catch (error) {
    await env.QUOTA_DB.prepare("UPDATE payment_orders SET state='failed', updated_at=CURRENT_TIMESTAMP WHERE idempotency_key=? AND state='creating'").bind(key).run();
    throw error;
  }
  // Persist the provider order before updating Firestore. If Firestore is
  // temporarily unavailable, the retry reuses this exact order instead of
  // creating a second chargeable order.
  await env.QUOTA_DB.prepare("UPDATE payment_orders SET provider_order_id=?, state='created', updated_at=CURRENT_TIMESTAMP WHERE idempotency_key=?").bind(order.id, key).run();
  await patchAdminDocument(env, "daybnbBookings", bookingId, {
    paymentStatus: "created", paymentProvider: "razorpay", gatewayOrderId: order.id,
    paymentAmountPaise: amountPaise, updatedAt: new Date()
  });
  return json({ orderId: order.id, amount: amountPaise, currency, keyId: env.RAZORPAY_KEY_ID, bookingId, quoteVersion });
}

async function paymentVerify(request, env) {
  if (env.PAYMENTS_ENABLED !== "true") return json({ error: "Daybnb payments are disabled.", code: "PAYMENTS_DISABLED" }, 503);
  const body = await request.json().catch(() => ({}));
  const bookingId = String(body.bookingId || ""), accessToken = String(body.accessToken || "");
  const orderId = String(body.razorpay_order_id || ""), paymentId = String(body.razorpay_payment_id || ""), signature = String(body.razorpay_signature || "");
  if (!bookingId || !/^[a-f0-9]{64}$/.test(accessToken)) return json({ error: "Invalid booking access." }, 400);
  const booking = await getAdminDocument(env, "daybnbBookings", bookingId);
  if (!booking || await sha256Hex(accessToken) !== booking.fields.paymentAccessTokenHash) return json({ error: "Invalid booking access." }, 403);
  const row = await env.QUOTA_DB.prepare("SELECT * FROM payment_orders WHERE booking_id=? AND provider_order_id=?").bind(bookingId, orderId).first();
  if (!row || row.state !== "created") return json({ error: "Payment order not found." }, 404);
  if (Number(booking.fields.quoteVersion) !== Number(row.quote_version) ||
      Number(booking.fields.totalAmountPaise) !== Number(row.amount_paise) ||
      booking.fields.gatewayOrderId !== orderId) {
    return json({ error: "This payment order belongs to an older quote and cannot confirm the current booking. Contact support before retrying." }, 409);
  }
  if (!await verifyRazorpayCheckoutSignature({ orderId, paymentId, signature, keySecret: env.RAZORPAY_KEY_SECRET })) {
    return json({ error: "Payment signature verification failed." }, 400);
  }
  const payment = await fetchRazorpayPayment({ keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET, paymentId });
  if (payment.order_id !== orderId || !isCapturedPayment({
    providerStatus: payment.status, expectedAmountPaise: row.amount_paise, actualAmountPaise: payment.amount,
    expectedCurrency: row.currency, actualCurrency: payment.currency
  })) return json({ error: "Gateway has not confirmed the exact captured amount." }, 409);
  await patchAdminDocument(env, "daybnbBookings", bookingId, {
    paymentStatus: "paid", bookingStage: "confirmed", status: "confirmed",
    gatewayOrderId: orderId, gatewayPaymentId: paymentId, paidAt: new Date(), updatedAt: new Date()
  });
  await env.QUOTA_DB.prepare("UPDATE payment_orders SET state='paid', updated_at=CURRENT_TIMESTAMP WHERE idempotency_key=?").bind(row.idempotency_key).run();
  return json({ success: true, paymentStatus: "paid", bookingStage: "confirmed", bookingId });
}

async function paymentWebhook(request, env) {
  if (env.PAYMENTS_ENABLED !== "true") return json({ error: "Daybnb payments are disabled.", code: "PAYMENTS_DISABLED" }, 503);
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") || "";
  if (!await verifyRazorpayWebhookSignature({ rawBody, signature, webhookSecret: env.RAZORPAY_WEBHOOK_SECRET })) {
    return json({ error: "Invalid webhook signature." }, 401);
  }
  const eventId = request.headers.get("x-razorpay-event-id") || "";
  if (!eventId || eventId.length > 200) return json({ error: "Missing webhook event ID." }, 400);
  const priorEvent = await env.QUOTA_DB.prepare("SELECT provider_event_id FROM payment_webhook_events WHERE provider_event_id=?").bind(eventId).first();
  if (priorEvent) return json({ received: true, duplicate: true });
  const event = JSON.parse(rawBody);
  if (event.event !== "payment.captured") {
    await env.QUOTA_DB.prepare("INSERT OR IGNORE INTO payment_webhook_events (provider_event_id) VALUES (?)").bind(eventId).run();
    return json({ received: true, ignored: true });
  }
  const payment = event.payload?.payment?.entity;
  if (!payment?.order_id || !payment?.id) return json({ error: "Malformed captured payment event." }, 400);
  const row = await env.QUOTA_DB.prepare("SELECT * FROM payment_orders WHERE provider_order_id=?").bind(payment.order_id).first();
  if (!row) return json({ error: "Unknown payment order." }, 404);
  if (!isCapturedPayment({
    providerStatus: payment.status, expectedAmountPaise: row.amount_paise,
    actualAmountPaise: payment.amount, expectedCurrency: row.currency, actualCurrency: payment.currency
  })) return json({ error: "Captured payment does not match expected booking amount." }, 409);
  const booking = await getAdminDocument(env, "daybnbBookings", row.booking_id);
  if (!booking || booking.fields.gatewayOrderId !== payment.order_id ||
      Number(booking.fields.quoteVersion) !== Number(row.quote_version) ||
      Number(booking.fields.totalAmountPaise) !== Number(row.amount_paise)) {
    return json({ error: "Booking/order/quote mismatch. Payment requires manual reconciliation." }, 409);
  }
  await patchAdminDocument(env, "daybnbBookings", row.booking_id, {
    paymentStatus: "paid", bookingStage: "confirmed", status: "confirmed",
    gatewayPaymentId: payment.id, paidAt: new Date(), updatedAt: new Date()
  });
  await env.QUOTA_DB.prepare("UPDATE payment_orders SET state='paid', updated_at=CURRENT_TIMESTAMP WHERE idempotency_key=?").bind(row.idempotency_key).run();
  await env.QUOTA_DB.prepare("INSERT OR IGNORE INTO payment_webhook_events (provider_event_id) VALUES (?)").bind(eventId).run();
  return json({ received: true, paymentStatus: "paid", bookingId: row.booking_id });
}

async function upload(request, url, env) {
  if (!env.STORAGE || !env.QUOTA_DB || !env.FIREBASE_PROJECT_ID || !env.OWNER_ADMIN_UID) {
    return json({ error: "Secure storage is not configured; uploads remain closed." }, 503);
  }

  const { token, claims } = await authenticate(request, env);
  const propertyId = url.searchParams.get("propertyId") || "";
  const kind = url.searchParams.get("kind") || "";
  const propertyCollection = url.searchParams.get("collection") || "properties";
  if (!["properties", "daybnbProperties"].includes(propertyCollection)) return json({ error: "Invalid listing collection." }, 400);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(propertyId)) return json({ error: "Invalid property ID." }, 400);
  if (!["photo", "document"].includes(kind)) return json({ error: "Invalid file category." }, 400);

  await authorizeOwnerAndProperty({
    projectId: env.FIREBASE_PROJECT_ID,
    token,
    claims,
    propertyId,
    propertyCollection,
    ownerAdminUid: env.OWNER_ADMIN_UID
  });

  const declaredHeader = request.headers.get("content-length");
  const declaredLength = declaredHeader === null ? null : Number(declaredHeader);
  if (declaredLength !== null && (!Number.isSafeInteger(declaredLength) || declaredLength < 1 || declaredLength > MAX_OBJECT_BYTES)) {
    return json({ error: "File must be between 1 byte and 20 MB." }, 413);
  }
  const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!allowedType(kind, contentType)) return json({ error: "Only JPG, PNG, WEBP photos and PDF documents are accepted." }, 415);

  const bytes = await readLimitedBody(request, MAX_OBJECT_BYTES);
  if (bytes.byteLength < 1 || (declaredLength !== null && bytes.byteLength !== declaredLength) || !hasValidMagic(kind, bytes, contentType)) {
    return json({ error: "File content does not match its declared type or size." }, 415);
  }

  const ownerUid = claims.sub;
  const reservationId = crypto.randomUUID();
  const objectKey = `owners/${ownerUid}/${propertyCollection}/${propertyId}/${kind}/${crypto.randomUUID()}`;
  const reserved = await reserveUpload(env.QUOTA_DB, {
    reservationId, objectKey, ownerUid, propertyId: `${propertyCollection}/${propertyId}`, objectKind: kind, byteSize: bytes.byteLength
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
    // The R2 result may be ambiguous. Keep the reservation and block this
    // capacity until inventory reconciliation proves the object is absent.
    return json({ error: "Storage result is uncertain. This capacity is reserved while the Owner reconciles storage; uploads may pause temporarily." }, 503);
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

async function finalizeListing(request, url, env) {
  if (!env.QUOTA_DB || !env.FIREBASE_PROJECT_ID || !env.OWNER_ADMIN_UID) {
    return json({ error: "Listing verification is not configured." }, 503);
  }
  const { token, claims } = await authenticate(request, env);
  const propertyId = url.searchParams.get("propertyId") || "";
  const propertyCollection = url.searchParams.get("collection") || "properties";
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(propertyId)) return json({ error: "Invalid property ID." }, 400);
  if (!["properties", "daybnbProperties"].includes(propertyCollection)) return json({ error: "Invalid listing collection." }, 400);

  const authorization = await authorizeOwnerAndProperty({
    projectId: env.FIREBASE_PROJECT_ID,
    token,
    claims,
    propertyId,
    propertyCollection,
    ownerAdminUid: env.OWNER_ADMIN_UID
  });

  const listingKey = `${propertyCollection}/${propertyId}`;
  const listingOwnerUid = authorization.propertyOwner || claims.sub;
  const rows = await env.QUOTA_DB.prepare(
    "SELECT object_kind, COUNT(*) AS file_count, COUNT(DISTINCT object_key) AS unique_count FROM storage_objects WHERE owner_uid = ? AND property_id = ? GROUP BY object_kind"
  ).bind(listingOwnerUid, listingKey).all();
  const counts = { photo: 0, document: 0 };
  for (const row of rows.results || []) {
    if (row.object_kind === "photo") counts.photo = Number(row.unique_count || 0);
    if (row.object_kind === "document") counts.document = Number(row.unique_count || 0);
  }
  const ready = counts.photo >= 4 && counts.document >= 1;
  return json({
    success: true,
    readyForOwnerReview: ready,
    required: { distinctPhotos: 4, privateOfficialPdf: 1 },
    uploaded: counts,
    message: ready
      ? "Required files are present. The listing still needs Owner verification and approval before publication."
      : "More files are required before this listing can be sent for Owner review."
  }, ready ? 200 : 409);
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

async function handleRequest(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ service: "jameenghar-r2-guard", status: "secure-upload-staged", uploadsEnabled: false, paymentsEnabled: false, crmNotifications: "staged" });
    }
    if (url.pathname === "/notifications/crm-lead-created" && request.method === "POST") {
      try { return await notifyCrmLeadCreated(request, env); }
      catch (error) { return json({ error: error?.message || "Owner notification failed." }, 503); }
    }
    if (url.pathname === "/payments/status" && request.method === "POST") {
      try { return await paymentStatus(request, env); }
      catch (error) { return json({ error: error?.message || "Could not check booking payment status." }, 503); }
    }
    if (url.pathname === "/payments/create-order" && request.method === "POST") {
      try { return await paymentCreateOrder(request, env); }
      catch (error) { return json({ error: error?.message || "Could not prepare payment." }, 503); }
    }
    if (url.pathname === "/payments/verify" && request.method === "POST") {
      try { return await paymentVerify(request, env); }
      catch (error) { return json({ error: error?.message || "Could not verify payment." }, 503); }
    }
    if (url.pathname === "/payments/webhook" && request.method === "POST") {
      try { return await paymentWebhook(request, env); }
      catch (error) { return json({ error: error?.message || "Webhook processing failed." }, 503); }
    }
    if (url.pathname.startsWith("/payments/")) {
      return json({ error: "Method not allowed." }, 405);
    }
    if (["/upload", "/download", "/finalize"].includes(url.pathname) && env.ENABLE_UPLOADS !== "true") {
      return json({ error: "Uploads are disabled until the Owner completes the zero-cost and security activation checklist.", code: "UPLOADS_DISABLED" }, 503);
    }
    if (url.pathname === "/upload" && request.method === "POST") {
      try { return await upload(request, url, env); }
      catch (error) { return json({ error: error?.message || "Upload rejected." }, 403); }
    }
    if (url.pathname === "/download" && request.method === "GET") {
      try { return await download(request, url, env); }
      catch (error) { return json({ error: error?.message || "Download rejected." }, 403); }
    }
    if (url.pathname === "/finalize" && request.method === "POST") {
      try { return await finalizeListing(request, url, env); }
      catch (error) { return json({ error: error?.message || "Listing verification rejected." }, 403); }
    }
    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      return json({ error: "Admin storage operations are not enabled." }, 503);
    }
    return json({ error: "Not found." }, 404);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";
    const allowedOrigins = new Set(["https://jameenghar.com", "https://www.jameenghar.com"]);
    const headers = new Headers({
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type, x-razorpay-signature, x-razorpay-event-id",
      "access-control-max-age": "86400",
      "vary": "Origin"
    });
    if (allowedOrigins.has(origin)) headers.set("access-control-allow-origin", origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const response = await handleRequest(request, env);
    const merged = new Headers(response.headers);
    for (const [key, value] of headers.entries()) merged.set(key, value);
    if (allowedOrigins.has(origin)) merged.set("access-control-allow-origin", origin);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged });
  }
};
