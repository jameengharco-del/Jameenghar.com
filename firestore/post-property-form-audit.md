# Post Property Form Audit — main/index.html

Reviewed source: `index.html` on `main` branch.
Review date: 2026-11-16.
No source code was changed.

## Existing form fields (modal form id: propertyForm)

| Element ID | Label / purpose | Required |
|---|---|---|
| ownerName | Your name | Yes |
| ownerPhone | Phone number | Yes (HTML pattern accepts 8+ phone characters; saveWebsiteLead later requires a cleaned 10-digit number) |
| ownerEmail | Email | No |
| purpose | Sell / Rent | No (defaults to Sell) |
| newKind | Property type: Apartment / Flat, Independent House, Plot / Land, Villa, Commercial | Yes |
| newPrice | Expected price / rent (₹) | Yes |
| newBeds | Bedrooms | No |
| newLocation | Property location | Yes |
| newDetails | More details | No |

Submit button text: `Submit Property Enquiry`.

## Current submission behavior

The form submit handler calls `saveWebsiteLead(...)`, which writes a document to `/leads`, not `/properties`.

Mapping:
- name -> `customerName`
- phone -> `phone`
- email -> `email` (optional)
- Sell -> `enquiryType: "seller"`; Rent -> `enquiryType: "landlord"`
- property kind + location -> `propertyTitle`
- kind -> `propertyType`
- location -> `propertyLocation`
- price -> `budget` (string)
- bedrooms + details -> `message`

The `saveWebsiteLead` helper adds website lead defaults: `source: "website"`, `status: "new"`, `assignedTo: "unassigned"`, `assignedAgentName: "Unassigned"`, empty follow-up/remarks, and server timestamps.

## Missing from the current form

- Firebase Authentication login / account registration step.
- Property-owner account role linkage (`ownerUid`).
- Property title as a separate dedicated input.
- Structured city/locality/area fields.
- Four or more property image uploads.
- Official property document upload.
- Full private address separated from public location.
- Owner dashboard / listing status tracking.

## Conclusion

The current website form is a property seller/landlord enquiry form, not a property listing submission workflow. It should not be connected directly to the new `/properties` owner-create permission until a proper authenticated owner form and verified file-upload flow exist.

The existing form currently creates a CRM lead. Preserve this behavior until the replacement owner workflow is built and tested, so current enquiries do not stop reaching the CRM.

No changes were made to `main/index.html`, Firebase data, Firestore Rules, CRM, or live hosting.
