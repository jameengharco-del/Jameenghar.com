import test from "node:test";
import assert from "node:assert/strict";
import {
  HARD_STOP_BYTES, WARNING_BYTES, MAX_OBJECT_BYTES,
  readQuota, reserveUpload, commitUpload
} from "../src/quota.js";

function fakeD1({ stored = [], reserved = [] } = {}) {
  const state = { stored: [...stored], reserved: [...reserved], lock: Promise.resolve() };
  const prepare = (sql) => {
    let args = [];
    const statement = {
      bind(...values) { args = values; return statement; },
      async first() {
        if (sql.includes("SUM(byte_size)")) {
          return {
            stored_bytes: state.stored.reduce((n, x) => n + x.byte_size, 0),
            reserved_bytes: state.reserved.reduce((n, x) => n + x.byte_size, 0)
          };
        }
        if (sql.includes("FROM upload_reservations WHERE reservation_id")) {
          return state.reserved.find(x => x.reservation_id === args[0]) || null;
        }
        return null;
      },
      async run() {
        const prior = state.lock;
        let release;
        state.lock = new Promise(resolve => { release = resolve; });
        await prior;
        try {
          if (sql.includes("INSERT INTO upload_reservations")) {
            const used = state.stored.reduce((n,x)=>n+x.byte_size,0) +
              state.reserved.reduce((n,x)=>n+x.byte_size,0);
            const [reservation_id, object_key, owner_uid, property_id, object_kind, byte_size, extra, limit, countProperty1, countKind1, maxCount1, countProperty2, countKind2, maxCount2] = args;
            const existingCount = [...state.stored, ...state.reserved].filter(x =>
              x.property_id === property_id && x.object_kind === object_kind
            ).length;
            if (used + extra >= limit || existingCount >= maxCount1 || existingCount >= maxCount2 ||
                countProperty1 !== property_id || countProperty2 !== property_id ||
                countKind1 !== object_kind || countKind2 !== object_kind ||
                state.reserved.some(x=>x.reservation_id===reservation_id)) {
              return { meta: { changes: 0 } };
            }
            state.reserved.push({ reservation_id, object_key, owner_uid, property_id, object_kind, byte_size });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        } finally { release(); }
      }
    };
    return statement;
  };
  return {
    state, prepare,
    async batch(statements) {
      const beforeStored=[...state.stored], beforeReserved=[...state.reserved];
      try {
        const first=statements[0];
        const values=first._args || [];
        // The test adapter captures bindings below through a wrapper.
        if (first._kind !== "insert-object") throw new Error("Unexpected batch");
        state.stored.push(first._row);
        const del=statements[1];
        state.reserved=state.reserved.filter(x=>x.reservation_id!==del._reservationId);
        return [{success:true},{success:true}];
      } catch (e) {
        state.stored=beforeStored; state.reserved=beforeReserved; throw e;
      }
    }
  };
}

// Patch the fake statement batch metadata without relying on D1 internals.
function attachBatchMetadata(db) {
  const originalPrepare=db.prepare;
  db.prepare=(sql)=>{
    const s=originalPrepare(sql);
    const originalBind=s.bind;
    s.bind=(...args)=>{
      originalBind(...args);
      if(sql.includes("INSERT INTO storage_objects")) {
        s._kind="insert-object";
        s._row={object_key:args[0],owner_uid:args[1],property_id:args[2],object_kind:args[3],byte_size:args[4]};
      }
      if(sql.includes("DELETE FROM upload_reservations")) s._reservationId=args[0];
      return s;
    };
    return s;
  };
  return db;
}

test("quota thresholds and per-file cap remain below the storage ceiling", () => {
  assert.equal(WARNING_BYTES, 8_000_000_000);
  assert.equal(HARD_STOP_BYTES, 9_000_000_000);
  assert.equal(MAX_OBJECT_BYTES, 20_000_000);
});

test("reservation is rejected when it would reach the 9 GB stop", async () => {
  const db=fakeD1({stored:[{byte_size:HARD_STOP_BYTES-MAX_OBJECT_BYTES}]});
  const ok=await reserveUpload(db,{reservationId:"r1",objectKey:"k1",ownerUid:"u1",propertyId:"p1",objectKind:"photo",byteSize:MAX_OBJECT_BYTES});
  assert.equal(ok,false);
});

test("reservation is accepted below 9 GB and included in usage", async () => {
  const db=fakeD1({stored:[{byte_size:HARD_STOP_BYTES-MAX_OBJECT_BYTES-1}]});
  const ok=await reserveUpload(db,{reservationId:"r1",objectKey:"k1",ownerUid:"u1",propertyId:"p1",objectKind:"photo",byteSize:MAX_OBJECT_BYTES});
  assert.equal(ok,true);
  const quota=await readQuota(db);
  assert.equal(quota.totalBytes,HARD_STOP_BYTES-1);
});

test("parallel reservations cannot collectively cross the quota", async () => {
  const db=fakeD1({stored:[{byte_size:HARD_STOP_BYTES-15_000_000}]});
  const requests=Array.from({length:10},(_,i)=>reserveUpload(db,{
    reservationId:"r"+i,objectKey:"k"+i,ownerUid:"u1",propertyId:"p1",objectKind:"photo",byteSize:2_000_000
  }));
  const results=await Promise.all(requests);
  assert.equal(results.filter(Boolean).length,7);
  const quota=await readQuota(db);
  assert.ok(quota.totalBytes < HARD_STOP_BYTES);
});

test("ambiguous reservations remain counted until reconciled", async () => {
  const db=fakeD1();
  assert.equal(await reserveUpload(db,{reservationId:"r1",objectKey:"k1",ownerUid:"u1",propertyId:"p1",objectKind:"document",byteSize:1024}),true);
  assert.equal((await readQuota(db)).reservedBytes,1024);
});


test("each property is limited to four photos and one private document", async () => {
  const db=fakeD1();
  for(let i=0;i<4;i++) {
    assert.equal(await reserveUpload(db,{reservationId:"photo"+i,objectKey:"photo-key-"+i,ownerUid:"u1",propertyId:"properties/p1",objectKind:"photo",byteSize:100}),true);
  }
  assert.equal(await reserveUpload(db,{reservationId:"photo5",objectKey:"photo-key-5",ownerUid:"u1",propertyId:"properties/p1",objectKind:"photo",byteSize:100}),false);
  assert.equal(await reserveUpload(db,{reservationId:"doc1",objectKey:"doc-key-1",ownerUid:"u1",propertyId:"properties/p1",objectKind:"document",byteSize:100}),true);
  assert.equal(await reserveUpload(db,{reservationId:"doc2",objectKey:"doc-key-2",ownerUid:"u1",propertyId:"properties/p1",objectKind:"document",byteSize:100}),false);
  assert.equal(await reserveUpload(db,{reservationId:"other-photo",objectKey:"other-photo-key",ownerUid:"u1",propertyId:"properties/p2",objectKind:"photo",byteSize:100}),true);
});

test("commit transfers bytes from reservation to stored object", async () => {
  const db=attachBatchMetadata(fakeD1());
  await reserveUpload(db,{reservationId:"r1",objectKey:"k1",ownerUid:"u1",propertyId:"p1",objectKind:"photo",byteSize:1234});
  await commitUpload(db,{reservationId:"r1",objectKey:"k1"});
  const quota=await readQuota(db);
  assert.equal(quota.storedBytes,1234);
  assert.equal(quota.reservedBytes,0);
});
