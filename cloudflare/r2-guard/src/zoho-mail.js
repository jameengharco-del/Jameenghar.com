let cachedAccessToken = "";
let cachedTokenExpiresAt = 0;

async function getZohoAccessToken(env, fetchImpl = fetch) {
  if (cachedAccessToken && Date.now() < cachedTokenExpiresAt - 60_000) return cachedAccessToken;
  if (!env.ZOHO_CLIENT_ID || !env.ZOHO_CLIENT_SECRET || !env.ZOHO_REFRESH_TOKEN) {
    throw new Error("Zoho Mail OAuth secrets are not configured");
  }
  const accountsBase = env.ZOHO_ACCOUNTS_BASE || "https://accounts.zoho.in";
  const url = new URL(accountsBase + "/oauth/v2/token");
  url.searchParams.set("refresh_token", env.ZOHO_REFRESH_TOKEN);
  url.searchParams.set("client_id", env.ZOHO_CLIENT_ID);
  url.searchParams.set("client_secret", env.ZOHO_CLIENT_SECRET);
  url.searchParams.set("grant_type", "refresh_token");
  const response = await fetchImpl(url.toString(), { method: "POST" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error("Zoho Mail access token refresh failed");
  cachedAccessToken = body.access_token;
  cachedTokenExpiresAt = Date.now() + Math.max(60, Number(body.expires_in || 3600)) * 1000;
  return cachedAccessToken;
}

export async function sendZohoOwnerNotification({ env, subject, html, fetchImpl = fetch }) {
  const required = ["ZOHO_ACCOUNT_ID", "ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"];
  if (required.some(key => !env[key])) throw new Error("Zoho Mail sender configuration is incomplete");
  const token = await getZohoAccessToken(env, fetchImpl);
  const mailBase = env.ZOHO_MAIL_API_BASE || "https://mail.zoho.in";
  const response = await fetchImpl(
  const mailRoot = mailBase.endsWith("/") ? mailBase.slice(0, -1) : mailBase;
    mailRoot + "/api/accounts/" + encodeURIComponent(env.ZOHO_ACCOUNT_ID) + "/messages",
    {
      method: "POST",
      headers: {
        authorization: "Zoho-oauthtoken " + token,
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        fromAddress: "owner@jameenghar.com",
        toAddress: "owner@jameenghar.com",
        subject: String(subject).slice(0, 180),
        content: html,
        mailFormat: "html",
        askReceipt: "no"
      })
    }
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok || Number(result.status?.code) !== 200) {
    throw new Error("Zoho Mail could not send the Owner notification");
  }
  return { messageId: result.data?.messageId || null };
}
