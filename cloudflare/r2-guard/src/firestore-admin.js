const encoder = new TextEncoder();
let cachedToken = { value: "", expiresAt: 0 };

function base64url(bytes) {
  const data = typeof bytes === "string" ? encoder.encode(bytes) : new Uint8Array(bytes);
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).split("=").join("").split("+").join("-").split("/").join("_");
}

function pemToBytes(pem) {
  const body = pem.replaceAll("-----BEGIN PRIVATE KEY-----", "").replaceAll("-----END PRIVATE KEY-----", "").split(" ").join("").split("\n").join("").split("\r").join("").split("\t").join("");
  const binary = atob(body);
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

async function serviceAccessToken(env, fetchImpl = fetch) {
  if (cachedToken.value && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.value;
  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY || !env.FIREBASE_PROJECT_ID) {
    throw new Error("Firebase server credentials are not configured");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(JSON.stringify({
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsigned = header + "." + claim;
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToBytes(env.FIREBASE_PRIVATE_KEY.split("\\n").join("\n")),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  const assertion = unsigned + "." + base64url(signature);
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error("Firebase server authentication failed");
  cachedToken = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

function encodeValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k,v]) => [k, encodeValue(v)])) } };
}

function decodeValue(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  return null;
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

function firestoreBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
}

export async function getAdminDocument(env, collection, id, fetchImpl = fetch) {
  const token = await serviceAccessToken(env, fetchImpl);
  const response = await fetchImpl(`${firestoreBase(env.FIREBASE_PROJECT_ID)}/${collection}/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" }
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Could not read booking record from Firestore");
  const body = await response.json();
  return { name: body.name, fields: decodeFields(body.fields || {}) };
}

export async function patchAdminDocument(env, collection, id, fields, fetchImpl = fetch) {
  const token = await serviceAccessToken(env, fetchImpl);
  const mask = Object.keys(fields);
  if (!mask.length) throw new Error("No booking fields supplied for update");
  const query = mask.map(key => "updateMask.fieldPaths=" + encodeURIComponent(key)).join("&");
  const response = await fetchImpl(`${firestoreBase(env.FIREBASE_PROJECT_ID)}/${collection}/${encodeURIComponent(id)}?${query}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([key,value]) => [key, encodeValue(value)])) })
  });
  if (!response.ok) throw new Error("Could not update booking record in Firestore");
  return response.json();
}

export { decodeFields, encodeValue, decodeValue };
