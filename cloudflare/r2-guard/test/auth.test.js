import test from "node:test";
import assert from "node:assert/strict";
import { verifyFirebaseIdToken } from "../src/auth.js";

test("Firebase token verification fails closed when project is not configured", async () => {
  await assert.rejects(
    verifyFirebaseIdToken("a.b.c", ""),
    /Authentication is not configured/
  );
});

test("Firebase token verification rejects malformed bearer payloads", async () => {
  await assert.rejects(
    verifyFirebaseIdToken("not-a-jwt", "jameenghar"),
    /Invalid bearer token/
  );
});

test("Firebase token verification rejects malformed base64url JSON", async () => {
  await assert.rejects(
    verifyFirebaseIdToken("%%% .%%% .%%%".replaceAll(" ", ""), "jameenghar"),
    /Invalid|JSON|base64/i
  );
});
