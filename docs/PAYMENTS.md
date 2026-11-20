# Purchased-points voting and payments

**Status: payment collection is OFF.** No provider is configured, no merchant account exists in this system, and no order can be created in production. The public site says "Payment coming soon".

## The rule

₱100 = 1,000 voting points (10 centavos per point). It is enforced three times: a table constraint on packages (`price_centavos = points × 10`), the same constraint on every order, and the server deriving the price from the points — a price sent by a browser is ignored. Money is stored as integer centavos, points as integers.

## How points are counted

```
Choose candidate → choose package → order (created) → provider checkout (awaiting_payment)
   → provider webhook, signature verified → payment_events (once per event id)
   → ledger credit (once per order) → candidate total = sum of ledger rows
```

| Record | Purpose | Protection |
| --- | --- | --- |
| `packages` | Catalog | Fixed-rate constraint; price never accepted from a request; any edit withdraws approval |
| `orders` | One intended purchase | Candidate, package snapshot, points and amount are immutable; status moves only along allowed transitions; never deleted |
| `payment_events` | Every signed provider notification | Unique per provider event id, so a replay does nothing |
| `ledger` | The authoritative points record | Append-only; one credit per order (unique index); an order can never hold less than 0 or more than it bought |
| `voting_snapshots` | Final count | Written once at finalization with a SHA-256 digest; immutable |

A browser "success" page never credits points. Only a webhook whose signature the Worker verified, for the provider registered in the database, with the exact amount and currency of the order, does.

Supporters may buy as many packages as they like. Nothing limits purchases per person; what is prevented is counting the same payment twice.

## Decisions the system refuses to make for you

| Situation | What happens | Who decides |
| --- | --- | --- |
| Payment confirmed after voting closed | Order is **held**, not credited | Organizer credits or declines, with a recorded reason |
| Partial refund | Points stay; order is flagged | Organizer records an adjustment or confirms the points stand |
| Full refund or chargeback | All points for that order are reversed automatically (new ledger row) | — |
| Wrong amount or currency | Not credited; flagged | Organizer, after checking the provider |
| Second payment for one order | Not credited; flagged for refund | Organizer |
| Tie in points | Shown as a tie | Organizer rule |

Finalizing is refused while any payment is pending, held or flagged.

## Switches (all must be on)

1. `QOQ_PAYMENTS_ENABLED=yes` on the Worker — deployment authorization.
2. `QOQ_PAYMENT_PROVIDER` naming an adapter in `server/payments.mjs`, plus `QOQ_PAYMENT_WEBHOOK_SECRET`.
3. `settings.payment_provider` in the database — set by SQL by an administrator; there is deliberately no button for it.
4. Package catalog approved by the organizer.
5. "Switch checkout on" in the organizer desk.
6. Voting open.

Turning any one off closes checkout immediately. Webhooks keep working so refunds for past orders are still recorded.

## Adding the real provider

Implement one adapter in `server/payments.mjs`:

- `createCheckout(order, env)` → `{providerRef, checkoutUrl}` (hosted checkout page; card and wallet details never touch this site)
- `verify(request, rawBody, env)` → `{eventId, type, orderRef, amountCentavos, currency, providerRef}` or `null` if the signature is invalid

Put the order reference (`QV-…`) in the provider's metadata so the webhook can return it. Map the provider's event names to: `processing`, `paid`, `failed`, `expired`, `cancelled`, `refunded`, `reversed`. Register the webhook URL `https://queenofquiapo.com/api/payments/webhook/<adapter-name>`.

The included `sandbox` adapter moves no money, is refused on every production hostname, and exists for rehearsals and tests.

## Activation gate — do not switch on until every line is true

- [ ] Payment provider selected and merchant account approved in the organizer's legal name
- [ ] Provider adapter written and reviewed
- [ ] Sandbox payments pass end to end on the preview site: paid, failed, expired, duplicate webhook, refund
- [ ] Settlement report from the provider reconciles to the organizer desk for a test day
- [ ] Refund and cancellation policy approved and published
- [ ] Late-settlement policy approved and published
- [ ] What the points decide (and the award name) approved and published in the Voting Rules
- [ ] Legal review complete — see below
- [ ] Privacy Notice updated with the provider's name
- [ ] Organizer gives written authorization to open checkout

## Questions for a Philippine lawyer or accountant before launch

These are not settled by this software and I have not verified how they apply to this event:

- Whether paid voting where an award depends on the amount paid requires a **DTI sales-promotion permit** or falls under other rules on contests or games of chance.
- **Tax treatment** of the proceeds (official receipts or invoices, VAT or percentage tax, BIR registration of the collecting entity).
- **Consumer-protection** requirements for online sales: refund disclosure, total price display, seller identity.
- **Data Privacy Act** duties for payment data: registration thresholds with the National Privacy Commission, a designated data protection officer, and a data-sharing or processing agreement with the provider.
- Who legally receives the funds (the barangay, an association, or FMB&CO) and the provider's merchant-category restrictions.
