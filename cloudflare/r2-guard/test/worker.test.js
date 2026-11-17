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


test("public photo delivery remains disabled until secure storage activation", async () => {
  const response=await worker.fetch(new Request("https://guard.example/public-photo?key=owners/u/daybnbProperties/p/photo/a"),{
    STORAGE:{get(){throw new Error("must not be called")}},QUOTA_DB:{},FIREBASE_PROJECT_ID:"test-project"
  });
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/not enabled/i);
});

test("public photo route rejects missing or malformed object keys", async () => {
  const response=await worker.fetch(new Request("https://guard.example/public-photo?key=../private.pdf"),{
    ENABLE_UPLOADS:"true",STORAGE:{},QUOTA_DB:{prepare(){return {bind(){return this},async first(){return null}}}},FIREBASE_PROJECT_ID:"test-project"
  });
  assert.equal(response.status,400);
});


test("storage quota status fails closed until the private D1 ledger and Owner identity are configured", async () => {
  const response=await worker.fetch(new Request("https://guard.example/storage/quota"),{});
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/not configured/i);
});


test("Owner private listing-file index is disabled until storage bindings are configured", async () => {
  const response=await worker.fetch(new Request("https://guard.example/admin/listing-files?collection=properties&propertyId=listing123",{
    headers:{authorization:"Bearer invalid"}
  }),{});
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/not configured/i);
});

test("Owner private listing-file index rejects requests without Owner credentials", async () => {
  const response=await worker.fetch(new Request("https://guard.example/admin/listing-files?collection=properties&propertyId=listing123",{
    headers:{authorization:"Bearer invalid"}
  }),{QUOTA_DB:{},FIREBASE_PROJECT_ID:"test-project",OWNER_ADMIN_UID:"owner-uid"});
  assert.equal(response.status,503);
});

import { webcrypto, createHmac } from "node:crypto";
import { sha256Hex } from "../src/payments.js";

let reconciliationKeyMaterial;
async function makeAdminToken(uid = "owner-admin") {
  if (!reconciliationKeyMaterial) reconciliationKeyMaterial = await webcrypto.subtle.generateKey(
    { name:"RSASSA-PKCS1-v1_5", modulusLength:2048, publicExponent:new Uint8Array([1,0,1]), hash:"SHA-256" },
    true, ["sign","verify"]
  );
  const pair = reconciliationKeyMaterial;
  const jwk = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
  jwk.kid = "reconcile-test-key";
  jwk.alg = "RS256";
  jwk.use = "sig";
  const b64 = value => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now()/1000);
  const header = b64({alg:"RS256",kid:jwk.kid,typ:"JWT"});
  const payload = b64({aud:"demo-jameenghar",iss:"https://securetoken.google.com/demo-jameenghar",sub:uid,email:uid+"@example.test",email_verified:true,iat:now,auth_time:now,exp:now+3600});
  const input = header+"."+payload;
  const signature = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5",pair.privateKey,new TextEncoder().encode(input));
  return {token:input+"."+Buffer.from(signature).toString("base64url"),jwk};
}

function reconciliationDb({stored,reserved=[]}) {
  return {prepare(sql) {
    return {bind() { return this; }, async all() {
      return {results:sql.includes("upload_reservations")?reserved:stored};
    }};
  }};
}

test("Owner read-only R2/D1 reconciliation paginates and reports a clean exact inventory", async () => {
  const {token,jwk}=await makeAdminToken();
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async url => {
    if(String(url).includes("securetoken@system.gserviceaccount.com")) return new Response(JSON.stringify({keys:[jwk]}),{headers:{"cache-control":"max-age=60"}});
    if(String(url).includes("/documents/users/owner-admin")) return new Response(JSON.stringify({fields:{role:{stringValue:"admin"}}}));
    throw new Error("Unexpected external request: "+url);
  };
  try {
    let pages=0;
    const env={
      FIREBASE_PROJECT_ID:"demo-jameenghar",OWNER_ADMIN_UID:"owner-admin",
      STORAGE:{async list(options={}) {
        pages++;
        if(!options.cursor) return {objects:[{key:"owners/a/photo/1",size:120}],truncated:true,cursor:"page-2"};
        return {objects:[{key:"owners/a/document/1",size:80}],truncated:false};
      }},
      QUOTA_DB:reconciliationDb({stored:[
        {object_key:"owners/a/photo/1",byte_size:120},
        {object_key:"owners/a/document/1",byte_size:80}
      ]})
    };
    const response=await worker.fetch(new Request("https://guard.example/admin/storage/reconcile",{
      method:"POST",headers:{authorization:"Bearer "+token}
    }),env);
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(pages,2);
    assert.equal(body.readOnly,true);
    assert.equal(body.matched,true);
    assert.equal(body.uploadsMustRemainDisabled,false);
    assert.equal(body.r2Bytes,200);
    assert.equal(body.ledgerBytes,200);
  } finally { globalThis.fetch=originalFetch; }
});

test("R2/D1 reconciliation fails closed and reports orphaned objects and reservations", async () => {
  const {token,jwk}=await makeAdminToken();
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async url => {
    if(String(url).includes("securetoken@system.gserviceaccount.com")) return new Response(JSON.stringify({keys:[jwk]}),{headers:{"cache-control":"max-age=60"}});
    if(String(url).includes("/documents/users/owner-admin")) return new Response(JSON.stringify({fields:{role:{stringValue:"admin"}}}));
    throw new Error("Unexpected external request: "+url);
  };
  try {
    const env={
      FIREBASE_PROJECT_ID:"demo-jameenghar",OWNER_ADMIN_UID:"owner-admin",
      STORAGE:{async list(){return {objects:[{key:"orphan-in-r2",size:500}],truncated:false};}},
      QUOTA_DB:reconciliationDb({stored:[{object_key:"missing-in-r2",byte_size:300}],reserved:[{object_key:"pending",byte_size:100}]})
    };
    const response=await worker.fetch(new Request("https://guard.example/admin/storage/reconcile",{
      method:"POST",headers:{authorization:"Bearer "+token}
    }),env);
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.matched,false);
    assert.equal(body.uploadsMustRemainDisabled,true);
    assert.equal(body.mismatchCounts.missingFromR2,1);
    assert.equal(body.mismatchCounts.missingFromLedger,1);
    assert.equal(body.mismatchCounts.pendingReservations,1);
  } finally { globalThis.fetch=originalFetch; }
});

test("CRM lead notification route authenticates creator and sends escaped Owner email through Zoho", async () => {
  const {token,jwk}=await makeAdminToken("crm-1");
  const servicePair=await webcrypto.subtle.generateKey(
    {name:"RSASSA-PKCS1-v1_5",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},
    true,["sign","verify"]
  );
  const der=new Uint8Array(await webcrypto.subtle.exportKey("pkcs8",servicePair.privateKey));
  let binary="";for(const byte of der)binary+=String.fromCharCode(byte);
  const pem="-----BEGIN PRIVATE KEY-----\\n"+Buffer.from(binary,"binary").toString("base64").match(/.{1,64}/g).join("\\n")+"\\n-----END PRIVATE KEY-----";
  const originalFetch=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async (url,options={})=>{
    const target=String(url);calls.push({url:target,options});
    if(target.includes("securetoken@system.gserviceaccount.com"))return new Response(JSON.stringify({keys:[jwk]}),{headers:{"cache-control":"max-age=60"}});
    if(target==="https://oauth2.googleapis.com/token")return new Response(JSON.stringify({access_token:"firebase-admin-token",expires_in:3600}));
    if(target.includes("/documents/leads/lead_123")&&options.method!=="PATCH")return new Response(JSON.stringify({fields:{
      source:{stringValue:"crm"},createdBy:{stringValue:"crm-1"},customerName:{stringValue:"A <Buyer>"},
      phone:{stringValue:"9876543210"},email:{stringValue:"buyer@example.test"},enquiryType:{stringValue:"buyer"},
      propertyLocation:{stringValue:"Jaipur"},budget:{stringValue:"1 Cr"},createdByName:{stringValue:"Consultant"},
      message:{stringValue:"Need a plot"}
    }}));
    if(target.includes("/documents/leads/lead_123")&&options.method==="PATCH")return new Response(JSON.stringify({name:"lead_123"}));
    if(target.includes("accounts.zoho.in/oauth/v2/token"))return new Response(JSON.stringify({access_token:"zoho-access",expires_in:3600}));
    if(target.includes("mail.zoho.in/api/accounts/123/messages"))return new Response(JSON.stringify({status:{code:200},data:{messageId:"owner-mail-1"}}));
    throw new Error("Unexpected mocked request: "+target);
  };
  try {
    const env={
      FIREBASE_PROJECT_ID:"demo-jameenghar",FIREBASE_CLIENT_EMAIL:"firebase-admin@demo-jameenghar.iam.gserviceaccount.com",FIREBASE_PRIVATE_KEY:pem,
      ZOHO_ACCOUNT_ID:"123",ZOHO_CLIENT_ID:"test-client",ZOHO_CLIENT_SECRET:"test-secret",ZOHO_REFRESH_TOKEN:"test-refresh"
    };
    const response=await worker.fetch(new Request("https://guard.example/notifications/crm-lead-created",{
      method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},
      body:JSON.stringify({leadId:"lead_123"})
    }),env);
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{success:true,notified:true});
    const mailCall=calls.find(x=>x.url.includes("/api/accounts/123/messages"));
    assert.ok(mailCall);
    const mail=JSON.parse(mailCall.options.body);
    assert.equal(mail.fromAddress,"owner@jameenghar.com");
    assert.equal(mail.toAddress,"owner@jameenghar.com");
    assert.match(mail.content,/&lt;Buyer&gt;/);
    assert.ok(calls.some(x=>x.options.method==="PATCH"&&x.url.includes("/documents/leads/lead_123")));
  } finally { globalThis.fetch=originalFetch; }
});

test("Daybnb booking checkout creates one idempotent order and confirms only captured exact INR payment", async () => {
  const accessToken="b".repeat(64);
  const tokenHash=await sha256Hex(accessToken);
  const servicePair=await webcrypto.subtle.generateKey(
    {name:"RSASSA-PKCS1-v1_5",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},
    true,["sign","verify"]
  );
  const der=new Uint8Array(await webcrypto.subtle.exportKey("pkcs8",servicePair.privateKey));
  let binary="";for(const byte of der)binary+=String.fromCharCode(byte);
  const pem="-----BEGIN PRIVATE KEY-----\\n"+Buffer.from(binary,"binary").toString("base64").match(/.{1,64}/g).join("\\n")+"\\n-----END PRIVATE KEY-----";
  const booking={
    paymentAccessTokenHash:tokenHash,bookingStage:"awaiting_payment",paymentStatus:"ready_for_checkout",
    quoteExpiresAt:new Date(Date.now()+60*60*1000).toISOString(),quoteVersion:1,
    totalAmountPaise:125000,currency:"INR",gatewayOrderId:null
  };
  const toFirestore=value=>{
    if(value===null)return {nullValue:null};
    if(typeof value==="number")return {integerValue:String(value)};
    if(typeof value==="boolean")return {booleanValue:value};
    return {stringValue:String(value)};
  };
  const fromFirestore=value=>value.stringValue??(value.integerValue!==undefined?Number(value.integerValue):value.booleanValue??(value.nullValue===null?null:undefined));
  let orderRow=null;
  const db={prepare(sql){
    let args=[];
    return {bind(...values){args=values;return this;},
      async first(){
        if(sql.includes("WHERE idempotency_key"))return orderRow;
        if(sql.includes("WHERE booking_id")&&orderRow?.booking_id===args[0]&&orderRow?.provider_order_id===args[1])return orderRow;
        return null;
      },
      async run(){
        if(sql.startsWith("INSERT OR IGNORE INTO payment_orders")){
          if(orderRow)return {meta:{changes:0}};
          orderRow={idempotency_key:args[0],booking_id:args[1],quote_version:args[2],amount_paise:args[3],currency:args[4],guest_token_hash:args[5],state:"creating"};
          return {meta:{changes:1}};
        }
        if(sql.startsWith("UPDATE payment_orders SET provider_order_id")){
          orderRow.provider_order_id=args[0];orderRow.state="created";return {meta:{changes:1}};
        }
        if(sql.startsWith("UPDATE payment_orders SET state='paid'")){
          orderRow.state="paid";return {meta:{changes:1}};
        }
        return {meta:{changes:1}};
      }
    };
  }};
  const originalFetch=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async (url,options={})=>{
    const target=String(url);calls.push({url:target,options});
    if(target==="https://oauth2.googleapis.com/token")return new Response(JSON.stringify({access_token:"firebase-admin-token",expires_in:3600}));
    if(target.includes("/documents/daybnbBookings/booking_123")&&options.method==="PATCH"){
      const fields=JSON.parse(options.body).fields;
      for(const [key,value] of Object.entries(fields))booking[key]=fromFirestore(value);
      return new Response(JSON.stringify({name:"booking_123"}));
    }
    if(target.includes("/documents/daybnbBookings/booking_123")){
      return new Response(JSON.stringify({fields:Object.fromEntries(Object.entries(booking).map(([k,v])=>[k,toFirestore(v)]))}));
    }
    if(target==="https://api.razorpay.com/v1/orders"&&options.method==="POST"){
      const body=JSON.parse(options.body);
      return new Response(JSON.stringify({id:"order_test_daybnb",amount:body.amount,currency:body.currency,receipt:body.receipt}));
    }
    if(target==="https://api.razorpay.com/v1/payments/pay_test_daybnb"){
      return new Response(JSON.stringify({id:"pay_test_daybnb",order_id:"order_test_daybnb",amount:125000,currency:"INR",status:"captured"}));
    }
    throw new Error("Unexpected mocked request: "+target);
  };
  try{
    const env={
      PAYMENTS_ENABLED:"true",QUOTA_DB:db,FIREBASE_PROJECT_ID:"demo-jameenghar",
      FIREBASE_CLIENT_EMAIL:"firebase-admin@demo-jameenghar.iam.gserviceaccount.com",FIREBASE_PRIVATE_KEY:pem,
      RAZORPAY_KEY_ID:"rzp_test_key",RAZORPAY_KEY_SECRET:"rzp_test_secret"
    };
    const createResponse=await worker.fetch(new Request("https://guard.example/payments/create-order",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({bookingId:"booking_123",accessToken})
    }),env);
    assert.equal(createResponse.status,200);
    const created=await createResponse.json();
    assert.equal(created.orderId,"order_test_daybnb");
    assert.equal(created.amount,125000);
    assert.equal(orderRow.state,"created");
    assert.equal(booking.paymentStatus,"created");

    const signature=createHmac("sha256","rzp_test_secret").update("order_test_daybnb|pay_test_daybnb").digest("hex");
    const verifyResponse=await worker.fetch(new Request("https://guard.example/payments/verify",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({bookingId:"booking_123",accessToken,razorpay_order_id:"order_test_daybnb",razorpay_payment_id:"pay_test_daybnb",razorpay_signature:signature})
    }),env);
    assert.equal(verifyResponse.status,200);
    const verified=await verifyResponse.json();
    assert.equal(verified.paymentStatus,"paid");
    assert.equal(verified.bookingStage,"confirmed");
    assert.equal(orderRow.state,"paid");
    assert.equal(booking.paymentStatus,"paid");
    assert.equal(booking.bookingStage,"confirmed");
    assert.ok(calls.some(x=>x.url==="https://api.razorpay.com/v1/orders"));
    assert.ok(calls.some(x=>x.url==="https://api.razorpay.com/v1/payments/pay_test_daybnb"));
  }finally{globalThis.fetch=originalFetch;}
});
