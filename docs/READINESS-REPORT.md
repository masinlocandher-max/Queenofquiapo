# Queen of Quiapo 2027 — engineering readiness report

14 November 2026 · branch `claude/queen-of-quiapo-2027-so8cs2` · nothing in this report has been deployed.

## A. Executive status

| Area | Verdict | Basis |
| --- | --- | --- |
| Platform (applications, roster, judging, tabulation, results) | **CONDITIONAL GO** | Software verified locally end to end. Production infrastructure could not be inspected, and the release has not been applied. |
| Paid voting | **NO-GO** (by design) | Architecture built and tested in isolation. No provider, no merchant account, no approved refund or award rule, no legal review. Checkout is off at three independent levels. |

The condition for the platform: someone with access applies the release in `docs/DEPLOYMENT.md` and completes its smoke test, and the judges rehearse on the venue's internet. Until then every production claim below is **UNVERIFIED**.

## B. Repository changes

**Migrations (additive; nothing deleted)**
- `20261114100000_qoq_editions_lifecycle.sql` — editions, voting lifecycle states, candidate registry fields, application status and history, audit detail
- `20261114101000_qoq_points_ledger.sql` — packages, orders, payment events, append-only ledger, reconciliation, voting snapshot
- `20261114102000_qoq_tabulation_results.sql` — ranked tabulation with tie flags, final snapshot, certification, publication

**Server** — `server/payments.mjs` (new), `server/competition.mjs`, `server/api.mjs`, `server/worker.mjs`, `scripts/build.mjs`

**Organizer and judge** — `public/organizer/index.html`, `desk.js`, `desk.css`, `operations.js`, `voting.js`, `review.js`; `public/judge/ballot.js`

**Public** — `vote/`, `candidates/`, `results/`, `voting-rules/`, `privacy/`, `terms/` (new or rebuilt); `voting.js`, `voting.css`, `event-updates.js`; navigation and footer on existing pages; application receipt in `apply/` and `apply.js`

**Tests** — 41 tests in six suites (was 7 tests plus two SQL scripts, which the new suites supersede). `config/edition.json`, `.env.example`, four documents in `docs/`.

## C. Applications

| Requirement | Result |
| --- | --- |
| Valid submission stores record and both photos | PASSED (HTTP → Worker → PostgreSQL, and in Chromium at 390 px) |
| Missing or invalid fields, bad email, implausible measurements, non-image file, oversized file, cross-site post | PASSED — rejected, nothing stored |
| Storage succeeds, database fails | PASSED — applicant is not told it was received; uploads cleaned up |
| Database commits but the reply is lost | PASSED — receipt still issued, nothing deleted |
| Double-click, refresh, six concurrent retries | PASSED — one record, one receipt |
| Receipt with reference, edition, Philippine time, next steps, print | PASSED |
| Private inbox: counts, status filter, search, order, paging, duplicate flag, notes, history, CSV | PASSED |
| Status lifecycle with actor and time; illegal jumps refused | PASSED |
| Access from public host, other accounts, or by reference number alone | PASSED — refused |
| Email confirmation | **NOT IMPLEMENTED** — no email provider exists; the receipt says so |
| Live production submission | **UNVERIFIED** |

## D. Candidates

PASSED locally: promotion copies the pageant name only; unique numbers per edition; publication requires a number and a recorded clearance; unpublished candidates and all screening data are absent from every public response; roster lock and its one-way freeze once voting or judging opens; removing an applicant's data leaves the public candidate intact.

Limit: a candidate who withdraws **after** the roster is locked cannot be marked withdrawn in the system; handle by announcement.

## E. Voting packages

Starter 1,000/₱100 · Supporter 5,000/₱500 · Champion 10,000/₱1,000 · Diamond 25,000/₱2,500 · Royal 50,000/₱5,000 · Crown 100,000/₱10,000. Seeded as **proposals**: displayed publicly, flagged "awaiting approval" in the desk, and unusable for checkout until approved. Rate enforced by constraint; a tampered price is ignored (tested). No fictional purchases or points exist.

## F. Payment architecture

| Component | State |
| --- | --- |
| Order model, state machine, immutable recipient and snapshot | Implemented, tested |
| Webhook endpoint with signature verification and replay window | Implemented; tested with the rehearsal adapter only |
| Real provider adapter | **BLOCKED** — no provider chosen |
| Refund, chargeback, partial refund, late settlement, double payment, amount mismatch | Implemented, tested in isolation |
| Production checkout | Off. Verified that no combination of settings opens it on a production hostname with the rehearsal adapter |

## G. Points ledger

Verified: one credit per order under 30 simultaneous copies of the same notification and 20 retries under new event ids; 60 supporters paying at once, each notified twice, totals exact; the worked example (16,000 vs 25,000) ranks correctly; ledger rows cannot be edited or deleted even with direct SQL; adjustments are bounded, reasoned and audited; finalization refused while anything is pending, held or flagged; snapshot immutable.

Residual risk: all of this is proven against a simulated provider. A real provider's event ordering and retry behaviour must be re-tested in its sandbox.

## H. Judges

Verified: only the assigned email reaches a scorecard and the first sign-in binds the account; a judge sees only their own scores; drafts persist across refresh; incomplete ballots cannot lock; locked ballots reject changes from the judge, the organizer and direct SQL; judging exists only on its own hostname.

Unverified: real sign-in on the judge hostname in production; behaviour on the judges' actual devices and the venue network.

## I. Tabulation

Formula (unchanged from the original): average, across locked ballots, of Σ(score × weight ÷ 100). Verified against an independent integer calculator for single and multiple judges and candidates, decimal weights and scores, perfect and zero scores, exact ties, near ties that display identically, eight judges saving and locking concurrently, and a hand-worked three-judge example. Draft and unlocked ballots never enter the ranking. Repeated finalization is refused. Printable result sheet, judge audit and points report carry a status label (Provisional / Final / Certified) and blank signature lines.

Finding fixed: the original rounded to two decimals before ordering, so a near tie could display as equal with no flag. Ranking now uses exact sums.

## J. Security

| Finding | Severity | Status |
| --- | --- | --- |
| One-vote ballot incompatible with the business model | High | Replaced; legacy rows frozen |
| No stored final result; "final" relied only on frozen inputs | High | Immutable snapshot with digest, re-verified on read |
| Near ties hidden by rounding | High | Fixed |
| No application status, history or search | Medium | Added |
| Candidates public only as a side effect of voting being open; no clearance record | Medium | Explicit publication with clearance |
| Thin audit trail (action and target only) | Medium | Details added; append-only |
| Organizer desk showed stale counts; clicks could be dropped during a refresh | Medium | Fixed (found in browser testing) |
| Judge scorecard unstyled on the preview hostname | Low | Fixed |
| No Content-Security-Policy or HSTS | Low | Added; CSP is report-only until sign-in is confirmed under it |
| CSV exports could carry spreadsheet formulas | Low | Neutralized |

Residual, not resolved:
- **Single organizer account.** All organizer power sits with one email (`REVIEWER_EMAIL`). Separate reviewer, finance and tabulation roles are not built. Compensating control: every action is in the audit log.
- **Sign-in depends on ChatGPT accounts** for the organizer and judges. Acceptable for a small named group; confirm each judge has one before the event. Supporters do not need an account: checkout is by email and the provider's verified payment.
- **The database trusts the Worker's shared secret.** Anyone holding `QOQ_SERVER_SECRET` can act as the organizer. Rotate it if exposure is suspected.
- **Rate limiting** depends on the D1 binding and on the platform supplying the visitor's address; unverified in production.
- **Capacity** is untested. No concurrency figure is claimed.
- **Legal compliance is not established** by the Privacy Notice and Terms. They describe actual behaviour accurately but have not been reviewed by counsel and carry no data protection officer contact.

## K. Deployment

See the table at the top of `docs/DEPLOYMENT.md`. In short: build and tests verified; **domains, hosting, Supabase project, storage bucket and secrets all UNVERIFIED**; deployed commit unknown; this branch is not deployed.

## L. Decisions needed from the organizers

1. Coronation Night time and venue; Screening Day venue.
2. Application closing date (none is set; the form stays open).
3. Official judging criteria and weights, the number of judges, and the tie-breaking rule.
4. What voting points decide and the award's name. The system keeps points and judges' scores separate until told otherwise.
5. Whether point totals are shown publicly during voting.
6. Voting open and close times, and the rule for payments confirmed after the deadline.
7. Refund policy.
8. Payment provider and the legal entity that receives the funds.
9. Final package names and denominations.
10. An official contact channel and a data protection contact for the Privacy Notice.
11. Legal review of paid voting (permit, tax, consumer and privacy questions listed in `docs/PAYMENTS.md`).
12. Who else, besides the single organizer account, needs access, and to what.

## M. Event-day checklist

See `docs/OPERATIONS.md`. The five that matter most:

- [ ] Release applied and smoke-tested in production at least a week before January 4
- [ ] Every judge has signed in on their own device, on the venue's internet
- [ ] Criteria total 100% and the tie rule is written down before judging opens
- [ ] Paper ballots printed
- [ ] A second person hand-checks the top three from the printed judge audit before certification
