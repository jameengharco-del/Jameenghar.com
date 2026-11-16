# Firestore Property Owner Rules — Review Draft (NOT DEPLOYABLE)

Branch: `cloudflare-r2-safety`
Base rules source: the complete Firestore Rules supplied by the project owner on 2026-11-16.
Status: proposal only. This file is NOT a complete replacement for the live rules.

## Safety status

- Do not paste this patch into Firebase Console or publish it.
- The live CRM, leads, agents, existing property records, and Daybnb rules are to remain unchanged.
- The current Admin check remains the fixed authenticated UID already used by the live rules.
- The existing public read rule for published normal properties remains in place.
- No R2 bucket, Worker, billing, or upload route is enabled by this proposal.

## Proposed role model

- `admin`: existing JameenGhar Owner Admin only.
- `crm`: existing approved consultant role; existing lead permissions remain unchanged.
- `property_owner`: separate account role; must have a verified Firebase email before submitting a listing.
- A property-owner account may remain `pending` for account review while being allowed to submit a property after email verification. Account approval and listing approval are separate decisions.

## 1. Add a property-owner helper

Insert beside the existing `isApprovedCRM()` helper:

```firestore
function isEmailVerifiedPropertyOwner() {
  return request.auth != null
    && request.auth.token.email_verified == true
    && get(
      /databases/$(database)/documents/users/$(request.auth.uid)
    ).data.role == "property_owner";
}
```

This intentionally does not require `users.status == "approved"`, because the agreed workflow allows an email-verified owner to submit a listing while the account is pending. It does not implement phone OTP.

## 2. Extend only the existing /users create role check

In the current `match /users/{userId}` create rule, replace the single condition:

```firestore
&& request.resource.data.role == "crm"
```

with:

```firestore
&& request.resource.data.role in ["crm", "property_owner"]
```

Keep every other existing field, UID, pending-status, email-verification, phone, and timestamp validation unchanged. This keeps CRM registration behavior intact while permitting the new role. The client must not be allowed to create an `admin` role.

## 3. Proposed normal property submission schema (requires confirmation)

The screenshots show the existing test record fields: `title`, `propertyType`, `listingType`, `city`, `areaGaj`, `price`, `facing`, `agentId`, `addressVisibility`, `documentsVerified`, `imageCount`, `minimumImagesRequired`, `status`, `verificationStatus`, and `isPublished`.

The existing test record has no `ownerUid`, no private document reference, and no image object keys. Do not retrofit it automatically.

For new owner-created records, the proposed public document should contain at least:
- `ownerUid`: authenticated owner's UID.
- Existing listing fields needed by the website.
- `status: "pending"`, `verificationStatus: "pending"`, `isPublished: false`.
- `addressVisibility: "hidden"`, `documentsVerified: false`.
- `minimumImagesRequired: 4`, `imageCount: 4` or more.
- `imageKeys`: list of at least four private-storage object keys (not public download URLs).
- `createdAt` and `updatedAt` server timestamps.

A proposed validation helper, to be adapted only after the final form schema is confirmed:

```firestore
function validOwnerPropertyCreate() {
  return isEmailVerifiedPropertyOwner()
    && request.resource.data.ownerUid == request.auth.uid
    && request.resource.data.status == "pending"
    && request.resource.data.verificationStatus == "pending"
    && request.resource.data.isPublished == false
    && request.resource.data.addressVisibility == "hidden"
    && request.resource.data.documentsVerified == false
    && request.resource.data.minimumImagesRequired == 4
    && request.resource.data.imageCount is int
    && request.resource.data.imageCount >= 4
    && request.resource.data.imageKeys is list
    && request.resource.data.imageKeys.size() >= 4
    && request.resource.data.createdAt == request.time
    && request.resource.data.updatedAt == request.time;
}
```

This is only a partial validation example, not sufficient on its own for production. The final helper must use `keys().hasOnly(...)`, `keys().hasAll(...)`, and strict type/range checks for every field accepted by the actual website form.

## 4. Proposed private owner data collection

New path: `/propertyPrivate/{propertyId}`.

Proposed fields:
- `propertyId`
- `ownerUid`
- `ownerName`
- `ownerPhone`
- `ownerEmail`
- `fullAddress`
- `documentKey` (private storage object key only)
- `createdAt`

Intended access:
- Admin can read and manage all private records.
- The matching owner can read their own private record.
- The owner can create their private record only in the same atomic batch as their pending, unpublished public property record.
- Owner updates/deletes are not enabled in the first pass; admin-only until the edit workflow is specified.
- Public users, CRM users, and unrelated owners cannot read this collection.

Proposed match block (field validation still needs to be completed against the actual form):

```firestore
match /propertyPrivate/{propertyId} {
  allow read: if isAdmin()
    || (request.auth != null
      && resource.data.ownerUid == request.auth.uid);

  allow create: if isEmailVerifiedPropertyOwner()
    && request.resource.data.propertyId == propertyId
    && request.resource.data.ownerUid == request.auth.uid
    && request.resource.data.createdAt == request.time
    && existsAfter(
      /databases/$(database)/documents/properties/$(propertyId)
    )
    && getAfter(
      /databases/$(database)/documents/properties/$(propertyId)
    ).data.ownerUid == request.auth.uid
    && getAfter(
      /databases/$(database)/documents/properties/$(propertyId)
    ).data.status == "pending"
    && getAfter(
      /databases/$(database)/documents/properties/$(propertyId)
    ).data.isPublished == false;

  allow update, delete: if isAdmin();
}
```

## 5. Normal /properties access change

Keep public read for published records and admin access. Add owner read for their own record, and permit only validated owner creation. Do not permit owner updates, publishing, approval, or deletion.

Conceptual rule:

```firestore
match /properties/{propertyId} {
  allow read: if isAdmin()
    || resource.data.isPublished == true
    || (request.auth != null
      && resource.data.ownerUid == request.auth.uid);

  allow create: if isAdmin() || validOwnerPropertyCreate();

  allow update, delete: if isAdmin();
}
```

The final version must additionally require the matching private record to exist after the atomic batch, and must validate the complete property field allowlist.

## Critical security limitation: Firestore cannot verify R2 object existence

A client-supplied `imageCount`, `imageKeys`, or `documentKey` does not prove that files exist or are valid. A malicious client could fabricate those values. The R2 Worker must later authenticate the Firebase ID token, verify ownership, enforce file type/size/count, and confirm uploads before the listing can be submitted/approved. Until that Worker is implemented and tested, do not treat the four-image/document fields as proof of uploaded files.

Likewise, `documentsVerified` must only be changed by Admin/trusted server code, never by the owner.

## Required validation before any live use

1. Confirm the exact fields submitted by the actual Post Property form.
2. Complete strict allowlists and type/range checks for public and private documents.
3. Confirm the app creates the public and private documents atomically.
4. Run Firestore Emulator tests for CRM registration/login, lead access/assignment/follow-up, Admin operations, owner self-access, cross-owner denial, public pending-listing denial, and Daybnb booking/listing access.
5. Verify existing test records and live CRM behavior remain readable/usable.
6. Review the final complete rules file, not just these snippets.
7. Obtain explicit approval before any Firebase Rules publication.

## Known test-data inconsistencies (do not auto-correct)

- `properties/test_property_001` currently shows `isPublished: true`, `status: "approved"`, `verificationStatus: "approved"`, but `imageCount: 0` and `documentsVerified: false`.
- `agents/test_agent` currently shows `status: "pending"`, `verificationStatus: "pending"`, `isVerified: false`, while `approvedAt` has a timestamp.
- These are existing test records, not evidence of a verified owner or valid uploaded files. Do not change them as part of this rules proposal.
