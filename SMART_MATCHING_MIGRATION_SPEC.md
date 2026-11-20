# JameenGhar Real Estate Smart Matching — Approved Build Specification

Status: requirements approved; implementation not yet deployed.
Branch: real-estate-smart-matching-phase1
Production website and CRM must remain unchanged until tested and explicitly approved for release.

## Existing-system protection
- Preserve existing CRM login, lead creation, Created Leads, consultant queues, assignment/reassignment, owner reporting, property flows, Daybnb/Stays, ImageKit and Cloudflare Worker.
- Do not make the existing private `leads` collection readable to every CRM user.
- Build separate marketplace-safe records and private owner-only records. Keep original lead documents unchanged.
- Implement on this branch, test, then propose a production PR. Never claim production deployment before merge and verification.

## Legacy active leads
- Include all active Buyer/Seller-side legacy leads in matching, including buyer, seller and landlord categories where applicable.
- Exclude unrelated enquiry types (for example home-loan) and closed-won/closed-lost records.
- Migrate idempotently into separate matching records linked to source lead IDs stored privately; never duplicate or modify/delete original leads.
- Missing or ambiguous information goes to an Owner-only Data Completion Queue. Never guess missing location pin, title, area, dimensions, facing, budget, media or contact details.
- Owner completes/confirms missing fields before a legacy record becomes match-eligible.

## Data separation and privacy
Create separate least-privilege collections, subject to existing project conventions:
- `marketplaceRequirements`: safe Buyer requirement card.
- `marketplaceProperties`: safe Seller/Broker property card.
- `marketplacePrivate`: exact map coordinates, contact details, source CRM IDs and private verification information; Owner only.
- `smartMatches`: match pair, score, criterion breakdown, distance, consent and Owner workflow; Owner only.
- `marketplaceInterests`: responses to an individual match; Owner only.
- `marketplaceMigrationJobs`: migration progress; Owner only.
Public cards must never expose names, phone, email, exact pin, private notes, direct contact links or original lead IDs. Show only an approximate area/location approved for display.

## Buyer requirement post
Use a structured form with title, buy/rent, property category/subtype, city/locality, private Google Maps pin, preferred starting radius (1 km or 2 km), min/max budget, area range and unit, facing, road width, and relevant category-specific preferences/additional requirements. Required fields must be validated before match eligibility. Public display hides exact pin.

## Seller/Broker property post
Use structured fields: property title, sale/rent, property category/subtype, city/locality, private exact Google Maps pin, asking price, area/unit, facing, road width and relevant details. Seller/Broker must upload exactly 1–2 property photos (minimum 1, maximum 2), exactly 1 property video (mandatory, maximum 60 seconds), AND exactly 1 clear photo/scan of a hard-copy property proof document (mandatory). All three media categories are required before submission. The proof document must help Owner verify that the property exists and that the poster has a genuine/legal basis to sell or rent it (for example, an appropriate ownership record, allotment/possession paper, or valid authorization/mandate where applicable). Do not assume every poster must personally own the property; a broker/authorized representative must be able to provide valid authority to market it. The document image is strictly private and Owner-only; never show it to Buyers, other Sellers/Brokers, or in public listing/media URLs. Keep proof-document verification status and reviewer notes private. Owner approval is mandatory before a property becomes public or match-eligible. A listing cannot submit if the photo count is outside 1–2, video is missing/over 60 seconds, or proof-document image is missing/unclear.
- Validate file type, actual duration, dimensions, file size and successful processing server-side.
- Prefer responsive optimized image delivery (WebP/AVIF where supported, with compatible fallback) and compressed/transcoded video (MP4/H.264 or compatible delivery rendition).
- Generate fit-for-purpose thumbnails/poster frames and stream optimized renditions; do not serve unnecessarily large originals to the public.
- Maintain sufficient visual clarity to inspect the property. Use sensible quality/bitrate targets and test on mobile networks; do not over-compress into blur or unreadable detail.
- Enforce upload/storage quotas and limits. Keep originals private only when needed for moderation/evidence; define lifecycle/retention to control storage costs.
- Property photos/video should clearly show the property and should not reveal exact pin/address or private contact details. The proof-document image must be uploaded to a private, access-controlled location, not the public ImageKit delivery path; generate no public URL for it. Restrict reads to Owner-side verification services/accounts.

## Contact leakage prevention
Reject unsafe text fields containing phone numbers, emails, URLs, social handles, messaging IDs or contact solicitation.
Inspect uploaded photos and video frames for phone/email/URL/social/contact text and QR codes. Inspect video audio with speech-to-text for spoken contact numbers and contact solicitation. If flagged, block submission/publication or route to Owner moderation; never silently publish.
Run moderation server-side, not only in browser. Keep moderation state (pass / blocked / manual_review) and evidence private. Detection is not infallible; allow Owner review and false-positive handling.

## Smart matching
- Match both directions: Buyer requirements to Seller/Broker properties and Seller/Broker properties to Buyer requirements.
- Compare category, locality/distance, budget, area, facing, road width and other chosen criteria; store transparent overall score and per-criterion explanation.
- Search within selected 1 km or 2 km radius first. If suitable results are insufficient, expand progressively (e.g. 5 km, 10 km, then broader locality/city coverage) until suitable candidates are found or configured geographic limits are reached.
- Surface 50–100% candidates to Owner, ranked by compatibility and proximity. Show actual distance, radius searched, missing/mismatched criteria. Never silently alter user's requirement.
- Match score is a decision aid, not a guarantee.

## Match sharing and consent
- New match initially notifies Owner Dashboard only.
- Owner may choose to share a privacy-safe match card with both sides: property/requirement title, category, approximate area, price/budget, approximate distance and approved details only.
- Never reveal party names, phone, email, exact map pin, direct contact details or direct contact links in match cards.
- Buyer and Seller independently choose Interested / Not interested / Need more information for that exact match. Any response notifies Owner only.
- Deal progression requires both sides' consent AND Owner approval. One-sided interest remains pending; no deal progression.
- Owner may initiate/propose a match, but the other party's consent is still required.
- Owner remains the bridge; contact details are not automatically disclosed.

## Owner Dashboard
Add Smart Matches queue (score, distance, radius searched, criterion breakdown, source links and status), legacy Data Completion Queue, safe edit/confirm controls, share/propose controls, each party's interest status, approve/reject controls and audit history. Include migration counts (scanned, eligible, migrated, needs review, skipped inactive, errors).

## Rollout
1. Review current data schema and existing Firestore rules.
2. Add separate collections and least-privilege rules; never broaden legacy lead access.
3. Dry-run migration; show counts, then migrate idempotently.
4. Owner completes missing legacy data; no incomplete legacy record becomes public or match-eligible.
5. Test rules as Owner, approved CRM, unapproved CRM and signed-out user.
6. Test public/private data separation, media validation, contact moderation, matching, radius expansion, two-sided consent, Owner-proposed matches and audit logs.
7. Only then prepare production PR and request explicit go-live approval.

## Out of scope
JameenGhar Construction and JameenGhar Stays/Daybnb changes are excluded from this phase.
