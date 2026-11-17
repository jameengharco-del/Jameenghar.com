import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  verifyRazorpayCheckoutSignature,
  verifyRazorpayWebhookSignature,
  isCapturedPayment
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
