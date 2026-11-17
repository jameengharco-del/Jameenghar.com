# ImageKit Free storage evaluation — JameenGhar / Daybnb

Status: evaluation only; no account, API key, billing method, or production storage has been activated.
Working branch: `cloudflare-r2-safety`

## Decision under test

Evaluate ImageKit's **Forever Free media plan** as an alternative to Cloudflare R2. Do not migrate production or enable either listing upload flow until the checks below pass.

Official plan page (reviewed 2026-11-18): https://imagekit.io/plans/

Published Forever Free media-plan allowances:
- $0/month.
- 3 GB fixed DAM/media-library storage. ImageKit says new uploads stop when this fixed limit is reached.
- 20 GB bandwidth per calendar month. ImageKit says media delivery stops when this monthly limit is reached; allowance resets at the beginning of the calendar month.
- 2 user logins.
- 25 MB maximum image upload and 25 MB maximum raw-file upload.
- 500 monthly purge requests; 500 video units and 650 extension units (not needed by this project).

Official usage behavior: https://imagekit.io/docs/how-pricing-works
- Free-plan bandwidth, video units and extension units reset monthly.
- If a free inclusion is exceeded, the corresponding feature stops; upgrading is required to resume it.
- Storage is a fixed cap rather than a monthly accumulating allowance.

Official basic security docs: https://imagekit.io/docs/media-delivery-basic-security
- Basic security features, including private files, are documented as available on all plans including Free.
- A private resource is only accessible using a valid signed URL or valid named transformation.
- The docs say non-image/video resource types must be marked private. PDFs therefore require explicit private-file handling and a verified authenticated download flow.

## Zero-cost gate

The provider's documented Free-plan hard stops are promising, but they do not by themselves prove that account signup has no payment-method requirement or that the account cannot be upgraded accidentally. During account setup:
1. Select only Forever Free ($0/month); never choose Lite, Pro, DAM Pro, or any paid add-on.
2. If a card/PayPal is requested, or a paid checkout/authorization is shown, stop and ask the Owner before proceeding.
3. Do not enable pay-as-you-go, auto-upgrade, or paid extensions.
4. Recheck the dashboard plan after signup and before entering API keys.
5. Keep a local application quota below provider limits: warning at 2.4 GB and upload hard stop at 2.7 GB (decimal GB). This leaves a safety margin under the provider's 3 GB fixed storage cap.
6. Keep a local monthly delivery budget at 18 GB, stopping public photo delivery before ImageKit's 20 GB plan limit. Private PDF downloads must be included in the traffic accounting or remain on a separate controlled path.
7. Fail closed if usage cannot be read/reconciled. No automatic upgrade or provider-side paid fallback.

Important: application-side counters are safeguards, not proof of provider-side billing caps. Provider usage must be checked from its dashboard/API and reconciled. Never represent the project as absolutely charge-proof until the account's plan and billing controls have been verified.

## Technical validation before migration

### Storage and access
- Upload a test JPG, PNG and WEBP through a server-side API call using a secret stored only in a server environment.
- Upload one test PDF marked private.
- Verify a public approved-listing photo is delivered correctly.
- Verify pending/unpublished listing photos are not publicly retrievable.
- Verify PDF is inaccessible without authorization and is available only through an authenticated, expiring download path.
- Verify wrong-owner and unauthenticated requests are denied.
- Verify private PDF URLs are not placed in public Firestore documents, HTML, logs, or analytics.
- Verify object deletion and quota reconciliation behavior; do not silently lose ledger entries.

### Limits and zero-cost behavior
- Test application warning at 2.4 GB and hard stop at 2.7 GB.
- Test monthly bandwidth guard at 18 GB and stop before the 20 GB provider allowance.
- Confirm provider itself rejects additional media-library uploads at 3 GB and stops delivery at 20 GB.
- Check whether API usage/transformations count against any allowance and disable all unnecessary transformations, AI extensions, video features and purge loops.
- Confirm signup/payment method requirements and no paid plan or overage fallback.
- Confirm account allows the required server-side upload API and private PDF access on Free.

### Project integration
- Preserve the existing D1-style ledger abstraction only if it can reliably reconcile ImageKit file IDs, byte sizes, private flags and deletions.
- Replace R2-specific list/get/put operations with a tested provider adapter; do not simulate R2 APIs over ImageKit.
- Keep all credentials server-side. Never put ImageKit private key in browser HTML or commit it to Git.
- Keep both JameenGhar and Daybnb forms disabled until end-to-end tests pass.
- Run the full CRM + Daybnb regression suite after the adapter is implemented.

## Existing project safeguards to preserve
- Work only on `cloudflare-r2-safety`; do not change `main`.
- Existing per-property rule: 4–10 distinct photos and exactly one official PDF.
- Existing 20 MB per-file application cap (stricter than ImageKit's 25 MB Free limit).
- Owner approval before publication; hide address before approval.
- CRM lead attribution/transfer workflow must not regress.
- Daybnb Razorpay remains a separate payment integration; no payment secrets or live gateway changes as part of storage evaluation.
- No Cloudflare R2 activation, no D1/R2 resource creation, no Worker deployment, no Firebase rule publication, and no production migration as part of this evaluation.

## Go / no-go

GO only after:
- Free plan signup is confirmed without unwanted paid checkout/authorization.
- Private PDF behavior is proven end-to-end.
- Usage counters and hard stops are implemented and tested.
- Provider-side limits and application-side limits are reconciled.
- Full CRM + Daybnb regression suite passes.

Otherwise NO-GO; leave current R2 Worker default-off and keep both listing upload forms fail-closed.
