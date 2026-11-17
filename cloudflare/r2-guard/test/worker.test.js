import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

test("health endpoint is public and confirms uploads are disabled", async () => {
  const response = await worker.fetch(new Request("https://guard.example/health"), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.uploadsEnabled, false);
});

test("upload is denied by default even if storage bindings are accidentally present", async () => {
  const env = {
    STORAGE: { put() { throw new Error("must never be called"); } },
    QUOTA_DB: {},
    FIREBASE_PROJECT_ID: "test-project",
    OWNER_ADMIN_UID: "admin"
  };
  const response = await worker.fetch(new Request(
    "https://guard.example/upload?propertyId=listing123&kind=photo",
    { method: "POST", headers: { authorization: "Bearer invalid", "content-length": "10", "content-type": "image/jpeg" }, body: new Uint8Array(10) }
  ), env);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "UPLOADS_DISABLED");
});

test("listing finalization is denied by default", async () => {
  const response = await worker.fetch(new Request("https://guard.example/finalize?propertyId=listing123", {
    method: "POST",
    headers: { authorization: "Bearer invalid" }
  }), {
    QUOTA_DB: {},
    FIREBASE_PROJECT_ID: "test-project",
    OWNER_ADMIN_UID: "admin"
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "UPLOADS_DISABLED");
});

test("download is denied by default", async () => {
  const response = await worker.fetch(new Request("https://guard.example/download?key=some-key"), {
    STORAGE: { get() { throw new Error("must never be called"); } },
    QUOTA_DB: {},
    FIREBASE_PROJECT_ID: "test-project",
    OWNER_ADMIN_UID: "admin"
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "UPLOADS_DISABLED");
});

test("unknown paths do not expose storage", async () => {
  const response = await worker.fetch(new Request("https://guard.example/admin"), {});
  assert.equal(response.status, 503);
});

test("all payment routes remain explicitly disabled even if an accidental flag is set", async () => {
  for (const path of ["/payments/create-order", "/payments/verify", "/payments/webhook"]) {
    const response = await worker.fetch(new Request("https://guard.example" + path, { method: "POST" }), {
      ENABLE_PAYMENTS: "true",
      RAZORPAY_KEY_SECRET: "not-a-real-secret"
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "PAYMENTS_DISABLED");
  }
});

test("health response clearly reports payment processing is disabled", async () => {
  const response = await worker.fetch(new Request("https://guard.example/health"), {});
  const body = await response.json();
  assert.equal(body.paymentsEnabled, false);
});


test("payment create-order stays closed unless explicit enable switch and secrets are configured", async () => {
  const response = await worker.fetch(new Request("https://guard.example/payments/create-order", {
    method:"POST", headers:{"content-type":"application/json"},
    body:JSON.stringify({bookingId:"booking123",accessToken:"a".repeat(64)})
  }), { PAYMENTS_ENABLED:"true" });
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/not fully configured/i);
});

test("payment verification and webhook stay disabled by default", async () => {
  for (const path of ["/payments/verify","/payments/webhook"]) {
    const response=await worker.fetch(new Request("https://guard.example"+path,{
      method:"POST",headers:{"content-type":"application/json"},body:"{}"
    }),{});
    assert.equal(response.status,503);
    assert.equal((await response.json()).code,"PAYMENTS_DISABLED");
  }
});


test("CRM Owner notification fails closed when server credentials are absent", async () => {
  const response=await worker.fetch(new Request("https://guard.example/notifications/crm-lead-created",{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({leadId:"lead_123"})
  }),{});
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/not configured/i);
});

test("Worker CORS allows only the official JameenGhar website origin", async () => {
  const allowed=await worker.fetch(new Request("https://guard.example/health",{headers:{origin:"https://jameenghar.com"}}),{});
  assert.equal(allowed.headers.get("access-control-allow-origin"),"https://jameenghar.com");
  const denied=await worker.fetch(new Request("https://guard.example/health",{headers:{origin:"https://attacker.example"}}),{});
  assert.equal(denied.headers.get("access-control-allow-origin"),null);
  const preflight=await worker.fetch(new Request("https://guard.example/notifications/crm-lead-created",{
    method:"OPTIONS",headers:{origin:"https://jameenghar.com"}
  }),{});
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get("access-control-allow-origin"),"https://jameenghar.com");
});


test("private Daybnb payment status stays closed while payments are disabled", async () => {
  const response=await worker.fetch(new Request("https://guard.example/payments/status",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({bookingId:"booking123",accessToken:"a".repeat(64)})
  }),{});
  assert.equal(response.status,503);
  assert.equal((await response.json()).code,"PAYMENTS_DISABLED");
});

test("private Daybnb payment status requires configured server-side Firebase credentials", async () => {
  const response=await worker.fetch(new Request("https://guard.example/payments/status",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({bookingId:"booking123",accessToken:"a".repeat(64)})
  }),{PAYMENTS_ENABLED:"true"});
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/not fully configured/i);
});
