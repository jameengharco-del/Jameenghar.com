import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { getAdminDocument, patchAdminDocument } from "../src/firestore-admin.js";

test("Firestore service-account client signs a token and reads/patches booking documents", async () => {
  const pair = await webcrypto.subtle.generateKey(
    { name:"RSASSA-PKCS1-v1_5", modulusLength:2048, publicExponent:new Uint8Array([1,0,1]), hash:"SHA-256" },
    true, ["sign","verify"]
  );
  const der = new Uint8Array(await webcrypto.subtle.exportKey("pkcs8",pair.privateKey));
  let binary=""; for(const byte of der) binary+=String.fromCharCode(byte);
  const b64=btoa(binary), pem="-----BEGIN PRIVATE KEY-----\n"+b64.match(/.{1,64}/g).join("\n")+"\n-----END PRIVATE KEY-----";
  const env={FIREBASE_PROJECT_ID:"test-project",FIREBASE_CLIENT_EMAIL:"firebase-admin@test-project.iam.gserviceaccount.com",FIREBASE_PRIVATE_KEY:pem};
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    calls.push({url:String(url),options});
    if(String(url)==="https://oauth2.googleapis.com/token") return new Response(JSON.stringify({access_token:"test-access-token",expires_in:3600}),{status:200});
    if(options.method==="PATCH") return new Response(JSON.stringify({name:"booking"}),{status:200});
    return new Response(JSON.stringify({name:"booking",fields:{paymentStatus:{stringValue:"ready_for_checkout"},totalAmountPaise:{integerValue:"125000"}}}),{status:200});
  };
  const doc=await getAdminDocument(env,"daybnbBookings","booking_123",fetchImpl);
  assert.equal(doc.fields.paymentStatus,"ready_for_checkout");
  assert.equal(doc.fields.totalAmountPaise,125000);
  await patchAdminDocument(env,"daybnbBookings","booking_123",{paymentStatus:"paid",paidAt:new Date("2026-11-17T00:00:00Z")},fetchImpl);
  const patch=calls.find(call=>call.options.method==="PATCH");
  assert.ok(patch);
  assert.match(patch.url,/updateMask\.fieldPaths=paymentStatus/);
  assert.match(patch.options.body,/"stringValue":"paid"/);
});
