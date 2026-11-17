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
