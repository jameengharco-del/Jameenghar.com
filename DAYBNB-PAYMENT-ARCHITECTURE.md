# Daybnb Booking & Payment Architecture (safe-branch plan)

Status: DESIGN + PAYMENT RECORD FIELDS ONLY. No gateway account, API key, checkout, webhook, live payment or production change is enabled.

## Product decision

Daybnb will show a secure hosted payment checkout after the property owner/authorized team confirms availability and the final price. Do not collect payment for an unconfirmed request. Recommended starting provider: Razorpay Standard Payment Gateway (not RazorpayX, Subscriptions, Instant Settlements, or any paid add-on). Its official standard pricing states ₹0 setup and ₹0 AMC; standard domestic payments are generally 2% platform fee + 18% GST on that fee for successful payments, with certain premium methods (e.g. EMI/Amex/international/corporate cards) at 3% + GST. Optional Instant Settlements are paid and must remain OFF. We will use the standard settlement cycle. Assume the normal 2% + GST rate in budgets; do not rely on temporary 0% promotional offers. Merchant-specific written terms must still be checked before activation. Cashfree's current page advertises a limited 0% offer, but its terms show a new-signup cutoff of 31 July 2026 (already passed as of this project date), and Cashfree may levy a one-time ₹199 KYC fee for merchants without valid GST registration. Therefore it is not the safe default for this requirement.

Official integration requirements to follow:
- Create the gateway order on the server, not in browser code.
- Verify the checkout signature server-side.
- Verify the final order/payment status; only captured/paid is fulfilment-ready.
- Use signed server-to-server webhooks to recover from browser close/network failures.
- Never trust a browser success message as proof of payment.

## Booking lifecycle

1. Guest submits a booking request. Create `daybnbBookings/{bookingId}` with `status=pending`, `bookingStage=awaiting_owner_confirmation`, `paymentStatus=not_started`. This is a request, not a confirmed reservation.
2. Owner checks availability and confirms or rejects. For confirmation, server records an immutable quote in integer paise: base amount, optional taxes/fees, discount, final amount, currency INR, quote expiry, owner UID and listing ID. Browser-provided totals are never authoritative.
3. Only after owner confirmation can server create a gateway order. Set `paymentStatus=created`, `bookingStage=awaiting_payment`, provider order ID, amountPaise, currency and expiry. Use an idempotency key tied to booking + quote version to prevent duplicate orders.
4. Guest is redirected/opened into provider-hosted checkout. Never store card number, CVV, UPI PIN or OTP in JameenGhar.
5. Server verifies checkout signature and then fetches provider order/payment status, or receives a signed webhook. Only a captured payment matching the expected order ID, booking ID, amount and INR currency can set `paymentStatus=paid` and `bookingStage=confirmed`.
6. Failed/abandoned payment remains retryable while quote is valid; it does not confirm the booking. Expired payment order releases the availability hold.
7. Duplicate/out-of-order webhooks are idempotent. Persist provider event ID and reject replay. A later failure event must not downgrade a captured payment.
8. Refunds are explicit server-side actions with reason, amount and provider refund ID. Track `refundStatus` separately; a refunded booking is not silently re-opened.
9. Owner Dashboard shows booking, confirmed quote, payment state, gateway IDs (non-secret), refund state and settlement/reconciliation information.

## Firestore data model

`daybnbBookings/{bookingId}`:
- booking identity: propertyId, ownerUid, guest name/contact, dates/times, bookingType, guest count
- quote: quoteVersion, baseAmountPaise, taxAmountPaise, feeAmountPaise, discountAmountPaise, totalAmountPaise, currency=INR, quoteExpiresAt
- booking state: bookingStage (awaiting_owner_confirmation | awaiting_payment | confirmed | rejected | cancelled | expired)
- payment state: paymentStatus (not_started | created | pending | failed | paid | refunded | partially_refunded)
- provider: paymentProvider, gatewayOrderId, gatewayPaymentId, lastWebhookEventId, paidAt
- refund: refundStatus, refundAmountPaise, gatewayRefundId, refundReason, refundedAt
- audit: createdAt, updatedAt, ownerConfirmedAt, confirmedByUid

Private `daybnbPaymentEvents/{providerEventId}` stores verified webhook event IDs and processing result; client users cannot write it. Never expose provider secrets.

## Money and marketplace rules

- Store money as integer paise; INR only for v1.
- Server recomputes hourly duration/day count/night count and reads the current owner-approved rate. Owner must confirm the final amount before checkout.
- Define whether platform fees/taxes are included before accepting live bookings; show a clear breakdown before pay.
- V1 collects payment to the JameenGhar merchant account. Do not promise automatic owner payouts or split settlements. Owner payouts/commission, GST/TDS and marketplace compliance need a separate approved design and gateway capability review.
- Publish cancellation/refund policy before checkout.
- Never mark a booking confirmed based only on a redirect/callback. Verify signature + provider status + exact amount/currency/order.
- Keep test and live keys separate. Keys live only in Worker secrets, never GitHub or browser JS.

## Zero-surprise cost policy — mandatory

The Owner's commercial rule is strict:
- ₹0 setup fee.
- ₹0 monthly fee, subscription fee, annual maintenance fee (AMC), minimum monthly commitment, inactivity fee, or mandatory paid plan.
- No paid add-ons, instant-settlement service, premium checkout, subscription products, RazorpayX or auto-upgrade. Default all optional paid features OFF.
- The only acceptable provider deduction is a clearly disclosed transaction/platform processing fee (plus applicable GST/tax on that fee) on a successfully captured customer payment. No successful payment = no transaction fee. Budget the standard domestic rate at 2% + GST on that fee; premium payment methods may cost more and should be disabled or clearly approved before activation.
- Gateway charges are normally deducted from the merchant settlement; do not silently add them to the guest's quoted amount. Show the guest the booking total and any separately approved charge before they pay.
- Refunds may not return the original processing fee; disclose this to Owner and account for it in refund policy.
- Do not promise a zero transaction fee indefinitely based on a temporary promotion. Record its expiry/volume cap and the post-offer rate.

## Zero-surprise activation gates

- Payment code remains disabled by default.
- No gateway account is opened, no KYC submitted, no live key requested, and no real payment attempted by this code change.
- Before provider activation, obtain merchant-specific confirmation of ₹0 setup, ₹0 monthly/AMC, ₹0 minimum commitment, transaction-only deductions on successful payments, applicable GST, refund/chargeback treatment and standard settlement timing. Default to standard settlement; paid instant settlement remains OFF.
- If the merchant dashboard or agreement contains any fixed/monthly/subscription/mandatory fee, reject that plan and do not activate it.
- Do not enable live payments until Owner explicitly approves the selected provider, exact fee schedule, cancellation/refund terms, merchant settlement account, and test results.

## Next implementation sequence

1. Add payment status/quote fields to the Daybnb booking record (staged safe branch).
2. Add unit-tested signature helpers and disabled Worker route skeleton.
3. Add server-side Firestore quote/owner-confirmation/order creation and webhook idempotency using secrets only after the provider is selected.
4. Build checkout UI and Owner payment dashboard.
5. Run gateway test mode and webhook replay/failure/amount-tamper tests.
6. Request explicit go-live approval. Never merge to main or enable live payments without it.
