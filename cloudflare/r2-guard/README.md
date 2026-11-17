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
  declared size <=20 MB, allowed MIME type and matching basic file signature.
  Accepted photos: JPEG, PNG, WEBP. Accepted private documents: PDF.
- Object keys are generated server-side under owner/property paths. Documents are
  served as private attachments; no public bucket URL is returned.
- D1 quota reservation is made before R2 write and stores the unique object key.
  If R2 returns an ambiguous failure, the reservation is retained (not released)
  until reconciliation proves whether the object exists. D1 finalization failure
  also retains the reservation fail-closed.
- **Explicit activation switch:** upload and download return HTTP 503 unless
  `ENABLE_UPLOADS` is exactly `true`. It is not set in `wrangler.toml`.
- Added Worker tests for public health and default-off upload/download/admin paths.
- Added quota tests for exact 9 GB boundary, below-limit reservation, parallel
  reservation pressure, ambiguous reservations, and reservation-to-object commit.
- Added fail-closed Firebase token parsing tests.
- The existing quota helper and D1 migration provide an 8 GB warning, 9 GB
  application stop, and 20 MB per-file limit.

## Not complete / not live

- No R2 bucket or D1 database is bound; no Worker is deployed.
- No Firebase project ID, Owner Admin UID, credentials, or secrets are configured.
- The Worker routes have not yet been integration-tested against a real Firebase
  project, D1 database, or R2 bucket. Only default-off behavior has unit tests.
- Four distinct images and the required document are not yet enforced as a
  complete listing-submission transaction. Uploading individual files is not
  proof that the listing has the required complete set.
- No file malware scanning or deep image/PDF content validation is included.
- No public photo delivery/CDN route exists; public exposure after approval still
  needs a separate, carefully scoped implementation.
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
5. Add a trusted listing-finalization endpoint that verifies four distinct image
   objects plus one required private PDF and atomically marks listing ready for
   Owner review. Until then, do not treat the uploads as a complete listing.
6. Implement owner/admin-only private document access, plus approved/published
   photo delivery without exposing private documents.
7. Reconcile D1 ledger against actual R2 inventory and stop uploads on mismatch.
8. Complete Firestore Emulator and Daybnb/CRM regression tests.
9. Obtain explicit owner approval after the Cloudflare account cost review.

## Deployment

Do not deploy, create/bind Cloudflare resources, set `ENABLE_UPLOADS=true`,
publish Firestore Rules, modify production data, or merge to `main` yet.
