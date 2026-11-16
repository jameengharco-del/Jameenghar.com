# JameenGhar R2 Guard — staged rollout

This folder is an isolated scaffold on the `cloudflare-r2-safety` branch.
It does not change the live website, Firebase rules, or the working CRM.

## Current status

- Worker scaffold only.
- Upload, download, and admin storage endpoints return HTTP 503.
- No R2 bucket is bound.
- No files can be uploaded through this Worker.
- No Firebase credentials, owner UID, or secrets are stored in this repository.

## Why uploads are disabled

Before enabling storage, the implementation must verify all of the following:

1. Firebase ID tokens against the correct Firebase project.
2. The authenticated user's role and email-verification state.
3. That the property belongs to that exact user.
4. That the property is in an allowed pending state.
5. At least four valid listing photos and the required private document.
6. Private document access is limited to the owner and JameenGhar Owner Admin.
7. Public photo delivery is allowed only after the listing is approved and published.
8. Quota reservations are atomic and fail closed when limits are reached.
9. Failed and abandoned uploads are reconciled safely.
10. Tests cover forged IDs, cross-owner access, replay, oversized files, and quota races.

## Free-tier and billing warning

Application-side quotas are a safety measure, not a Cloudflare billing hard cap.
Cloudflare usage outside this Worker, metering delays, request patterns, and other
account resources can still create charges. Do not activate paid R2 billing or
deploy this scaffold on the assumption that it guarantees a zero bill.

The intended internal thresholds must remain below the published free allowances
and must be reviewed against current Cloudflare pricing and Durable Objects limits
before deployment. Keep a safety buffer; never configure the app to consume the
entire advertised free allowance.

## Next implementation stages

1. Confirm Firebase Auth and Firestore ownership schema without changing existing CRM.
2. Implement and test token verification and owner/admin authorization.
3. Implement atomic quota accounting and reconciliation.
4. Add a private R2 bucket binding and restricted upload/download routes.
5. Test on the isolated branch and a non-production bucket.
6. Only after explicit review, plan integration with the live property-owner flow.

## Deployment

Do not deploy this scaffold. The storage routes are intentionally disabled.
