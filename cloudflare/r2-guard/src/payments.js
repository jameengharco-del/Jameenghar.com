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
