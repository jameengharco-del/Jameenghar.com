const FIREBASE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let jwksCache = null;
let jwksExpiry = 0;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}
function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = new Set(["https://jameenghar.com", "https://www.jameenghar.com"]);
  const headers = { "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "authorization,content-type,x-razorpay-signature", "access-control-max-age": "86400", "vary": "Origin" };
  if (allowed.has(origin)) headers["access-control-allow-origin"] = origin;
  return headers;
}
function b64urlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
function bytesToHex(bytes) { return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join(""); }
async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function firebaseKeys() {
  if (jwksCache && Date.now() < jwksExpiry) return jwksCache;
  const response = await fetch(FIREBASE_JWKS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!response.ok) throw new Error("Could not load Firebase token verification keys.");
  jwksCache = await response.json();
  jwksExpiry = Date.now() + 50 * 60 * 1000;
  return jwksCache;
}
async function verifyFirebaseToken(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) throw new Response("Firebase sign-in is required.", { status: 401 });
  const parts = token.split(".");
  if (parts.length !== 3) throw new Response("Invalid Firebase ID token.", { status: 401 });
  let header, claims;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch { throw new Response("Invalid Firebase ID token.", { status: 401 }); }
  if (header.alg !== "RS256" || !header.kid) throw new Response("Unsupported Firebase token.", { status: 401 });
  let keys = await firebaseKeys();
  let jwk = keys.keys.find(key => key.kid === header.kid);
  if (!jwk) {
    jwksExpiry = 0;
    keys = await firebaseKeys();
    jwk = keys.keys.find(key => key.kid === header.kid);
  }
  if (!jwk) throw new Response("Firebase token signing key is unknown.", { status: 401 });
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  const now = Math.floor(Date.now() / 1000);
  if (!valid || claims.aud !== env.FIREBASE_PROJECT_ID || claims.iss !== "https://securetoken.google.com/" + env.FIREBASE_PROJECT_ID ||
      typeof claims.sub !== "string" || !claims.sub || claims.exp <= now || claims.iat > now + 60) {
    throw new Response("Firebase session is invalid or expired.", { status: 401 });
  }
  return claims;
}
function decodeFirestoreValue(value) {
  if (!value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  if ("mapValue" in value) return decodeFirestoreFields(value.mapValue.fields || {});
  return null;
}
function decodeFirestoreFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decodeFirestoreValue(value)]));
}
async function readProperty(propertyId, token, env) {
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(propertyId)) throw new Response("Invalid property.", { status: 400 });
  const url = "https://firestore.googleapis.com/v1/projects/" + env.FIREBASE_PROJECT_ID + "/databases/(default)/documents/daybnbProperties/" + encodeURIComponent(propertyId);
  const response = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (response.status === 404) throw new Response("This stay is no longer available.", { status: 404 });
  if (!response.ok) throw new Response("Could not verify this stay listing.", { status: 403 });
  const document = await response.json();
  const property = decodeFirestoreFields(document.fields || {});
  if (property.isPublished !== true || property.status !== "approved") throw new Response("This stay is not currently bookable.", { status: 409 });
  return property;
}
function localDateTimeMs(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Response("Choose a valid date and time.", { status: 400 });
  const stamp = Date.parse(date + "T" + time + ":00+05:30");
  if (!Number.isFinite(stamp)) throw new Response("Invalid date or time.", { status: 400 });
  return stamp;
}
function addDays(date, count) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + count)).toISOString().slice(0, 10);
}
function bookingWindow(body, property) {
  const type = body.bookingType;
  const checkInDate = String(body.checkInDate || "");
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkInDate) || checkInDate < today) throw new Response("Choose a date from today onward.", { status: 400 });
  let startMs, endMs, endDate, startLabel, endLabel, units, rate;
  if (type === "hourly") {
    const startTime = String(body.startTime || ""), endTime = String(body.endTime || "");
    startMs = localDateTimeMs(checkInDate, startTime);
    endMs = localDateTimeMs(checkInDate, endTime);
    if (endMs <= startMs || endMs - startMs > 12 * 3600000 || startMs <= Date.now() + 15 * 60000) throw new Response("Hourly stays must be up to 12 hours and start at least 15 minutes from now.", { status: 400 });
    units = Math.ceil((endMs - startMs) / 3600000);
    rate = Number(property.hourlyRate || 0);
    endDate = checkInDate;
    startLabel = checkInDate + " " + startTime;
    endLabel = checkInDate + " " + endTime;
  } else if (type === "day") {
    const checkIn = property.checkInTime || "10:00";
    const checkOut = property.checkOutTime || "18:00";
    startMs = localDateTimeMs(checkInDate, checkIn);
    endDate = checkInDate;
    endMs = localDateTimeMs(checkInDate, checkOut);
    if (endMs <= startMs || startMs <= Date.now() + 15 * 60000) throw new Response("Day-use check-in must be in the future and before checkout.", { status: 400 });
    units = 1;
    rate = Number(property.dayRate || 0);
    startLabel = checkInDate + " (Day Use)";
    endLabel = endDate;
  } else if (type === "overnight") {
    endDate = String(body.checkOutDate || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate <= checkInDate) throw new Response("Choose a checkout date after check-in.", { status: 400 });
    const nights = Math.round((Date.parse(endDate + "T00:00:00Z") - Date.parse(checkInDate + "T00:00:00Z")) / 86400000);
    if (nights < 1 || nights > 30) throw new Response("Overnight bookings can be 1 to 30 nights.", { status: 400 });
    startMs = localDateTimeMs(checkInDate, property.checkInTime || "14:00");
    endMs = localDateTimeMs(endDate, property.checkOutTime || "11:00");
    if (startMs <= Date.now() + 15 * 60000) throw new Response("Choose a future check-in time.", { status: 400 });
    units = nights;
    rate = Number(property.nightRate || 0);
    startLabel = checkInDate + " " + (property.checkInTime || "14:00");
    endLabel = endDate + " " + (property.checkOutTime || "11:00");
  } else throw new Response("Choose Hourly, Day Use or Overnight.", { status: 400 });
  if (!Number.isFinite(rate) || rate <= 0) throw new Response("This property has not configured a price for the selected booking type.", { status: 409 });
  const guests = Number(body.guests || 0);
  if (!Number.isInteger(guests) || guests < 1 || guests > Number(property.maxGuests || 0)) throw new Response("Guest count exceeds this property's capacity.", { status: 400 });
  const amountRupees = Math.round(rate * units), amountPaise = amountRupees * 100;
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 100 || amountPaise > 500000000) throw new Response("Booking amount is outside the supported range.", { status: 400 });
  return { type, checkInDate, checkOutDate: type === "overnight" ? endDate : "", startMs, endMs, startLabel, endLabel, units, rate, amountRupees, amountPaise, guests };
}
function calendarStub(env, propertyId) { return env.CALENDARS.get(env.CALENDARS.idFromName(propertyId)); }
async function doJson(stub, path, payload) {
  const response = await stub.fetch("https://calendar.internal" + path, payload ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) } : { method: "GET" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Response(data.error || "Booking service error.", { status: response.status });
  return data;
}
function basicAuth(env) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) throw new Response("Online payments are not activated yet. Please contact JameenGhar Stays.", { status: 503 });
  return "Basic " + btoa(env.RAZORPAY_KEY_ID + ":" + env.RAZORPAY_KEY_SECRET);
}
async function razorpayRequest(path, env, options = {}) {
  const response = await fetch("https://api.razorpay.com/v1" + path, {
    method: options.method || "GET",
    headers: { Authorization: basicAuth(env), "content-type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Response(data.error?.description || "Payment provider request failed.", { status: 502 });
  return data;
}
async function confirmOrRefund(propertyId, bookingId, orderId, paymentId, amountPaise, env) {
  const stub = calendarStub(env, propertyId);
  const result = await doJson(stub, "/confirm", { bookingId, orderId, paymentId, amountPaise });
  if (result.confirmed) return result;
  if (!result.needsRefund) return result;
  const refund = await razorpayRequest("/payments/" + encodeURIComponent(paymentId) + "/refund", env, { method: "POST", body: { amount: amountPaise, notes: { reason: "Booking slot hold expired before payment verification", bookingId, propertyId } } });
  await doJson(stub, "/refund-result", { bookingId, refundId: refund.id, status: refund.status || "pending" });
  return { confirmed: false, refunded: true, refundStatus: refund.status || "pending", message: "The slot hold expired. A refund has been initiated." };
}
async function routeRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (url.pathname === "/api/health" && request.method === "GET") return json({ ok: true, service: "JameenGhar Stays Booking", paymentsConfigured: !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) }, 200, corsHeaders(request));
  if (url.pathname === "/api/webhooks/razorpay" && request.method === "POST") {
    const raw = await request.text();
    if (!env.RAZORPAY_WEBHOOK_SECRET) return json({ error: "Webhook secret is not configured." }, 503, corsHeaders(request));
    const signature = request.headers.get("X-Razorpay-Signature") || "";
    const expected = await hmacHex(env.RAZORPAY_WEBHOOK_SECRET, raw);
    if (!safeEqual(signature, expected)) return json({ error: "Invalid webhook signature." }, 401, corsHeaders(request));
    const eventId = request.headers.get("X-Razorpay-Event-Id") || "";
    let event;
    try { event = JSON.parse(raw); } catch { return json({ error: "Invalid webhook payload." }, 400, corsHeaders(request)); }
    if (!eventId) return json({ error: "Missing webhook event id." }, 400, corsHeaders(request));
    if (event.event === "payment.captured" || event.event === "order.paid") {
      const payment = event.payload?.payment?.entity, orderId = payment?.order_id || event.payload?.order?.entity?.id;
      if (orderId) {
        const order = await razorpayRequest("/orders/" + encodeURIComponent(orderId), env), notes = order.notes || {};
        const propertyId = String(notes.propertyId || ""), bookingId = String(notes.bookingId || "");
        if (propertyId && bookingId) {
          const paymentId = payment?.id || "";
          const result = await doJson(calendarStub(env, propertyId), "/webhook-confirm", { eventId, bookingId, orderId, paymentId, amountPaise: Number(order.amount || 0) });
          if (result.needsRefund && paymentId) {
            const refund = await razorpayRequest("/payments/" + encodeURIComponent(paymentId) + "/refund", env, { method: "POST", body: { amount: Number(order.amount || 0), notes: { reason: "Booking slot hold expired before payment confirmation", bookingId, propertyId } } });
            await doJson(calendarStub(env, propertyId), "/refund-result", { bookingId, refundId: refund.id, status: refund.status || "pending" });
          }
        }
      }
    } else if (event.event === "payment.failed") {
      const payment = event.payload?.payment?.entity, orderId = payment?.order_id;
      if (orderId) {
        const order = await razorpayRequest("/orders/" + encodeURIComponent(orderId), env), notes = order.notes || {};
        if (notes.propertyId && notes.bookingId) await doJson(calendarStub(env, String(notes.propertyId)), "/payment-failed", { eventId, bookingId: String(notes.bookingId), orderId });
      }
    }
    return json({ received: true }, 200, corsHeaders(request));
  }

  const claims = await verifyFirebaseToken(request, env);
  const token = request.headers.get("Authorization").slice(7);
  if (url.pathname === "/api/availability" && request.method === "GET") {
    const propertyId = url.searchParams.get("propertyId") || "", month = url.searchParams.get("month") || "";
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Response("Choose a valid calendar month.", { status: 400 });
    await readProperty(propertyId, token, env);
    return json(await doJson(calendarStub(env, propertyId), "/availability?month=" + encodeURIComponent(month)), 200, corsHeaders(request));
  }
  if (url.pathname === "/api/booking/create-order" && request.method === "POST") {
    const body = await request.json(), propertyId = String(body.propertyId || "");
    const property = await readProperty(propertyId, token, env), windowData = bookingWindow(body, property);
    const customerName = String(body.customerName || "").trim(), phone = String(body.phone || "").replace(/\D/g, ""), email = String(body.email || "").trim();
    if (!customerName || customerName.length > 100 || !/^\d{10}$/.test(phone) || email.length > 150) throw new Response("Enter a valid name and 10-digit mobile number.", { status: 400 });
    const bookingId = crypto.randomUUID();
    const hold = await doJson(calendarStub(env, propertyId), "/hold", {
      bookingId, propertyId, customerUid: claims.sub, customerName, phone, email,
      bookingType: windowData.type, startMs: windowData.startMs, endMs: windowData.endMs,
      startLabel: windowData.startLabel, endLabel: windowData.endLabel, checkInDate: windowData.checkInDate,
      checkOutDate: windowData.checkOutDate, startTime: String(body.startTime || ""), endTime: String(body.endTime || ""),
      guests: windowData.guests, amountPaise: windowData.amountPaise, message: String(body.message || "").slice(0, 500),
      propertyTitle: String(property.title || "")
    });
    try {
      const order = await razorpayRequest("/orders", env, { method: "POST", body: {
        amount: windowData.amountPaise, currency: "INR", receipt: "jg-" + bookingId.slice(0, 28),
        notes: { bookingId, propertyId, customerUid: claims.sub }
      }});
      await doJson(calendarStub(env, propertyId), "/attach-order", { bookingId, orderId: order.id });
      return json({ bookingId, propertyId, orderId: order.id, amount: order.amount, currency: order.currency, keyId: env.RAZORPAY_KEY_ID, holdExpiresAt: hold.holdExpiresAt,
        booking: { title: property.title, bookingType: windowData.type, start: windowData.startLabel, end: windowData.endLabel, guests: windowData.guests, amountRupees: windowData.amountRupees }
      }, 200, corsHeaders(request));
    } catch (error) {
      await doJson(calendarStub(env, propertyId), "/release", { bookingId, customerUid: claims.sub }).catch(() => {});
      throw error;
    }
  }
  if (url.pathname === "/api/booking/verify" && request.method === "POST") {
    const body = await request.json();
    const propertyId = String(body.propertyId || ""), bookingId = String(body.bookingId || ""), orderId = String(body.razorpay_order_id || ""), paymentId = String(body.razorpay_payment_id || ""), signature = String(body.razorpay_signature || "");
    const booking = await doJson(calendarStub(env, propertyId), "/get?bookingId=" + encodeURIComponent(bookingId));
    if (booking.customerUid !== claims.sub || booking.orderId !== orderId) throw new Response("Booking session does not match this payment.", { status: 403 });
    const expected = await hmacHex(env.RAZORPAY_KEY_SECRET, orderId + "|" + paymentId);
    if (!safeEqual(signature, expected)) throw new Response("Payment signature verification failed.", { status: 400 });
    const payment = await razorpayRequest("/payments/" + encodeURIComponent(paymentId), env);
    if (payment.order_id !== orderId || Number(payment.amount) !== Number(booking.amountPaise) || payment.status !== "captured") throw new Response("Payment is not captured yet. Your booking remains pending while the payment is checked.", { status: 409 });
    const result = await confirmOrRefund(propertyId, bookingId, orderId, paymentId, Number(payment.amount), env);
    return json({ ...result, bookingId, bookingStatus: result.confirmed ? "confirmed" : result.refunded ? "refund_pending" : "pending" }, 200, corsHeaders(request));
  }
  if (url.pathname === "/api/booking/status" && request.method === "GET") {
    const propertyId = url.searchParams.get("propertyId") || "", bookingId = url.searchParams.get("bookingId") || "";
    const booking = await doJson(calendarStub(env, propertyId), "/get?bookingId=" + encodeURIComponent(bookingId));
    if (booking.customerUid !== claims.sub) throw new Response("Booking not found.", { status: 404 });
    return json({ bookingId, status: booking.status, holdExpiresAt: booking.holdExpiresAt || null, amountPaise: booking.amountPaise }, 200, corsHeaders(request));
  }
  if (url.pathname === "/api/owner/bookings" && request.method === "GET") {
    if (claims.sub !== env.OWNER_UID) throw new Response("Owner access required.", { status: 403 });
    const propertyId = url.searchParams.get("propertyId") || "";
    await readProperty(propertyId, token, env);
    return json(await doJson(calendarStub(env, propertyId), "/owner-bookings"), 200, corsHeaders(request));
  }
  if (url.pathname === "/api/owner/block" && request.method === "POST") {
    if (claims.sub !== env.OWNER_UID) throw new Response("Owner access required.", { status: 403 });
    const body = await request.json(), propertyId = String(body.propertyId || "");
    await readProperty(propertyId, token, env);
    const startMs = Date.parse(String(body.start || "")), endMs = Date.parse(String(body.end || ""));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || endMs - startMs > 31 * 86400000) throw new Response("Choose a valid block period of up to 31 days.", { status: 400 });
    return json(await doJson(calendarStub(env, propertyId), "/block", { blockId: crypto.randomUUID(), propertyId, startMs, endMs, note: String(body.note || "").slice(0, 150), ownerUid: claims.sub }), 200, corsHeaders(request));
  }
  if (url.pathname === "/api/owner/unblock" && request.method === "POST") {
    if (claims.sub !== env.OWNER_UID) throw new Response("Owner access required.", { status: 403 });
    const body = await request.json(), propertyId = String(body.propertyId || "");
    await readProperty(propertyId, token, env);
    return json(await doJson(calendarStub(env, propertyId), "/unblock", { blockId: String(body.blockId || "") }), 200, corsHeaders(request));
  }
  if (url.pathname === "/api/owner/refund" && request.method === "POST") {
    if (claims.sub !== env.OWNER_UID) throw new Response("Owner access required.", { status: 403 });
    const body = await request.json(), propertyId = String(body.propertyId || ""), bookingId = String(body.bookingId || "");
    await readProperty(propertyId, token, env);
    const booking = await doJson(calendarStub(env, propertyId), "/get?bookingId=" + encodeURIComponent(bookingId));
    if (!booking.paymentId || !["confirmed", "refund_pending"].includes(booking.status)) throw new Response("This booking is not eligible for a refund.", { status: 409 });
    const refund = await razorpayRequest("/payments/" + encodeURIComponent(booking.paymentId) + "/refund", env, { method: "POST", body: { amount: booking.amountPaise, notes: { bookingId, propertyId, reason: "Owner-approved booking cancellation" } } });
    await doJson(calendarStub(env, propertyId), "/refund-result", { bookingId, refundId: refund.id, status: refund.status || "pending" });
    return json({ ok: true, refundId: refund.id, status: refund.status || "pending" }, 200, corsHeaders(request));
  }
  return json({ error: "Route not found." }, 404, corsHeaders(request));
}

export default {
  async fetch(request, env) {
    try {
      return await routeRequest(request, env);
    } catch (error) {
      if (error instanceof Response) {
        const detail = await error.text().catch(() => "");
        return json({ error: detail || "Request failed." }, error.status, corsHeaders(request));
      }
      console.error("Stays booking API error:", error);
      return json({ error: "The booking service is temporarily unavailable. Please try again." }, 500, corsHeaders(request));
    }
  }
};

export class PropertyCalendar {
  constructor(ctx) {
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS stays_bookings (id TEXT PRIMARY KEY, property_id TEXT NOT NULL, customer_uid TEXT NOT NULL, customer_name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT NOT NULL, booking_type TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, start_label TEXT NOT NULL, end_label TEXT NOT NULL, check_in_date TEXT NOT NULL, check_out_date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, guests INTEGER NOT NULL, amount_paise INTEGER NOT NULL, status TEXT NOT NULL, hold_expires_at INTEGER, order_id TEXT, payment_id TEXT, refund_id TEXT, message TEXT NOT NULL, property_title TEXT NOT NULL, block_note TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS stays_bookings_window ON stays_bookings(property_id,start_ms,end_ms,status)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS stays_webhook_events (event_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL)");
  }
  conflict(propertyId, startMs, endMs, now, excludedId = "") {
    return this.sql.exec("SELECT id,status FROM stays_bookings WHERE property_id=? AND id<>? AND status IN ('hold','confirmed','blocked') AND end_ms>? AND start_ms<? AND (status<>'hold' OR hold_expires_at>?) LIMIT 1",
      propertyId, excludedId, startMs, endMs, now).toArray()[0] || null;
  }
  async fetch(request) {
    const url = new URL(request.url), now = Date.now();
    this.sql.exec("DELETE FROM stays_bookings WHERE status='hold' AND hold_expires_at<=?", now);
    if (url.pathname === "/availability" && request.method === "GET") {
      const month = url.searchParams.get("month") || "";
      if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: "Invalid month." }, 400);
      const [year, monthNum] = month.split("-").map(Number);
      const start = Date.parse(month + "-01T00:00:00+05:30");
      const next = new Date(Date.UTC(year, monthNum, 1)).toISOString().slice(0, 7);
      const end = Date.parse(next + "-01T00:00:00+05:30");
      const rows = this.sql.exec("SELECT id,start_ms,end_ms,status,booking_type,start_label,end_label,hold_expires_at FROM stays_bookings WHERE start_ms<? AND end_ms>? AND status IN ('hold','confirmed','blocked') AND (status<>'hold' OR hold_expires_at>?) ORDER BY start_ms",
        end, start, now).toArray();
      return json({ month, reservations: rows.map(row => ({ id: row.id, startMs: row.start_ms, endMs: row.end_ms, status: row.status, bookingType: row.booking_type, start: row.start_label, end: row.end_label, holdExpiresAt: row.hold_expires_at || null })) });
    }
    if (url.pathname === "/hold" && request.method === "POST") {
      const body = await request.json();
      if (this.sql.exec("SELECT id FROM stays_bookings WHERE id=?", body.bookingId).toArray()[0]) return json({ error: "Duplicate booking request." }, 409);
      if (this.conflict(body.propertyId, Number(body.startMs), Number(body.endMs), now)) return json({ error: "This time is no longer available. Please choose another date or time." }, 409);
      const expiry = now + 10 * 60 * 1000;
      this.sql.exec("INSERT INTO stays_bookings (id,property_id,customer_uid,customer_name,phone,email,booking_type,start_ms,end_ms,start_label,end_label,check_in_date,check_out_date,start_time,end_time,guests,amount_paise,status,hold_expires_at,message,property_title,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'hold',?,?,?,?,?)",
        body.bookingId, body.propertyId, body.customerUid, body.customerName, body.phone, body.email || "", body.bookingType,
        body.startMs, body.endMs, body.startLabel, body.endLabel, body.checkInDate, body.checkOutDate || "", body.startTime || "", body.endTime || "",
        body.guests, body.amountPaise, expiry, body.message || "", body.propertyTitle || "", now, now);
      return json({ ok: true, holdExpiresAt: expiry });
    }
    if (url.pathname === "/attach-order" && request.method === "POST") {
      const body = await request.json();
      this.sql.exec("UPDATE stays_bookings SET order_id=?,updated_at=? WHERE id=? AND status='hold'", body.orderId, now, body.bookingId);
      return json({ ok: true });
    }
    if (url.pathname === "/release" && request.method === "POST") {
      const body = await request.json();
      this.sql.exec("UPDATE stays_bookings SET status='released',hold_expires_at=?,updated_at=? WHERE id=? AND customer_uid=? AND status='hold'", now, now, body.bookingId, body.customerUid);
      return json({ ok: true });
    }
    if (url.pathname === "/get" && request.method === "GET") {
      const id = url.searchParams.get("bookingId") || "", row = this.sql.exec("SELECT * FROM stays_bookings WHERE id=?", id).toArray()[0];
      return row ? json(this.toBooking(row)) : json({ error: "Booking not found." }, 404);
    }
    if (url.pathname === "/confirm" && request.method === "POST") {
      const body = await request.json(), row = this.sql.exec("SELECT * FROM stays_bookings WHERE id=?", body.bookingId).toArray()[0];
      if (!row || row.order_id !== body.orderId || Number(row.amount_paise) !== Number(body.amountPaise)) return json({ error: "Booking and payment do not match." }, 409);
      if (row.status === "confirmed") return json({ confirmed: true, status: "confirmed" });
      if (row.status === "refund_pending" || row.status === "refunded") return json({ confirmed: false, refunded: row.status === "refunded", status: row.status });
      if (row.status !== "hold" || Number(row.hold_expires_at || 0) <= now || this.conflict(row.property_id, row.start_ms, row.end_ms, now, row.id)) {
        this.sql.exec("UPDATE stays_bookings SET status='refund_pending',payment_id=?,updated_at=? WHERE id=?", body.paymentId, now, row.id);
        return json({ confirmed: false, needsRefund: true, status: "refund_pending" });
      }
      this.sql.exec("UPDATE stays_bookings SET status='confirmed',payment_id=?,updated_at=? WHERE id=?", body.paymentId, now, row.id);
      return json({ confirmed: true, status: "confirmed" });
    }
    if (url.pathname === "/webhook-confirm" && request.method === "POST") {
      const body = await request.json();
      if (this.sql.exec("SELECT event_id FROM stays_webhook_events WHERE event_id=?", body.eventId).toArray()[0]) return json({ received: true, duplicate: true });
      const row = this.sql.exec("SELECT * FROM stays_bookings WHERE id=?", body.bookingId).toArray()[0];
      if (row && row.order_id === body.orderId && Number(row.amount_paise) === Number(body.amountPaise)) {
        this.sql.exec("INSERT INTO stays_webhook_events(event_id,created_at) VALUES(?,?)", body.eventId, now);
        if (row.status === "hold" && Number(row.hold_expires_at || 0) > now && !this.conflict(row.property_id, row.start_ms, row.end_ms, now, row.id)) {
          this.sql.exec("UPDATE stays_bookings SET status='confirmed',payment_id=?,updated_at=? WHERE id=?", body.paymentId, now, row.id);
          this.sql.exec("INSERT INTO stays_webhook_events(event_id,created_at) VALUES(?,?)", body.eventId, now);
          return json({ received: true, confirmed: true });
        } else if (row.status !== "confirmed" && row.status !== "refund_pending" && row.status !== "refunded") {
          this.sql.exec("UPDATE stays_bookings SET status='refund_pending',payment_id=?,updated_at=? WHERE id=?", body.paymentId, now, row.id);
          this.sql.exec("INSERT INTO stays_webhook_events(event_id,created_at) VALUES(?,?)", body.eventId, now);
          return json({ received: true, needsRefund: true, bookingId: row.id, paymentId: body.paymentId, amountPaise: row.amount_paise });
        }
        this.sql.exec("INSERT INTO stays_webhook_events(event_id,created_at) VALUES(?,?)", body.eventId, now);
      }
      return json({ received: true });
    }
    if (url.pathname === "/payment-failed" && request.method === "POST") {
      const body = await request.json();
      if (!this.sql.exec("SELECT event_id FROM stays_webhook_events WHERE event_id=?", body.eventId).toArray()[0]) {
        this.sql.exec("INSERT INTO stays_webhook_events(event_id,created_at) VALUES(?,?)", body.eventId, now);
        this.sql.exec("UPDATE stays_bookings SET status='payment_failed',hold_expires_at=?,updated_at=? WHERE id=? AND order_id=? AND status='hold'", now, now, body.bookingId, body.orderId);
      }
      return json({ received: true });
    }
    if (url.pathname === "/refund-result" && request.method === "POST") {
      const body = await request.json(), status = body.status === "processed" ? "refunded" : "refund_pending";
      this.sql.exec("UPDATE stays_bookings SET refund_id=?,status=?,updated_at=? WHERE id=?", body.refundId, status, now, body.bookingId);
      return json({ ok: true });
    }
    if (url.pathname === "/owner-bookings" && request.method === "GET") {
      const rows = this.sql.exec("SELECT * FROM stays_bookings WHERE status NOT IN ('released','payment_failed') ORDER BY start_ms DESC LIMIT 500").toArray();
      return json({ bookings: rows.map(row => this.toBooking(row)) });
    }
    if (url.pathname === "/block" && request.method === "POST") {
      const body = await request.json();
      if (this.conflict(body.propertyId, Number(body.startMs), Number(body.endMs), now)) return json({ error: "This period already has a booking or active hold." }, 409);
      this.sql.exec("INSERT INTO stays_bookings (id,property_id,customer_uid,customer_name,phone,email,booking_type,start_ms,end_ms,start_label,end_label,check_in_date,check_out_date,start_time,end_time,guests,amount_paise,status,hold_expires_at,message,property_title,block_note,created_at,updated_at) VALUES (?,?,?,'','','','blocked',?,?,?,?,'','','','',0,0,'blocked',NULL,'','','',?,?)",
        body.blockId, body.propertyId, body.ownerUid, body.startMs, body.endMs, new Date(body.startMs).toISOString(), new Date(body.endMs).toISOString(), now, now);
      return json({ ok: true, blockId: body.blockId });
    }
    if (url.pathname === "/unblock" && request.method === "POST") {
      const body = await request.json();
      const result = this.sql.exec("UPDATE stays_bookings SET status='released',updated_at=? WHERE id=? AND status='blocked'", now, body.blockId);
      return json({ ok: true, changes: result.rowsWritten });
    }
    return json({ error: "Calendar route not found." }, 404);
  }
  toBooking(row) {
    return {
      id: row.id, propertyId: row.property_id, propertyTitle: row.property_title,
      customerUid: row.customer_uid, customerName: row.customer_name, phone: row.phone, email: row.email,
      bookingType: row.booking_type, startMs: row.start_ms, endMs: row.end_ms, start: row.start_label, end: row.end_label,
      checkInDate: row.check_in_date, checkOutDate: row.check_out_date, startTime: row.start_time, endTime: row.end_time,
      guests: row.guests, amountPaise: row.amount_paise, amountRupees: row.amount_paise / 100,
      status: row.status, holdExpiresAt: row.hold_expires_at || null, orderId: row.order_id,
      paymentId: row.payment_id, refundId: row.refund_id, message: row.message, blockNote: row.block_note,
      createdAt: row.created_at, updatedAt: row.updated_at
    };
  }
}
