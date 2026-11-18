/**
 * JameenGhar ImageKit upload-auth Worker
 *
 * Deploy as a Cloudflare Worker. Configure these Worker variables/secrets:
 *   IMAGEKIT_PRIVATE_KEY   (Secret)
 *   IMAGEKIT_PUBLIC_KEY    (Variable)
 *   FIREBASE_API_KEY       (Variable; Firebase web API key)
 *
 * Only Firebase Phone-Auth users can receive ImageKit upload credentials.
 * Never put IMAGEKIT_PRIVATE_KEY in GitHub Pages or browser JavaScript.
 */
const ALLOWED_ORIGINS = new Set([
  "https://jameenghar.com",
  "https://www.jameenghar.com"
]);
const FIREBASE_LOOKUP_URL = "https://identitytoolkit.googleapis.com/v1/accounts:lookup";

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

async function verifyFirebasePhoneUser(idToken, apiKey) {
  const response = await fetch(FIREBASE_LOOKUP_URL + "?key=" + encodeURIComponent(apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken })
  });
  if (!response.ok) throw new Error("Firebase authentication could not be verified.");
  const data = await response.json();
  const user = data.users && data.users[0];
  if (!user || !user.localId || !user.phoneNumber || user.disabled) {
    throw new Error("Please verify your mobile number with JameenGhar OTP login first.");
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
      await verifyFirebasePhoneUser(match[1], env.FIREBASE_API_KEY);
      const auth = await createImageKitAuth(env.IMAGEKIT_PRIVATE_KEY);
      return json({ ...auth, publicKey: env.IMAGEKIT_PUBLIC_KEY }, 200, origin);
    } catch (error) {
      return json({ error: error.message || "Could not create upload authentication." }, 401, origin);
    }
  }
};
