# JameenGhar R2 Guard — staged, zero-paid-service design

This folder is isolated on `cloudflare-r2-safety`. It does not change the live website,
Firebase rules, production data, or the working CRM.

## Current implementation status

- Worker remains a health-check-only scaffold.
- `/upload`, `/download`, and `/admin` remain disabled and return HTTP 503.
- No R2 bucket binding exists; no upload can occur through this Worker.
- A D1 quota-ledger migration and atomic quota helper have been added, but are not
  connected to the Worker and have not been deployed or integration-tested.
- Quota constants: warning at 8,000,000,000 bytes; reject new reservations at
  9,000,000,000 bytes; maximum object size 20,000,000 bytes.
- D1 schema records stored objects and pending reservations. A reservation must
  happen before any object write. A successful R2 write must be finalized in a
  D1 transaction. Uncertain failures must keep the reservation until reconciled.

## Cost guardrails

The intended design uses Cloudflare Workers Free, D1 Free, and R2 Standard only.
Current published free allowances include R2 Standard 10 GB-month, 1 million
Class A requests/month, and 10 million Class B requests/month. D1 Free includes
5 million rows read/day, 100,000 rows written/day, and 5 GB total storage.
Workers Free includes 100,000 requests/day. These are usage allowances, not
guarantees that the account cannot be charged.

The 9 GB application quota is deliberately below R2's 10 GB-month allowance.
It is an application-level limit, NOT a provider-enforced billing cap. Other
buckets, other applications, operations beyond free allowances, storage billing
rounding, delayed metering, or changes to Cloudflare account settings may still
cause charges. Never promise a guaranteed ₹0 bill from this guard alone.

Before any activation:
1. Confirm the Cloudflare account is on Workers Free and has no paid add-ons.
2. Confirm R2 Standard only and check the account-wide usage across all buckets.
3. Configure the strongest available account spending controls/alerts and verify
   their exact scope; do not assume a spending limit covers R2.
4. Keep this bucket private. All writes must pass through the authenticated Worker.
5. Verify the bucket is not writable by browser credentials, public APIs, or any
   other Worker.
6. Enforce 8 GB warning and 9 GB hard application stop using atomic reservations.
7. Reconcile the ledger against actual R2 object inventory before reopening uploads.
8. Test free-tier exhaustion paths: fail closed; never auto-upgrade or create paid
   resources. If a free limit is reached, uploads stop until the free quota resets
   or an Owner manually reviews the issue. Never prompt/perform an upgrade.

## Security work still required before enabling uploads

1. Verify Firebase ID tokens against the exact Firebase project.
2. Require the correct verified owner role and validate the exact property owner.
3. Enforce pending listing state, at least four image files, and required private
   official property document.
4. Keep documents private to that owner and Owner Admin; expose photos only after
   approval and publication.
5. Bind the private R2 bucket and D1 database only after tests pass.
6. Implement upload size/content checks, unique server-generated object keys,
   authorization, safe deletion, idempotency, and reconciliation.
7. Add automated tests for forged tokens/IDs, cross-owner access, replay, file
   size/type, quota boundary, simultaneous reservations, R2 failure, D1 failure,
   and storage-ledger reconciliation.

## Deployment

Do not deploy this scaffold or create/bind Cloudflare resources yet. Do not modify
production Firestore rules or merge to `main`. The current implementation is
preparatory code only; storage is not live.
