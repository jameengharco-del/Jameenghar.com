# JameenGhar R2 Guard — staged, default-off secure storage

This implementation is isolated on `cloudflare-r2-safety`. It does not change
the live website, Firebase rules, production data, or the working CRM.

## Current code status (not deployed)

- Firebase ID token verification is implemented in `src/auth.js` using Google's
  Firebase Secure Token signing keys and RS256 signature verification.
- Owner authorization checks the Firebase `users/{uid}` profile, verified email,
  `property_owner` role, exact property `ownerUid`, pending state and unpublished
  status. The configured Owner Admin UID + admin role is separately recognized.
- `src/index.js` now contains staged POST `/upload` and GET `/download` routes.
- Uploads require bearer authentication, a pending property owned by the caller,
  a streamed body capped at 20 MB even when Content-Length is absent, allowed MIME
  type and matching basic file signature. Supported listing collections are
  JameenGhar `properties` and Daybnb `daybnbProperties`.
  Accepted photos: JPEG, PNG, WEBP. Accepted private documents: PDF.
- Object keys are generated server-side under owner/property paths. Documents are
  served as private attachments; no public bucket URL is returned.
- D1 quota reservation is made before R2 write and stores the unique object key.
  If R2 returns an ambiguous failure, the reservation is retained (not released)
  until reconciliation proves whether the object exists. D1 finalization failure
  also retains the reservation fail-closed.
- Added POST `/finalize` to count four distinct photo objects and at least one
  private PDF for the exact owner/listing. It only reports readiness; Owner review
  and publication remain separate manual approval steps.
- **Explicit activation switch:** upload, download and finalize return HTTP 503 unless
  `ENABLE_UPLOADS` is exactly `true`. It is not set in `wrangler.toml`.
- Added Worker tests for public health and default-off upload/download/admin paths.
- Added quota tests for exact 9 GB boundary, below-limit reservation, parallel
  reservation pressure, ambiguous reservations, and reservation-to-object commit.
- Added fail-closed Firebase token parsing tests and generated-RSA-key JWT tests
  for valid signatures and expired claims.
- Added mocked-Firestore authorization tests for owner isolation, email verification,
  pending/unpublished state, and Daybnb collection selection. These are unit tests,
  not tests against the live Firebase project.
- The existing quota helper and D1 migration provide an 8 GB warning, 9 GB
  application stop, and 20 MB per-file limit.

## Not complete / not live

- No R2 bucket or D1 database is bound; no Worker is deployed.
- No Firebase project ID, Owner Admin UID, credentials, or secrets are configured.
- The Worker routes have not yet been integration-tested against a real Firebase
  project, D1 database, or R2 bucket. Only default-off behavior has unit tests.
- The finalize endpoint checks the inventory ledger for four distinct photos and
  one PDF. It has not yet been integrated into either owner-facing form, and does
  not itself update the Firestore listing status or notify the Owner.
- No file malware scanning or deep image/PDF content validation is included.
- Daybnb payment architecture is documented in `DAYBNB-PAYMENT-ARCHITECTURE.md`.
- Added server-side Firestore service-account REST access (`firestore-admin.js`) with short-lived signed OAuth assertions; private key is read only from Worker secrets and is not committed.
- Added POST `/payments/create-order`, `/payments/verify` and `/payments/webhook` handlers. They are gated by `PAYMENTS_ENABLED=true` and required secrets/bindings; they are not deployed or enabled.
- Payment orders use the D1 idempotency ledger (unique booking + quote version) to prevent duplicate order creation on retries. Webhook event IDs are recorded to reject replay.
- Guest booking submissions now receive a random private access token; only its SHA-256 hash is stored on the booking. `daybnb-payment.html` is a guest checkout page scaffold; the Worker URL is intentionally blank until safe deployment.
- Booking records now carry explicit payment lifecycle placeholders; server-side
  payment helpers verify Razorpay checkout/webhook HMACs and exact captured INR
  amounts. These helpers are unit-tested but are not wired to a live gateway.
- Payment routes are default-off and require the exact `PAYMENTS_ENABLED=true` switch,
  the server secrets and D1 binding. No gateway credentials, merchant account,
  D1 binding, Worker deployment or checkout activation is configured.
- Public photo delivery is staged and scoped to approved/published listings only;
  no public bucket URL or private document route is exposed.
- A scheduled inventory reconciliation/repair workflow is not yet implemented.
- Admin deletion/reconciliation routes remain disabled.

## Cost guardrails

Intended resources: Workers Free, D1 Free, R2 Standard only. The 9 GB limit is an
application-level stop, not a provider-enforced billing cap. Other buckets,
other apps, operations beyond free allowances, metering/billing rules, or account
plan changes can still cause charges.

Before activation, verify the account plan, all account-wide R2 usage, all other
Cloudflare resources, billing settings, paid add-ons and the precise scope of
spending controls. Never auto-upgrade or create paid resources. If anything is
unclear, leave uploads disabled.

## Required before activation

1. Finish and run quota tests including concurrent reservations, duplicate commit,
   D1 outage, R2 failure, quota boundary, stale reservation and inventory mismatch.
2. Add integration tests for real Firebase token verification and Firestore owner
   checks, including forged tokens, expired tokens, unverified email, wrong role,
   cross-owner property, non-pending and published listings.
3. Ensure the D1 schema is applied to a new dedicated free-tier database only.
4. Verify every R2 write path is exclusively this Worker; keep bucket private.
5. Integrate the staged finalize endpoint into both owner-facing forms and add a
   server-side, tested Firestore state transition to Owner review. Until that is
   complete, do not treat uploads as a submitted listing.
6. Implement owner/admin-only private document access, plus approved/published
   photo delivery without exposing private documents.
7. Reconcile D1 ledger against actual R2 inventory and stop uploads on mismatch.
8. Complete Firestore Emulator and Daybnb/CRM regression tests.
9. Obtain explicit owner approval after the Cloudflare account cost review.

## Deployment

Do not deploy, create/bind Cloudflare resources, set `ENABLE_UPLOADS=true`,
publish Firestore Rules, modify production data, or merge to `main` yet.
