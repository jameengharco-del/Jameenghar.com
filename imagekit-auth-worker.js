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
  const approvedCrmAllowed = (uploadType === "/smart-proof" || uploadType === "/marketplace-media" || uploadType === "/smart-media-scan") && role === "crm" && status === "approved";
  if ((!isMainAdmin && !ownerAllowed && !approvedCrmAllowed) ||
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
    if (uploadType !== "/property" && uploadType !== "/daybnb" && uploadType !== "/smart-proof" && uploadType !== "/marketplace-media" && requestPath !== "/smart-proof-view" && requestPath !== "/smart-media-scan") {
      return json({ error: "Unknown upload service. Use /property, /daybnb, /marketplace-media or /smart-proof." }, 404, origin);
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405, origin);
    }

    if (requestPath === "/smart-media-scan") {
      const authorization = request.headers.get("Authorization") || "";
      const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
      if (!tokenMatch) return json({ error: "Firebase sign-in is required for audio screening." }, 401, origin);
      if (!env.FIREBASE_API_KEY || !env.AI) return json({ error: "Audio transcription is not configured. Owner must enable the Cloudflare Workers AI binding before seller videos can be accepted." }, 503, origin);
      try {
        await verifyUploadUser(tokenMatch[1], env.FIREBASE_API_KEY, "/smart-media-scan");
        const incoming = await request.formData();
        const audio = incoming.get("audio");
        if (!(audio instanceof File) || !audio.size) return json({ error: "Audio track is missing; the video cannot pass audio screening." }, 400, origin);
        if (audio.size > 15 * 1024 * 1024) return json({ error: "Extracted audio exceeds the screening size limit." }, 413, origin);
        const bytes = new Uint8Array(await audio.arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        }
        const audioBase64 = btoa(binary);
        const result = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: audioBase64 });
        const transcript = String(result.text || "").trim();
        return json({ transcript, screened: true, model: "whisper-large-v3-turbo" }, 200, origin);
      } catch (error) {
        return json({ error: error.message || "Video audio screening failed." }, 502, origin);
      }
    }

    if (requestPath === "/smart-proof-view") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, origin);
      const authorization = request.headers.get("Authorization") || "";
      const authMatch = authorization.match(/^Bearer\s+(.+)$/i);
      if (!authMatch) return json({ error: "Firebase sign-in is required." }, 401, origin);
      if (!env.IMAGEKIT_PRIVATE_KEY || !env.FIREBASE_API_KEY) {
        return json({ error: "Private proof viewer is not configured." }, 503, origin);
      }
      try {
        const user = await verifyUploadUser(authMatch[1], env.FIREBASE_API_KEY, "/smart-proof-view");
        if (user.localId !== "P46WrdzpVWVHVC4t6vqIOYcZfxC3") {
          return json({ error: "Only JameenGhar Owner can view proof documents." }, 403, origin);
        }
        const body = await request.json();
        const fileId = String(body.fileId || "");
        if (!/^[a-zA-Z0-9_-]{8,100}$/.test(fileId)) {
          return json({ error: "Invalid proof document reference." }, 400, origin);
        }
        const detailResponse = await fetch("https://api.imagekit.io/v1/files/" + encodeURIComponent(fileId) + "/details", {
          headers: { "Authorization": "Basic " + btoa(env.IMAGEKIT_PRIVATE_KEY + ":") }
        });
        const details = await detailResponse.json();
        if (!detailResponse.ok || details.isPrivateFile !== true || typeof details.url !== "string") {
          return json({ error: "Private proof document not found or private flag is missing." }, 404, origin);
        }
        const assetUrl = new URL(details.url);
        if (assetUrl.hostname !== "ik.imagekit.io" || !assetUrl.pathname.startsWith("/")) {
          return json({ error: "Unexpected proof document URL." }, 502, origin);
        }
        const endpointPrefix = "/" + assetUrl.pathname.split("/")[1] + "/";
        const relativePath = assetUrl.pathname.slice(endpointPrefix.length) + assetUrl.search;
        const expires = Math.floor(Date.now() / 1000) + 300;
        const key = await crypto.subtle.importKey(
          "raw", new TextEncoder().encode(env.IMAGEKIT_PRIVATE_KEY),
          { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
        );
        const signatureBytes = await crypto.subtle.sign(
          "HMAC", key, new TextEncoder().encode(relativePath + expires)
        );
        const signature = toHex(signatureBytes);
        const signedUrl = details.url + (assetUrl.search ? "&" : "?") + "ik-t=" + expires + "&ik-s=" + signature;
        return json({ signedUrl, expiresAt: expires }, 200, origin);
      } catch (error) {
        return json({ error: error.message || "Could not authorize proof document preview." }, 403, origin);
      }
    }

    const authorization = request.headers.get("Authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return json({ error: "Firebase sign-in is required." }, 401, origin);

    if (!env.IMAGEKIT_PRIVATE_KEY || !env.IMAGEKIT_PUBLIC_KEY || !env.FIREBASE_API_KEY) {
      return json({ error: "Upload service is not configured yet." }, 503, origin);
    }

    try {
      await verifyUploadUser(match[1], env.FIREBASE_API_KEY, uploadType);

      // Proof documents are uploaded through this Worker, not directly from the browser.
      // The Worker forces ImageKit isPrivateFile=true so a client cannot accidentally
      // publish a deed/authorization image by changing a browser upload parameter.
      if (uploadType === "/marketplace-media") {
        const incoming = await request.formData();
        const file = incoming.get("file");
        const folder = String(incoming.get("folder") || "");
        const isVideo = folder === "/smart-matching/properties/videos";
        const isPhoto = folder === "/smart-matching/properties/photos";
        if (!isVideo && !isPhoto) return json({ error: "Invalid property media folder." }, 400, origin);
        if (!(file instanceof File) || !file.size) return json({ error: "Please select a property media file." }, 400, origin);
        const allowed = isVideo
          ? new Set(["video/mp4", "video/webm", "video/quicktime"])
          : new Set(["image/webp", "image/jpeg", "image/png"]);
        if (!allowed.has(file.type)) return json({ error: isVideo ? "Video must be MP4, WebM or MOV." : "Photo must be WebP, JPG or PNG." }, 415, origin);
        const maxBytes = isVideo ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
        if (file.size > maxBytes) return json({ error: isVideo ? "Video must be 10 MB or smaller." : "Each optimized photo must be 5 MB or smaller." }, 413, origin);
        const safeName = (file.name || (isVideo ? "property-video" : "property-photo")).replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
        const uploadForm = new FormData();
        uploadForm.append("file", file, safeName);
        uploadForm.append("fileName", (isVideo ? "video_" : "photo_") + crypto.randomUUID() + "_" + safeName);
        uploadForm.append("folder", folder);
        uploadForm.append("useUniqueFileName", "true");
        const imageKitResponse = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
          method: "POST",
          headers: { "Authorization": "Basic " + btoa(env.IMAGEKIT_PRIVATE_KEY + ":") },
          body: uploadForm
        });
        const imageKitData = await imageKitResponse.json();
        if (!imageKitResponse.ok || !imageKitData.url || !imageKitData.fileId) {
          return json({ error: "Property media upload failed. Please retry." }, 502, origin);
        }
        return json({ url: imageKitData.url, fileId: imageKitData.fileId, filePath: imageKitData.filePath, fileSize: file.size, fileType: file.type }, 200, origin);
      }

      if (uploadType === "/smart-proof") {
        const incoming = await request.formData();
        const file = incoming.get("file");
        if (!(file instanceof File) || !file.size) {
          return json({ error: "Please select a property proof document image." }, 400, origin);
        }
        if (file.size > 8 * 1024 * 1024) {
          return json({ error: "Proof document image must be 8 MB or smaller." }, 413, origin);
        }
        const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
        if (!allowedTypes.has(file.type)) {
          return json({ error: "Proof document must be JPG, PNG or WebP." }, 415, origin);
        }
        const safeName = (file.name || "property-proof").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
        const uploadForm = new FormData();
        uploadForm.append("file", file, safeName);
        uploadForm.append("fileName", "proof_" + crypto.randomUUID() + "_" + safeName);
        uploadForm.append("folder", "/private/property-proofs/");
        uploadForm.append("isPrivateFile", "true");
        uploadForm.append("useUniqueFileName", "true");
        const imageKitResponse = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
          method: "POST",
          headers: { "Authorization": "Basic " + btoa(env.IMAGEKIT_PRIVATE_KEY + ":") },
          body: uploadForm
        });
        const imageKitData = await imageKitResponse.json();
        if (!imageKitResponse.ok || !imageKitData.fileId || !imageKitData.filePath) {
          return json({ error: "Private proof upload failed. Please retry." }, 502, origin);
        }
        return json({
          fileId: imageKitData.fileId,
          filePath: imageKitData.filePath,
          fileType: file.type,
          fileSize: file.size,
          isPrivateFile: imageKitData.isPrivateFile === true
        }, 200, origin);
      }

      const auth = await createImageKitAuth(env.IMAGEKIT_PRIVATE_KEY);
      return json({ ...auth, publicKey: env.IMAGEKIT_PUBLIC_KEY }, 200, origin);
    } catch (error) {
      return json({ error: error.message || "Could not create upload authentication." }, 403, origin);
    }
  }
};
