# Daybnb CRM Module — Functional Design

**Repository:** `jameengharco-del/JameenGhar.com`  
**Branch:** `cloudflare-r2-safety`  
**Date:** 2026-11-17  
**Status:** Design only; not deployed.

## 1. Architecture decision

Build Daybnb as a separate functional CRM module inside the existing central JameenGhar Owner Dashboard.

- Central Owner Dashboard contains a Daybnb entry card.
- Clicking the card opens the Daybnb Dashboard/module.
- Daybnb has its own navigation, work queues, records, and operational screens.
- It shares the existing Firebase Authentication, `/users/{uid}` profiles, and fixed JameenGhar Owner Admin authority.
- It is not a separate login system, separate owner identity store, or separate top-level admin dashboard.
- Normal sale/rent CRM leads and consultant workflows remain separate.

## 2. Daybnb Dashboard sections

1. **Overview:** pending listings, published listings, rejected listings, new booking requests, and booking status counts.
2. **Listing approvals:** pending queue; open full submission; inspect required images/documents; approve or reject with reason.
3. **Published listings:** publish/unpublish controls and listing status.
4. **Owners:** owner profile and their Daybnb submissions; private contact data visible only to authorized Owner Admin.
5. **Rates:** hourly, day-use, and overnight rates, with owner-submitted values displayed for review.
6. **Bookings:** guest requests, booking details, status updates, and operational notes.
7. **History:** approval, rejection, publication, and booking action history.

**Approval location:** approve/reject and publish/unpublish actions are performed inside this Daybnb Dashboard. The central Owner Dashboard only provides the entry card and overall navigation.

## 3. Owner journey

- First-time seller/owner enters through the shared owner listing flow and creates/uses one shared account.
- No separate manual account approval gate is required before they can submit, once the required authentication, email verification, and file checks pass.
- Owner submits Daybnb property details and rates for one or more supported modes: hourly access, day-use, overnight.
- Submission is stored as pending and unpublished.
- Owner can see only their own submission and its status.
- Owner cannot approve, reject, publish, unpublish, or inspect another owner's private data.
- Daybnb Dashboard approval is performed by the JameenGhar Owner Admin.

## 4. Data and security requirements

Use shared `/users/{uid}` identity with `role: "property_owner"`; do not create duplicate Daybnb owner accounts or a separate role solely for Daybnb.

Keep Daybnb operational data in the dedicated collections already planned:
- `daybnbProperties`: listing fields and owner UID; public reads only for published listings.
- `daybnbPrivate`: owner contact, full address, and private document references; only Owner Admin and matching owner can read.
- `daybnbBookings`: guest booking requests and booking status; public request creation remains unauthenticated if the existing validated booking flow is retained, while management is Owner Admin-only.

Required rule protections before launch:
- Bind every new public and private Daybnb listing record to `request.auth.uid`.
- Validate owner identity from the Firebase token, never a browser-supplied arbitrary UID.
- Require atomic paired creation of public and private listing records.
- Prevent owners from changing ownerUid or approval/publication fields.
- Allow owner reads only for their own records.
- Strictly validate fields, types, rates, and status values.
- Keep private documents/addresses inaccessible to public users and consultants.
- Keep guest booking validation intact.

The current supplied Firestore Rules do not yet securely bind Daybnb listing creation to an authenticated owner. This is a launch blocker and must be corrected and emulator-tested before owner submissions are enabled.

## 5. Suggested build order

1. Finalize Firestore schema and security rules; preserve all existing CRM/lead permissions.
2. Build Daybnb Dashboard shell and navigation inside central Owner Dashboard.
3. Connect read-only listing and booking queues.
4. Add approve/reject and publish/unpublish controls with server-enforced Admin checks.
5. Add shared owner submission and owner-only status view.
6. Add booking management and audit history.
7. Emulator-test owner isolation, admin actions, public published reads, and guest booking requests.
8. Obtain explicit approval before merging to `main`, publishing Rules, or deploying.

## 6. Non-goals / safeguards

- No separate Daybnb login or standalone admin dashboard.
- No duplicate owner profiles.
- No changes to the live CRM/consultant lead workflow.
- No live Firebase Rules publication or data migration.
- No R2 bucket/Worker activation.
- No merge to `main` or production deployment in this design task.
