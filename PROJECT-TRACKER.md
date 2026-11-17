# JameenGhar.com — Combined Project Tracker

Updated: 2026-11-17  
Working branch: `cloudflare-r2-safety`  
Production branch: `main` (protected; do not change without explicit approval)

## Track A — Core JameenGhar

### Existing flow to preserve
- Website buyer, seller/landlord and home-loan enquiry forms write to Firestore `leads`.
- Owner CRM has Created Leads reporting, assignment/reassignment/transfer, consultant follow-up/status and activity history.
- Original consultant-created lead attribution remains visible to Owner after transfer; the original creator retains a read-only Created Leads record after transfer, while the new assignee sees the lead as a normal assigned lead without prior consultant identity exposed.
- Existing JameenGhar logo and green/orange branding must remain.

### Remaining core work
1. End-to-end test buyer, seller/landlord and home-loan website enquiry capture.
2. Test Owner assignment → consultant view → follow-up/status → transfer → new assignee view → Owner Created Leads report.
3. Implement secure notification to `owner@jameenghar.com` using a trusted server-side email service; never expose SMTP/API credentials in browser code.
4. Replace seller/landlord enquiry-only form with full verified property-owner submission while retaining existing enquiry capture until replacement passes tests.
5. Enforce owner OTP, official document upload, minimum four property images, hidden address before approval, pending/unpublished status, and Owner-only approval.

### CRM Owner email notification — staged, not live
- Added a server-only Zoho Mail API sender using OAuth refresh-token flow. It sends from/to the official `owner@jameenghar.com` mailbox; OAuth secrets and account ID are Worker secrets, never browser code.
- Added authenticated `POST /notifications/crm-lead-created`: Firebase ID token is verified, Worker re-reads the Firestore lead using server credentials, and only the original creator can request a notification for their own CRM lead. Successful sends are marked on the lead to avoid repeat notices.
- CRM consultant lead creation now calls the staged endpoint when `CRM_NOTIFICATION_WORKER_URL` is configured; it never rolls back a saved lead if email delivery fails.
- Zoho API OAuth and send-mail tests were added. Required Zoho OAuth scope: `ZohoMail.messages.CREATE` (or `ZohoMail.messages.ALL`). Account ID, client ID, client secret and refresh token still need to be added as Worker secrets. Worker is not deployed and the CRM Worker URL remains blank, so email delivery is not yet live.
- API implementation follows Zoho's official India data-centre API docs: `https://mail.zoho.in/api/accounts/{accountId}/messages`.

### Latest CRM consultant queue correction (2026-11-17)
- Corrected the consultant active follow-up queue to include only leads currently assigned to that consultant. Leads they originally created but the Owner later transferred away remain visible in their read-only Created Leads record, but no longer appear as active work/follow-ups.
- The receiving consultant continues to see the transferred lead in their normal assigned/New Leads view, without the previous creator's identity; Owner retains transfer history and original attribution.

## Track B — Daybnb

### Safe-branch code present
- Daybnb entry card inside central Owner Dashboard and a linked Daybnb Dashboard module.
- Daybnb owner email/password registration and login; email verification and Firebase phone OTP flow.
- Shared `property_owner` profile and owner UID on paired public/private listing documents.
- Pending/unpublished listing submission and admin approve/reject/publish controls.
- Booking types normalized to `hourly`, `day`, `overnight`; guest booking remains public with Firestore validation.

### Daybnb payment work — staged, not live
- Updated new booking records with `currency=INR`, `paymentStatus=not_started`, payment/refund placeholders and `bookingStage=awaiting_owner_confirmation`.
- Booking confirmation message now states that a secure payment link follows Owner availability/price confirmation; a request is not yet a confirmed reservation.
- Added `DAYBNB-PAYMENT-ARCHITECTURE.md` covering Owner-confirmed quotes, integer paise, hosted checkout, server-side order creation, webhook/signature validation, idempotency, refunds and Owner payment reporting.
- Added Razorpay checkout/webhook HMAC verification helpers, captured-INR amount checks, server-only order-creation helper and strict integer-paise/quote-version validation with unit tests.
- Locked commercial rule: ₹0 setup/monthly/subscription/AMC/minimum commitment, no paid add-ons or instant settlement. Recommended Razorpay Standard Gateway at published standard domestic 2% + GST per successful payment (premium methods may cost more); no live activation until merchant-specific terms are confirmed.
- Cashfree limited 0% offer is not used as default: its current T&Cs show a new-signup cutoff already passed (31 July 2026), and Cashfree may charge ₹199 KYC where merchant has no valid GST registration.
- Server-side `/payments/create-order`, `/payments/verify` and `/payments/webhook` handlers are staged behind `PAYMENTS_ENABLED=true` and required secrets/D1 binding. No gateway account, credentials, D1 binding, Worker deployment or live charge is configured; the guest checkout page's Worker URL remains blank.
- Added unit tests for valid/tampered checkout signatures, exact-raw-body webhook HMAC, captured INR amount/currency checks, payment route default-off behavior, integer-paise quote validation and server-side order payload/response validation. GitHub Actions run #44116566736 passed.
- Initial India gateway recommendation: Razorpay Standard Checkout, subject to merchant KYC, current fee review and explicit Owner approval; provider adapter can be switched after comparison.

### Remaining Daybnb launch work
1. Configure Firebase Phone provider, authorized domain, reCAPTCHA and test OTP on the actual domain.
2. Run Firestore Emulator tests for signed-out, unverified, wrong-owner, verified-owner and Owner Admin access.
3. Implement trusted upload for required property images and official documents. Current form has no file-upload control/backend; URL fields alone do not verify files.
   - Progress: Daybnb now requires one cover photo plus at least three distinct additional photo URLs (four total) in the form and proposed Firestore validation. This is URL validation only, not secure upload or document verification.
4. Enforce minimum four images and required official document before submission/approval.
5. Test owner isolation, atomic paired writes, approval/rejection, publish/unpublish and guest bookings.

### Latest Daybnb guest checkout and rule alignment (2026-11-17)
- Added private `POST /payments/status` endpoint: validates the booking's private token hash and returns only the payment/quote status, amount and expiry. It is disabled unless the payment activation gate and server-side Firebase credentials are configured.
- Guest payment page now checks the private booking status before enabling checkout, displays the Owner-approved quote/expiry, and avoids creating an order until the quote is ready. A verified paid booking is shown as confirmed when the guest revisits the link.
- Updated proposed Firestore booking-create validation to allow exactly the new payment lifecycle fields and a SHA-256 private access-token hash, with safe initial values (`not_started`, INR, no order/payment). This is proposed only; it is NOT published.
- Updated Owner Dashboard copy so quote approval is clearly not a charge and checkout is not live until deployment.
- Combined GitHub Actions regression checks passed after payment-status endpoint and private checkout changes (runs #44129209262 and #44129179449). Latest Firestore-rule edit is awaiting its own CI result.

### Latest Daybnb secure upload integration (2026-11-17)
- Replaced external image-link fields in the safe-branch Daybnb owner form with real file inputs: cover photo, exactly three additional distinct photos, and one official PDF. Browser validates MIME, 20 MB maximum per file and SHA-256 duplicate-photo hashes.
- Submission creates paired pending/unpublished public/private listing documents, then uploads sequentially to the staged Worker using the verified Firebase ID token. It calls `/finalize` with the selected photo keys only after the cover, three extra photos and private PDF upload.
- Worker finalization verifies the selected four photo objects and a private PDF against the quota ledger, then writes R2 object keys to the Daybnb listing via server-side Firestore credentials. Listing remains pending and unpublished.
- Added `GET /public-photo`, which serves only image objects belonging to Firestore listings with `status=approved` and `isPublished=true`. Private PDF documents are never served by this route. Daybnb gallery resolves stored object keys through this endpoint.
- Added tests for public photo route default-off behavior and unsafe object-key rejection.
- **Not live:** upload Worker URL constants remain blank, R2/D1 bindings and secrets are absent, `ENABLE_UPLOADS` remains off. The Daybnb upload form intentionally refuses to create a listing until the verified Worker endpoint is configured. No live storage upload has been made.
- Main JameenGhar property-owner submission form still needs this secure upload integration. Daybnb actual Firebase/Cloudflare integration tests and admin private-document retrieval remain outstanding.

## Track C — Secure storage / zero-cost gate

### Implemented on safe branch (not deployed)
- Added D1 quota-ledger schema for stored objects and pending upload reservations.
- Added quota helper with 8 GB warning, 9 GB hard application stop, and 20 MB per-object maximum.
- Added quota tests for 9 GB boundary, below-limit reservations, parallel reservations, ambiguous R2 outcomes and reservation-to-object commit.
- Added staged Firebase ID-token verification and owner/property authorization module.
- Added private upload/download route code with bounded 20 MB streaming body, MIME/signature checks, server-generated keys, and D1 reservation flow.
- Added listing authorization for both `properties` and `daybnbProperties` collections.
- Added a default-off `/finalize` endpoint that checks four distinct photos plus one private PDF against the quota ledger for the exact property owner.
- Changed ambiguous R2 write failures to retain quota reservations until reconciliation; each reservation now stores its object key.
- Added Firebase token parsing/fail-closed tests plus a generated RSA key test for valid/expired JWTs.
- Added Firestore-mocked tests for owner isolation, verified email, pending/unpublished state, and Daybnb collection authorization.
- Added an explicit `ENABLE_UPLOADS=true` gate; absent by default, so endpoints stay HTTP 503 even if bindings are later added accidentally.
- Added Worker endpoint tests and GitHub Actions CI; latest authentication/owner-isolation test job completed its Node test step successfully (run #44110697503).
- Added `ACTIVATION-CHECKLIST.md` documenting free-plan, account-wide usage, spending-limit scope, private bucket and fail-closed requirements.
- Worker endpoints remain disabled (HTTP 503) unless the explicit gate is set; no R2 bucket or D1 database is bound and no Worker is deployed.

### Must complete before any activation
1. Add real D1/SQLite integration tests for concurrent reservations, transaction rollback, duplicate commit, and reconciliation; current concurrency tests use a deterministic D1 test adapter.
2. Integrate the staged upload/finalize routes with both owner-facing forms only after Worker is deployed and the activation gate is cleared.
2. Implement Firebase token verification, verified-owner/Owner-Admin authorization and exact property ownership checks.
3. Integrate private R2 + D1 bindings only after confirming the account remains on free plans.
4. Review account-wide R2 usage, operation limits and any other Cloudflare resources; 9 GB app quota is not a provider billing hard cap.
5. Confirm no paid add-ons, no automatic upgrades, and available account spending controls/alerts (including whether they cover R2).
6. Keep uploads fail-closed on any quota/database/account uncertainty. Do not deploy until reviewed.

### Latest combined progress (2026-11-17)
- Corrected CRM consultant Created Leads behavior: a creator can still see their own originally created lead after Owner assignment/transfer, as a read-only creator record. Current assignee receives it in their New Leads/assigned queue; prior creator identity remains hidden from the receiving consultant. Activity history remains visible with prior consultant identities masked in the receiving consultant UI.
- Updated the proposed Firestore rules to permit original creator read-only access to the lead and its activity history after transfer; consultant follow-up writes remain limited to current assigned owner/unassigned creator rules. Rules are proposed only and NOT published.
- Added `.github/workflows/combined-regression.yml` to run Worker/payment unit tests and syntax-check CRM, Owner Dashboard, Daybnb and guest checkout browser scripts on safe-branch changes. Latest combined regression run #44124883657 completed successfully (unit tests + browser-script syntax checks).

## Work order — keep both tracks active
1. Protect and test the core website enquiry + CRM assignment/transfer flow.
2. Finish Daybnb auth/security and trusted upload.
3. Finish normal property-owner submission and verification.
4. Run combined regression tests; request explicit production approval only after tests pass.

## Safety
- Work only on `cloudflare-r2-safety` until production deployment is explicitly approved.
- Never publish Firestore Rules, change live Firebase data, activate R2/Workers, or merge to `main` without explicit approval.
- Safe-branch code is not live functionality; do not claim otherwise.
- Do not regress the existing JameenGhar CRM to deliver Daybnb.
