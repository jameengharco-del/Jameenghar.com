import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { verifyFirebaseIdToken } from "../src/auth.js";

const projectId = "jameenghar-test-project";
const encoder = new TextEncoder();
const toBase64Url = (bytes) => Buffer.from(bytes).toString("base64url");
const encodeJson = (value) => toBase64Url(encoder.encode(JSON.stringify(value)));

test("Firebase token verification fails closed when project is not configured", async () => {
  await assert.rejects(
    verifyFirebaseIdToken("a.b.c", ""),
    /Authentication is not configured/
  );
});

test("Firebase token verification rejects malformed bearer payloads", async () => {
  await assert.rejects(
    verifyFirebaseIdToken("not-a-jwt", projectId),
    /Invalid bearer token/
  );
});

test("Firebase token verification rejects malformed base64url JSON", async () => {
  await assert.rejects(
    verifyFirebaseIdToken("%%%.%%%.%%%", projectId),
    /Invalid|JSON|base64/i
  );
});

test("Firebase token verifier accepts a correctly signed token for the configured project", async () => {
  const pair = await webcrypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  const publicJwk = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
  publicJwk.kid = "unit-test-key";
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: "RS256", typ: "JWT", kid: "unit-test-key" });
  const claims = encodeJson({
    aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`,
    sub: "test-owner-uid",
    email: "owner@example.test",
    email_verified: true,
    iat: now,
    auth_time: now - 10,
    exp: now + 3500
  });
  const unsigned = header + "." + claims;
  const signature = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, encoder.encode(unsigned));
  const token = unsigned + "." + toBase64Url(signature);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [publicJwk] }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=1800" }
  });
  try {
    const verified = await verifyFirebaseIdToken(token, projectId);
    assert.equal(verified.sub, "test-owner-uid");
    assert.equal(verified.email_verified, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Firebase token verifier rejects an expired token before fetching signing keys", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = [
    encodeJson({ alg: "RS256", kid: "missing" }),
    encodeJson({
      aud: projectId,
      iss: `https://securetoken.google.com/${projectId}`,
      sub: "test-owner-uid",
      iat: now - 4000,
      auth_time: now - 4100,
      exp: now - 1
    }),
    "signature"
  ].join(".");
  await assert.rejects(verifyFirebaseIdToken(token, projectId), /invalid or expired/i);
});

import { authorizeOwnerAndProperty } from "../src/auth.js";

function firestoreMock({ role = "property_owner", ownerUid = "owner-uid", status = "pending", published = false } = {}) {
  return async (url) => {
    const path = new URL(url).pathname;
    let fields;
    if (path.endsWith("/users/owner-uid") || path.endsWith("/users/admin-uid")) {
      fields = { role: { stringValue: path.endsWith("/admin-uid") ? "admin" : role } };
    } else if (path.endsWith("/properties/listing-1") || path.endsWith("/daybnbProperties/listing-1")) {
      fields = {
        ownerUid: { stringValue: ownerUid },
        status: { stringValue: status },
        isPublished: { booleanValue: published }
      };
    } else {
      return new Response("", { status: 404 });
    }
    return new Response(JSON.stringify({ fields }), { status: 200 });
  };
}

test("owner can authorize own pending unpublished JameenGhar listing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = firestoreMock();
  try {
    const result = await authorizeOwnerAndProperty({
      projectId, token: "firebase-token",
      claims: { sub: "owner-uid", email_verified: true },
      propertyId: "listing-1", propertyCollection: "properties", ownerAdminUid: "admin-uid"
    });
    assert.equal(result.propertyOwner, "owner-uid");
    assert.equal(result.published, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("owner cannot authorize another person's property", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = firestoreMock({ ownerUid: "someone-else" });
  try {
    await assert.rejects(authorizeOwnerAndProperty({
      projectId, token: "firebase-token",
      claims: { sub: "owner-uid", email_verified: true },
      propertyId: "listing-1", ownerAdminUid: "admin-uid"
    }), /do not own this property/i);
  } finally { globalThis.fetch = originalFetch; }
});

test("owner cannot upload to an already published listing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = firestoreMock({ published: true, status: "approved" });
  try {
    await assert.rejects(authorizeOwnerAndProperty({
      projectId, token: "firebase-token",
      claims: { sub: "owner-uid", email_verified: true },
      propertyId: "listing-1", ownerAdminUid: "admin-uid"
    }), /pending, unpublished/i);
  } finally { globalThis.fetch = originalFetch; }
});

test("Daybnb listing owner is checked in the Daybnb collection", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = firestoreMock();
  try {
    const result = await authorizeOwnerAndProperty({
      projectId, token: "firebase-token",
      claims: { sub: "owner-uid", email_verified: true },
      propertyId: "listing-1", propertyCollection: "daybnbProperties", ownerAdminUid: "admin-uid"
    });
    assert.equal(result.propertyOwner, "owner-uid");
  } finally { globalThis.fetch = originalFetch; }
});

test("unverified owner email is denied", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = firestoreMock();
  try {
    await assert.rejects(authorizeOwnerAndProperty({
      projectId, token: "firebase-token",
      claims: { sub: "owner-uid", email_verified: false },
      propertyId: "listing-1", ownerAdminUid: "admin-uid"
    }), /verified JameenGhar property-owner/i);
  } finally { globalThis.fetch = originalFetch; }
});


test("property-owner secure upload requires registered Firebase phone claim to match profile", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = firestoreMock();
  try {
    await assert.rejects(authorizeOwnerAndProperty({
      projectId, token: "firebase-token",
      claims: { sub: "owner-uid", email_verified: true, phone_number: "+919876543210" },
      propertyId: "listing-1", ownerAdminUid: "admin-uid"
    }), /verified email and registered mobile/i);
  } finally { globalThis.fetch = originalFetch; }
});

test("property-owner secure upload rejects a different verified mobile number", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = firestoreMock();
  try {
    await assert.rejects(authorizeOwnerAndProperty({
      projectId, token: "firebase-token",
      claims: { sub: "owner-uid", email_verified: true, phone_number: "+919999999999" },
      propertyId: "listing-1", ownerAdminUid: "admin-uid"
    }), /verified email and registered mobile/i);
  } finally { globalThis.fetch = originalFetch; }
});

test("property-owner secure upload accepts matching verified email and registered mobile", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = firestoreMock();
  try {
    const result = await authorizeOwnerAndProperty({
      projectId, token: "firebase-token",
      claims: { sub: "owner-uid", email_verified: true, phone_number: "+919876543210" },
      propertyId: "listing-1", ownerAdminUid: "admin-uid"
    });
    assert.equal(result.propertyOwner, "owner-uid");
  } finally { globalThis.fetch = originalFetch; }
});
