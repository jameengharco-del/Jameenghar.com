import test from "node:test";
import assert from "node:assert/strict";
import { sendZohoOwnerNotification } from "../src/zoho-mail.js";

test("Zoho notification refreshes OAuth token and sends only from/to the official owner mailbox", async () => {
  const calls=[];
  const env={
    ZOHO_ACCOUNT_ID:"123456789",
    ZOHO_CLIENT_ID:"test-client",
    ZOHO_CLIENT_SECRET:"test-secret",
    ZOHO_REFRESH_TOKEN:"test-refresh",
    ZOHO_ACCOUNTS_BASE:"https://accounts.zoho.in",
    ZOHO_MAIL_API_BASE:"https://mail.zoho.in"
  };
  const result=await sendZohoOwnerNotification({
    env,subject:"New CRM Lead: Test",
    html:"<p>New lead</p>",
    fetchImpl:async(url,options={})=>{
      calls.push({url:String(url),options});
      if(String(url).includes("/oauth/v2/token")) {
        return new Response(JSON.stringify({access_token:"oauth-access-token",expires_in:3600}),{status:200});
      }
      return new Response(JSON.stringify({status:{code:200,description:"success"},data:{messageId:"mail-123"}}),{status:200});
    }
  });
  assert.equal(result.messageId,"mail-123");
  assert.equal(calls.length,2);
  assert.match(calls[0].url,/accounts\.zoho\.in\/oauth\/v2\/token/);
  assert.match(calls[1].url,/mail\.zoho\.in\/api\/accounts\/123456789\/messages/);
  assert.equal(calls[1].options.headers.authorization,"Zoho-oauthtoken oauth-access-token");
  const payload=JSON.parse(calls[1].options.body);
  assert.equal(payload.fromAddress,"owner@jameenghar.com");
  assert.equal(payload.toAddress,"owner@jameenghar.com");
  assert.equal(payload.subject,"New CRM Lead: Test");
});

test("Zoho sender fails closed when OAuth secrets are missing", async () => {
  await assert.rejects(sendZohoOwnerNotification({
    env:{ZOHO_ACCOUNT_ID:"123"},
    subject:"test",html:"test",
    fetchImpl:async()=>{throw new Error("network must not be called")}
  }),/configuration is incomplete/i);
});

test("Zoho sender rejects unsuccessful API responses", async () => {
  const env={ZOHO_ACCOUNT_ID:"123",ZOHO_CLIENT_ID:"id",ZOHO_CLIENT_SECRET:"secret",ZOHO_REFRESH_TOKEN:"refresh"};
  await assert.rejects(sendZohoOwnerNotification({
    env,subject:"test",html:"test",
    fetchImpl:async url=>String(url).includes("/oauth/v2/token")
      ? new Response(JSON.stringify({access_token:"token",expires_in:3600}),{status:200})
      : new Response(JSON.stringify({status:{code:500}}),{status:200})
  }),/could not send/i);
});
