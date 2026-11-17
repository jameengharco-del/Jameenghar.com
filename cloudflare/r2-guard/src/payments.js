const encoder = new TextEncoder();

function toHex(bytes) {
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(secret, message) {
  if (!secret || typeof secret !== "string") throw new Error("Payment verification secret is not configured");
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

/** Verify Razorpay Checkout response against the order ID stored server-side. */
export async function verifyRazorpayCheckoutSignature({ orderId, paymentId, signature, keySecret }) {
  if (![orderId, paymentId, signature].every(value => typeof value === "string" && value.length > 0)) {
    throw new Error("Missing payment verification fields");
  }
  const expected = await hmacSha256(keySecret, `${orderId}|${paymentId}`);
  return constantTimeEqual(expected, signature.toLowerCase());
}

/** Verify webhook HMAC against the exact raw request body, before JSON parsing. */
export async function verifyRazorpayWebhookSignature({ rawBody, signature, webhookSecret }) {
  if (typeof rawBody !== "string" || typeof signature !== "string" || !signature) {
    throw new Error("Missing webhook verification fields");
  }
  const expected = await hmacSha256(webhookSecret, rawBody);
  return constantTimeEqual(expected, signature.toLowerCase());
}

export function isCapturedPayment({ providerStatus, orderStatus, expectedAmountPaise, actualAmountPaise, expectedCurrency, actualCurrency }) {
  return providerStatus === "captured" &&
    (orderStatus === undefined || orderStatus === "paid") &&
    Number.isSafeInteger(expectedAmountPaise) &&
    Number.isSafeInteger(actualAmountPaise) &&
    expectedAmountPaise > 0 &&
    actualAmountPaise === expectedAmountPaise &&
    actualCurrency === expectedCurrency &&
    expectedCurrency === "INR";
}


/** Validate a server-calculated Daybnb quote before asking the gateway for an order. */
export function validateDaybnbQuote({ bookingId, quoteVersion, amountPaise, currency = "INR" }) {
  if (typeof bookingId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(bookingId)) {
    throw new Error("Invalid booking reference");
  }
  if (!Number.isSafeInteger(quoteVersion) || quoteVersion < 1) {
    throw new Error("Invalid quote version");
  }
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 100) {
    throw new Error("Payment amount must be at least ₹1 and use integer paise");
  }
  if (currency !== "INR") throw new Error("Only INR payments are enabled");
  return { bookingId, quoteVersion, amountPaise, currency };
}

/** Create an order using server-side credentials only. This is not wired to a route. */
export async function createRazorpayOrder({
  keyId, keySecret, bookingId, quoteVersion, amountPaise, currency = "INR", fetchImpl = fetch
}) {
  const quote = validateDaybnbQuote({ bookingId, quoteVersion, amountPaise, currency });
  if (!keyId || !keySecret) throw new Error("Razorpay server credentials are not configured");
  const receipt = `daybnb_${bookingId}_q${quoteVersion}`.slice(0, 40);
  const response = await fetchImpl("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "authorization": "Basic " + btoa(`${keyId}:${keySecret}`),
      "content-type": "application/json"
    },
    body: JSON.stringify({
      amount: quote.amountPaise,
      currency: quote.currency,
      receipt,
      notes: { booking_id: quote.bookingId, quote_version: String(quote.quoteVersion), product: "Daybnb" }
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Razorpay order creation failed");
  if (!body.id || body.amount !== quote.amountPaise || body.currency !== quote.currency) {
    throw new Error("Razorpay returned an order that does not match the confirmed quote");
  }
  return { id: body.id, amount: body.amount, currency: body.currency, receipt: body.receipt || receipt };
}
