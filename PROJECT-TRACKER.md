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
- Added `.github/workflows/combined-regression.yml` to run Worker/payment unit tests and syntax-check CRM, Owner Dashboard, Daybnb and guest checkout browser scripts on safe-branch changes. CI result must be checked before treating this regression pass as complete.

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
