# JameenGhar.com — Combined Project Tracker

Updated: 2026-11-17  
Working branch: `cloudflare-r2-safety`  
Production branch: `main` (protected; do not change without explicit approval)

## Track A — Core JameenGhar

### Existing flow to preserve
- Website buyer, seller/landlord and home-loan enquiry forms write to Firestore `leads`.
- Owner CRM has Created Leads reporting, assignment/reassignment/transfer, consultant follow-up/status and activity history.
- Original consultant-created lead attribution remains visible to Owner after transfer; new assignee sees the lead as their assigned lead without prior consultant identity exposed.
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

### Remaining Daybnb launch work
1. Configure Firebase Phone provider, authorized domain, reCAPTCHA and test OTP on the actual domain.
2. Run Firestore Emulator tests for signed-out, unverified, wrong-owner, verified-owner and Owner Admin access.
3. Implement trusted upload for required property images and official documents. Current form has no file-upload control/backend; URL fields alone do not verify files.
4. Enforce minimum four images and required official document before submission/approval.
5. Test owner isolation, atomic paired writes, approval/rejection, publish/unpublish and guest bookings.

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
