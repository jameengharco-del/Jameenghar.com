const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let jwksCache = { keys: [], expiresAt: 0 };

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function getJwks() {
  if (Date.now() < jwksCache.expiresAt && jwksCache.keys.length) return jwksCache.keys;
  const response = await fetch(JWKS_URL, { headers: { "accept": "application/json" } });
  if (!response.ok) throw new Error("Firebase signing keys are temporarily unavailable");
  const body = await response.json();
  const cacheControl = response.headers.get("cache-control") || "";
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] || 1800);
  jwksCache = { keys: body.keys || [], expiresAt: Date.now() + Math.min(maxAge, 3600) * 1000 };
  if (!jwksCache.keys.length) throw new Error("Firebase signing keys are unavailable");
  return jwksCache.keys;
}

export async function verifyFirebaseIdToken(token, projectId) {
  if (!token || !projectId) throw new Error("Authentication is not configured");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid bearer token");
  const header = decodeJsonPart(parts[0]);
  const claims = decodeJsonPart(parts[1]);
  if (header.alg !== "RS256" || !header.kid) throw new Error("Unsupported token signature");
  if (claims.aud !== projectId ||
      claims.iss !== `https://securetoken.google.com/${projectId}` ||
      typeof claims.sub !== "string" || !claims.sub ||
      claims.sub.length > 128 ||
      !Number.isFinite(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000) ||
      !Number.isFinite(claims.iat) || claims.iat > Math.floor(Date.now() / 1000) + 60 ||
      !Number.isFinite(claims.auth_time) ||
      claims.auth_time > Math.floor(Date.now() / 1000) + 60) {
    throw new Error("Firebase ID token claims are invalid or expired");
  }
  const jwk = (await getJwks()).find((key) => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) throw new Error("Firebase signing key was not found");
  const publicKey = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1])
  );
  if (!valid) throw new Error("Firebase ID token signature is invalid");
  return claims;
}

function firestoreString(value) {
  return value?.stringValue ?? null;
}

export async function getFirestoreDocument(projectId, token, path) {
  const safePath = path.split("/").map(encodeURIComponent).join("/");
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${safePath}`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" }
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Could not verify the JameenGhar account or property");
  const doc = await response.json();
  return doc.fields || {};
}

export async function authorizeOwnerAndProperty({ projectId, token, claims, propertyId, ownerAdminUid }) {
  const profile = await getFirestoreDocument(projectId, token, `users/${claims.sub}`);
  const role = firestoreString(profile?.role);
  const isAdmin = claims.sub === ownerAdminUid && role === "admin";
  if (!isAdmin && (role !== "property_owner" || claims.email_verified !== true)) {
    throw new Error("A verified JameenGhar property-owner account is required");
  }

  const property = await getFirestoreDocument(projectId, token, `properties/${propertyId}`);
  if (!property) throw new Error("Property record not found");
  const propertyOwner = firestoreString(property.ownerUid);
  const status = firestoreString(property.status);
  const published = property.isPublished?.booleanValue === true;

  if (!isAdmin && propertyOwner !== claims.sub) {
    throw new Error("You do not own this property");
  }
  if (!isAdmin && (status !== "pending" || published)) {
    throw new Error("Uploads are allowed only for your pending, unpublished property");
  }
  return { isAdmin, propertyOwner, status, published };
}
