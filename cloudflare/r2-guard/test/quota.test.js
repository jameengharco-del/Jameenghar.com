import test from "node:test";
import assert from "node:assert/strict";
import {
  HARD_STOP_BYTES, WARNING_BYTES, MAX_OBJECT_BYTES
} from "../src/quota.js";

test("quota thresholds are fixed below 10 GB", () => {
  assert.equal(WARNING_BYTES, 8_000_000_000);
  assert.equal(HARD_STOP_BYTES, 9_000_000_000);
  assert.ok(HARD_STOP_BYTES < 10_000_000_000);
});

test("individual uploads are capped at 20 MB", () => {
  assert.equal(MAX_OBJECT_BYTES, 20_000_000);
  assert.ok(MAX_OBJECT_BYTES < HARD_STOP_BYTES);
});
