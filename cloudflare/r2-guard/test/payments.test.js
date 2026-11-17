import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  verifyRazorpayCheckoutSignature,
  verifyRazorpayWebhookSignature,
  isCapturedPayment,
  validateDaybnbQuote,
  createRazorpayOrder
} from "../src/payments.js";

const secret = "unit-test-only-secret";

test("valid Razorpay checkout HMAC is accepted", async () => {
  const orderId = "order_test_123";
  const paymentId = "pay_test_456";
  const signature = createHmac("sha256", secret).update(orderId + "|" + paymentId).digest("hex");
  assert.equal(await verifyRazorpayCheckoutSignature({ orderId, paymentId, signature, keySecret: secret }), true);
});

test("tampered checkout signature is rejected", async () => {
  assert.equal(await verifyRazorpayCheckoutSignature({
    orderId: "order_test_123", paymentId: "pay_test_456", signature: "0".repeat(64), keySecret: secret
  }), false);
});

test("checkout signature fails closed without secret", async () => {
  await assert.rejects(verifyRazorpayCheckoutSignature({
    orderId: "order_test_123", paymentId: "pay_test_456", signature: "a".repeat(64), keySecret: ""
  }), /secret is not configured/i);
});

test("webhook HMAC verifies exact raw body", async () => {
  const rawBody = '{"event":"payment.captured","payload":{"id":"pay_test_456"}}';
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
  assert.equal(await verifyRazorpayWebhookSignature({ rawBody, signature, webhookSecret: secret }), true);
  assert.equal(await verifyRazorpayWebhookSignature({ rawBody: rawBody + " ", signature, webhookSecret: secret }), false);
});

test("only captured, paid, exact INR amount can confirm payment", () => {
  const good = { providerStatus:"captured", orderStatus:"paid", expectedAmountPaise:125000, actualAmountPaise:125000, expectedCurrency:"INR", actualCurrency:"INR" };
  assert.equal(isCapturedPayment(good), true);
  assert.equal(isCapturedPayment({...good, providerStatus:"authorized"}), false);
  assert.equal(isCapturedPayment({...good, actualAmountPaise:124999}), false);
  assert.equal(isCapturedPayment({...good, actualCurrency:"USD"}), false);
  assert.equal(isCapturedPayment({...good, orderStatus:"created"}), false);
});


test("Daybnb quote validation requires integer paise, INR and a version", () => {
  assert.deepEqual(validateDaybnbQuote({
    bookingId:"booking_123", quoteVersion:2, amountPaise:125000, currency:"INR"
  }), { bookingId:"booking_123", quoteVersion:2, amountPaise:125000, currency:"INR" });
  assert.throws(() => validateDaybnbQuote({bookingId:"booking_123",quoteVersion:1,amountPaise:12.5}), /integer paise/i);
  assert.throws(() => validateDaybnbQuote({bookingId:"booking_123",quoteVersion:1,amountPaise:100,currency:"USD"}), /INR/i);
  assert.throws(() => validateDaybnbQuote({bookingId:"booking_123",quoteVersion:0,amountPaise:100}), /quote version/i);
});

test("Razorpay order helper sends server-validated amount and INR currency", async () => {
  let request;
  const result = await createRazorpayOrder({
    keyId:"rzp_test_key", keySecret:"unit-test-secret",
    bookingId:"booking_123", quoteVersion:3, amountPaise:125000,
    fetchImpl:async (url, options) => {
      request = {url,options};
      return new Response(JSON.stringify({id:"order_test_123",amount:125000,currency:"INR"}),{status:200});
    }
  });
  assert.equal(request.url,"https://api.razorpay.com/v1/orders");
  assert.equal(request.options.method,"POST");
  const body=JSON.parse(request.options.body);
  assert.equal(body.amount,125000);
  assert.equal(body.currency,"INR");
  assert.equal(body.notes.booking_id,"booking_123");
  assert.equal(result.id,"order_test_123");
});

test("Razorpay order helper rejects mismatched gateway amount", async () => {
  await assert.rejects(createRazorpayOrder({
    keyId:"rzp_test_key",keySecret:"unit-test-secret",
    bookingId:"booking_123",quoteVersion:1,amountPaise:125000,
    fetchImpl:async()=>new Response(JSON.stringify({id:"order_test_123",amount:1,currency:"INR"}),{status:200})
  }),/does not match/i);
});

test("Razorpay order helper refuses to run without server credentials", async () => {
  await assert.rejects(createRazorpayOrder({
    bookingId:"booking_123",quoteVersion:1,amountPaise:125000
  }),/credentials are not configured/i);
});
