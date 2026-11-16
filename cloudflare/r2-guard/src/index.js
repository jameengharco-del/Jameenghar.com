/**
 * JameenGhar R2 Guard — safety-first scaffold.
 *
 * IMPORTANT:
 * - Uploads are deliberately disabled in this first scaffold.
 * - Do not deploy until Firebase token verification, property ownership checks,
 *   quota accounting, and tests have been completed.
 * - Never put Firebase owner UID or credentials in source control.
 */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health check only. It does not reveal secrets or enable storage access.
    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        service: "jameenghar-r2-guard",
        status: "scaffold",
        uploadsEnabled: false
      });
    }

    // Fail closed until authentication, ownership, and quota controls are tested.
    if (url.pathname.startsWith("/upload") ||
        url.pathname.startsWith("/download") ||
        url.pathname.startsWith("/admin")) {
      return json({
        error: "Storage endpoints are not enabled yet.",
        code: "R2_GUARD_NOT_CONFIGURED"
      }, 503);
    }

    return json({ error: "Not found" }, 404);
  }
};
