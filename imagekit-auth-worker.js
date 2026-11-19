/**
 * JameenGhar ImageKit upload-auth Worker
 *
 * Required Cloudflare variables/secrets:
 *   IMAGEKIT_PRIVATE_KEY   (Secret)
 *   IMAGEKIT_PUBLIC_KEY    (Variable)
 *   FIREBASE_API_KEY       (Variable)
 *
 * Separate upload policies:
 *   /property - email-verified approved owner, or fixed main admin.
 *   /daybnb   - email-verified owner not rejected, or fixed main admin.
 * The main admin is recognized by its fixed UID plus admin role.
 * Never put IMAGEKIT_PRIVATE_KEY in browser JavaScript or GitHub Pages.
 */
const ALLOWED_ORIGINS = new Set([
  "https://jameenghar.com",
  "https://www.jameenghar.com"
]);
const FIREBASE_LOOKUP_URL = "https://identitytoolkit.googleapis.com/v1/accounts:lookup";
const FIRESTORE_DOCUMENT_URL =
  "https://firestore.googleapis.com/v1/projects/jameenghar-ffdfd/databases/(default)/documents/users/";

function json(data, status, origin) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyUploadUser(idToken, apiKey, uploadType) {
  const identityResponse = await fetch(FIREBASE_LOOKUP_URL + "?key=" + encodeURIComponent(apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken })
  });
  if (!identityResponse.ok) throw new Error("Firebase sign-in could not be verified.");

  const identityData = await identityResponse.json();
  const user = identityData.users && identityData.users[0];
  if (!user || !user.localId || user.disabled || user.emailVerified !== true || !user.email) {
    throw new Error("Please sign in with a verified email address.");
  }

  const profileResponse = await fetch(
    FIRESTORE_DOCUMENT_URL + encodeURIComponent(user.localId),
    { headers: { "Authorization": "Bearer " + idToken } }
  );
  if (!profileResponse.ok) {
    throw new Error("Owner profile not found. Please contact JameenGhar for approval.");
  }

  const profileDocument = await profileResponse.json();
  const fields = profileDocument.fields || {};
  const role = fields.role && fields.role.stringValue;
  const status = fields.status && fields.status.stringValue;
  const profileEmail = fields.email && fields.email.stringValue;

  const isMainAdmin = user.localId === "P46WrdpzVWVHVC4t6vqIOYcZfxC3" && role === "admin";
  const ownerAllowed = role === "owner" && (
    uploadType === "/property" ? status === "approved" : status !== "rejected"
  );
  if ((!isMainAdmin && !ownerAllowed) ||
      !profileEmail || profileEmail.toLowerCase() !== user.email.toLowerCase()) {
    throw new Error(uploadType === "/property"
      ? "Property photo uploads require an email-verified, approved JameenGhar owner."
      : "Daybnb photo uploads require an email-verified owner account that is not rejected.");
  }
  return user;
}

async function createImageKitAuth(privateKey) {
  const token = crypto.randomUUID();
  const expire = Math.floor(Date.now() / 1000) + 60 * 60;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(privateKey),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(token + expire)
  );
  return { token, expire, signature: toHex(signatureBytes) };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      if (!ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin"
        }
      });
    }

    if (!ALLOWED_ORIGINS.has(origin)) {
      return json({ error: "Origin not allowed." }, 403, "");
    }
    const requestPath = new URL(request.url).pathname;
    // Keep the legacy root endpoint working until both website clients use explicit routes.
    const uploadType = requestPath === "/" ? "/daybnb" : requestPath;
    if (uploadType !== "/property" && uploadType !== "/daybnb") {
      return json({ error: "Unknown upload service. Use /property or /daybnb." }, 404, origin);
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405, origin);
    }

    const authorization = request.headers.get("Authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return json({ error: "Firebase sign-in is required." }, 401, origin);

    if (!env.IMAGEKIT_PRIVATE_KEY || !env.IMAGEKIT_PUBLIC_KEY || !env.FIREBASE_API_KEY) {
      return json({ error: "Upload service is not configured yet." }, 503, origin);
    }

    try {
      await verifyUploadUser(match[1], env.FIREBASE_API_KEY, uploadType);
      const auth = await createImageKitAuth(env.IMAGEKIT_PRIVATE_KEY);
      return json({ ...auth, publicKey: env.IMAGEKIT_PUBLIC_KEY }, 200, origin);
    } catch (error) {
      return json({ error: error.message || "Could not create upload authentication." }, 403, origin);
    }
  }
};
