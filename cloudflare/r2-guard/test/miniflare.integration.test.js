import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { reserveUpload, commitUpload, readQuota, HARD_STOP_BYTES } from "../src/quota.js";

test("real local Miniflare D1 + R2 bindings enforce quota, commit inventory and read back objects", async () => {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('local bindings ready'); } }",
    compatibilityDate: "2026-08-06",
    d1Databases: { QUOTA_DB: "jameenghar-local-quota" },
    r2Buckets: { STORAGE: "jameenghar-local-private-bucket" }
  });
  try {
    const db = await mf.getD1Database("QUOTA_DB");
    const bucket = await mf.getR2Bucket("STORAGE");
    const migration = await readFile(new URL("../migrations/0001_storage_quota.sql", import.meta.url), "utf8");
    const executableMigration = migration.replace(/^\s*--.*$/gm, "").trim();
    for (const statement of executableMigration.split(";").map(sql => sql.trim()).filter(Boolean)) {\n      await db.exec(statement);\n    }

    const bytes = new TextEncoder().encode("local-test-photo-content");
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
    const key = "owners/local/properties/p1/photo/one";
    assert.equal(await reserveUpload(db, {
      reservationId:"local-res-1",objectKey:key,ownerUid:"local-owner",
      propertyId:"properties/p1",objectKind:"photo",byteSize:bytes.byteLength,contentSha256:hash
    }), true);
    await bucket.put(key, bytes, { httpMetadata: { contentType:"image/jpeg" } });
    await commitUpload(db, { reservationId:"local-res-1",objectKey:key });

    const stored = await db.prepare("SELECT object_key, byte_size FROM storage_objects WHERE object_key = ?").bind(key).first();
    const object = await bucket.get(key);
    const listed = await bucket.list({ limit:100 });
    const quota = await readQuota(db);
    assert.equal(stored.object_key,key);
    assert.equal(Number(stored.byte_size),bytes.byteLength);
    assert.equal(object.size,bytes.byteLength);
    assert.ok(listed.objects.some(item=>item.key===key));
    assert.equal(quota.storedBytes,bytes.byteLength);
    assert.equal(quota.reservedBytes,0);

    assert.equal(await reserveUpload(db, {
      reservationId:"local-res-duplicate",objectKey:key+"-duplicate",ownerUid:"local-owner",
      propertyId:"properties/p1",objectKind:"photo",byteSize:bytes.byteLength,contentSha256:hash
    }), false);

    // The local D1 binding uses the same SQL guard as the deployed Worker.
    const nearLimit = await db.prepare("INSERT INTO storage_objects(object_key,owner_uid,property_id,object_kind,byte_size,content_sha256) VALUES(?,?,?,?,?,?)")
      .bind("near-limit","local-owner","properties/p2","photo",HARD_STOP_BYTES-bytes.byteLength,"f".repeat(64)).run();
    assert.equal(nearLimit.meta.changes,1);
    assert.equal((await readQuota(db)).uploadsAllowed,false);
  } finally {
    await mf.dispose();
  }
});
