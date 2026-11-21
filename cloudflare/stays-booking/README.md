# JameenGhar Stays Booking Service

This Worker is the server-side booking authority for JameenGhar Stays. It provides:
- Firebase ID-token verification for customer and Owner sessions.
- Property-specific SQLite Durable Objects for strongly consistent booking holds and availability.
- Server-side pricing from the approved Firestore property record.
- Razorpay Orders API, payment signature verification, captured-payment verification and webhook reconciliation.
- Owner-only booking calendar, manual availability blocks and refund requests.

## Important launch gates

This service is not production-ready until all of the following are complete:
1. Deploy the Worker and its SQLite Durable Object migration.
2. Enable Firebase Anonymous Authentication for guest checkout.
3. Add the three Razorpay secrets below using TEST credentials first.
4. Configure the Razorpay webhook URL and subscribe to payment.captured, payment.failed, and order.paid.
5. Complete test payments, failed-payment tests, duplicate/overlapping slot tests, refund tests and Owner calendar tests.
6. Confirm Razorpay account activation and any marketplace/Route approval before enabling real owner settlements.

Do not put Razorpay secrets in browser code, GitHub, or chat.

## Cloudflare Worker configuration

The wrangler.toml file declares Worker name jameenghar-stays-booking, Durable Object binding CALENDARS, SQLite-backed class PropertyCalendar, Firebase project and Owner UID.

Set secrets from a trusted terminal:
    wrangler secret put RAZORPAY_KEY_ID
    wrangler secret put RAZORPAY_KEY_SECRET
    wrangler secret put RAZORPAY_WEBHOOK_SECRET

The Firebase project ID and Owner UID are non-secret Worker vars in wrangler.toml.

Deploy from this directory:
    wrangler deploy

The expected Worker endpoint used by the site is:
https://jameenghar-stays-booking.jameenghar-co.workers.dev

After deployment, check GET /api/health. The health response reports paymentsConfigured true only after Razorpay secrets are installed.

## Razorpay webhook

Configure:
https://jameenghar-stays-booking.jameenghar-co.workers.dev/api/webhooks/razorpay

Subscribe to payment.captured, payment.failed, and order.paid. Use the exact same webhook secret in Cloudflare secret RAZORPAY_WEBHOOK_SECRET.

## Firebase requirement

Enable Authentication > Sign-in method > Anonymous. The public booking page uses an anonymous Firebase session so the Worker can bind a booking to a customer session without requiring account creation.

## Booking model

Statuses include hold (10-minute payment hold), confirmed (verified captured payment), payment_failed, refund_pending, refunded, blocked (Owner manually blocked the calendar), and released.

The Durable Object SQLite database is the authoritative booking/calendar ledger. It is separate from the existing Firestore daybnbBookings collection. Do not treat old Firestore booking requests as paid or confirmed bookings.

## Operational limitations to close before launch

- Guest email/SMS confirmation notifications are not yet connected.
- Marketplace split settlement through Razorpay Route requires Razorpay approval and linked-account onboarding; do not promise automatic owner payouts before approval.
- Cancellation/refund policy, refund eligibility windows and customer support process must be finalized.
- Tax invoice/GST and platform fee handling must be finalized with the business/accountant.
- Full end-to-end production tests are mandatory before public payments are enabled.
