# Property Owner Portal — Technical Design

**Repository:** `jameengharco-del/Jameenghar.com`  
**Design branch:** `cloudflare-r2-safety`  
**Prepared:** 2026-11-16  
**Status:** Design proposal only — not implemented or deployed

## 1. Purpose

Create a separate Property Owner portal without changing the existing CRM workflow. The current `crm.html` remains the CRM login, registration, Owner Dashboard, and consultant work queue.

The new portal is planned as a separate page, initially named `property-owner.html`, using the existing JameenGhar branding and the same Firebase project.

## 2. Existing CRM behavior to preserve

Inspection of `crm.html` on `main` found:

- CRM registration collects name, 10-digit phone, email, and password.
- Registration creates a Firebase Authentication account and a `/users/{uid}` profile with `role: "crm"`, `status: "pending"`, and `emailVerificationRequired: true`.
- A verification email is sent. CRM access requires the profile role to be `crm`, email verification when required, and `status: "approved"`.
- The Owner Dashboard is selected using the existing fixed Owner UID.
- The consultant work queue and lead workflows are separate from Owner functions.

**Preservation rule:** Do not add Property Owner role selection to the CRM registration form, do not change CRM role checks, and do not change existing lead, assignment, transfer, report, or activity behavior as part of the Property Owner portal work.

## 3. Proposed separate user journey

### A. Registration

The Property Owner opens `property-owner.html` and chooses Create Property Owner Account.

Required fields:

- Full name
- 10-digit mobile number
- Email address
- Password (minimum 6 characters, consistent with the current Firebase Auth flow)

On successful Firebase Auth account creation:

1. Create a `/users/{uid}` profile with `role: "property_owner"`, `status: "pending"`, `emailVerificationRequired: true`, and server-side creation timestamp.
2. Send Firebase email verification.
3. Show a clear message to verify the email.
4. Do not show the property submission form until Firebase reports `emailVerified === true`.

This registration flow must not be enabled until the reviewed Firestore Rules supporting the `property_owner` role have been approved and published.

### B. Login and account routing

- Existing Property Owner accounts sign in on `property-owner.html` with email and password.
- After login, load the signed-in user's `/users/{uid}` profile and verify `role === "property_owner"`.
- If the profile role is `crm` or another role, do not show the Property Owner dashboard. Display a role-specific message and provide a link to the appropriate portal.
- If email is not verified, show verification instructions and a resend/refresh action. Do not permit property submission.
- If email is verified, show the Property Owner dashboard even when the account profile status remains `pending`. Account approval and property approval are separate decisions in this project.
- A rejected or disabled account must not be allowed to submit or manage listings; the exact account suspension field and policy must be finalized before implementation.

### C. Existing Firebase accounts and email collisions

Firebase Authentication uses one account per email address. The portal must not silently create a second account or overwrite an existing `crm` profile.

If registration returns `auth/email-already-in-use`:

- Ask the user to sign in using the existing account.
- Read the profile role.
- If it is `property_owner`, continue to the Property Owner dashboard.
- If it is `crm`, explain that the email is already registered for CRM and do not change its role automatically.
- Any role conversion or multi-role account support requires a separate Owner-reviewed decision and corresponding Rules design.

## 4. Property Owner dashboard scope

The signed-in Property Owner can see only their own property submissions and their status.

Planned dashboard sections:

- Submit a Property
- My Property Listings
- Listing status: Pending, Approved, Rejected, Published, Unpublished (exact status model to be normalized before implementation)
- Admin feedback / rejection reason, if supplied
- Logout

The Property Owner must not see:

- CRM leads or buyer contact details
- Other owners' profiles or listings
- Private documents or full private addresses belonging to another owner
- Admin approval controls or publish/unpublish controls

A Property Owner may create a submission and view their own status, but must not approve, reject, publish, unpublish, or delete a listing through client-side code.

## 5. Planned property submission flow

The authenticated, email-verified Property Owner will eventually submit:

- Dedicated property title
- Listing purpose (sale or rent)
- Property type
- Expected price / rent
- Structured city, locality, and public area
- Bedrooms and other relevant property attributes
- At least four property images
- Official property document
- Full private address, stored separately from public listing information

On submission:

1. Validate the owner identity from Firebase Authentication; never accept an arbitrary `ownerUid` supplied by the browser.
2. Upload files through the reviewed private upload service, not directly to a public bucket.
3. Validate actual file contents, file types, size limits, and ownership on the server-side Worker.
4. Create a pending property record linked to the authenticated UID.
5. Store private address and document references separately from public listing fields.
6. Keep the listing unpublished until Owner Admin approval and explicit publication.
7. Notify the Owner through the agreed notification channel only after that flow is implemented and tested.

This document does not define final field allowlists, file-size limits, MIME validation rules, or the complete Firestore transaction. Those must be specified and tested before implementation.

## 6. Data and access boundaries

Proposed collections:

- `/users/{uid}`: role and account profile. Property Owner role is `property_owner`.
- `/properties/{propertyId}`: listing metadata and owner UID, with public reads restricted to approved/published listings and owner reads restricted to their own records.
- `/propertyPrivate/{propertyId}`: private address and private document object references. Access limited to the owning UID and Owner Admin.
- Existing `/leads`, `/agents`, and Daybnb collections: no changes in this workstream.

The final Firestore Rules must enforce access independently of the UI. Hiding buttons or sections in JavaScript is not a security boundary.

For object storage, private documents must not use permanent public URLs. The R2 Worker must authenticate the user, verify ownership/role, validate the upload, and issue only narrowly scoped access. R2 remains on hold; no bucket or Worker deployment is authorized by this design.

## 7. Firestore Rules dependency

The current live Rules do not yet authorize Property Owner registration and listing submission. The separate proposal at `firestore/property-owner-rules-proposal.md` is conceptual only and is not a deployable replacement.

Before coding or enabling registration:

1. Reconcile the proposal against the complete current Rules file.
2. Preserve the fixed Owner UID check and all existing CRM, lead, activity, agent, and Daybnb permissions.
3. Define exact allowed profile fields and property fields.
4. Enforce owner UID matching and immutable ownership.
5. Enforce pending/unpublished defaults and prevent owner-side approval/publication.
6. Add Firestore Emulator tests for allowed and denied cases.
7. Review the full replacement Rules with the Owner before publishing.

## 8. Implementation sequence

1. Approve this portal design and role-collision behavior.
2. Prepare a standalone `property-owner.html` login/registration shell with no property writes.
3. Review the complete Firestore Rules changes and test them in the Emulator.
4. Add and test the Property Owner profile flow only after Rules are ready.
5. Build private file upload and validation only after the R2 security design is approved.
6. Build the property submission form and owner-only dashboard.
7. Test end-to-end with a dedicated test account and test property.
8. Only after explicit approval, merge to `main` and deploy the relevant Firebase/hosting changes.

## 9. Explicit non-changes in this design

- No changes to `main`.
- No changes to `crm.html` or `index.html`.
- No Firebase Authentication users or Firestore documents created or modified.
- No Firestore Rules published.
- No R2 bucket activated and no Worker deployed.
- No public listing created or published.

## 10. Open decisions before implementation

- Final account suspension/rejection policy for Property Owners.
- Whether a Property Owner can later become a CRM consultant, and if so whether this requires Owner-managed role conversion or a multi-role model.
- Exact property field schema, validation limits, and public/private address split.
- File size/type limits, retention policy, and private document review process.
- Notification method and operational handling for Owner Admin.
