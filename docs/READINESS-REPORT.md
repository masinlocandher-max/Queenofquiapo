# Queen of Quiapo 2027 — engineering readiness report

14 November 2026, revised 20 November after an adversarial design review · branch `claude/queen-of-quiapo-2027-so8cs2` · nothing in this report has been deployed.

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
- ~~Sign-in depends on ChatGPT accounts~~ Resolved 21 Nov: staff sign in with email + password or access code; ChatGPT is optional.
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
4. ~~What voting points decide~~ **Decided 21 Nov: the People’s Choice Award, separate from the title.** Still open: its tie rule, and whether an announced award stands if the winner’s payment is later refunded (the system currently keeps the announcement on the final snapshot).
5. Whether point totals are shown publicly during voting.
6. Voting open and close times, and the rule for payments confirmed after the deadline.
7. Refund policy.
8. Payment provider and the legal entity that receives the funds.
9. Final package names and denominations.
10. An official contact channel and a data protection contact for the Privacy Notice, and how long applications are kept.
11. Legal review of paid voting (permit, tax, consumer and privacy questions listed in `docs/PAYMENTS.md`).
12. Who else, besides the single organizer account, needs access, and to what.
13. Who holds the organizer password, and who can reset it (it is reset with `scripts/organizer-password.mjs` and the Supabase SQL editor).

## M. Event-day checklist

See `docs/OPERATIONS.md`. The five that matter most:

- [ ] Release applied and smoke-tested in production at least a week before January 4
- [ ] Every judge has signed in on their own device, on the venue's internet
- [ ] Criteria total 100% and the tie rule is written down before judging opens
- [ ] Paper ballots printed
- [ ] A second person hand-checks the top three from the printed judge audit before certification

## N. Design review, 20 November 2026

The platform was reviewed as if by an outside team, from security, money, scoring, privacy, event-night and public-perception angles. Every finding below was reproduced, fixed, covered by a test or a browser check, and the full suite (48 tests) and browser pass at 320–1280 px were re-run.

| # | Finding | Impact | Fix |
| --- | --- | --- | --- |
| 1 | The voting page said “Vote for your queen” although points do not decide the crown | Supporters could believe they were paying to choose the winner: consumer-protection and reputation risk | Headline is now “Support your queen”, and the page states that points are counted separately from the judges and that what they decide will be published first |
| 2 | After one purchase the page reopened the old receipt on every visit and hid checkout | Repeat purchases, the core of the model, were blocked in that browser | “Support again” button; each purchase gets a fresh request id |
| 3 | A refresh after starting a purchase lost the payment link | Buyer stranded on “Waiting for your payment” | The checkout address is stored on the order and returned on refresh or retry |
| 4 | The rehearsal payment adapter ran on the public preview hostname, which shares the production database; the docs told you to rehearse there | Simulated payments and points could enter the real ledger | Database marked production or staging; production refuses the rehearsal provider; Worker also requires `QOQ_DEPLOYMENT=staging`; docs corrected |
| 5 | Judges waiting for judging to open saw nothing change until they reloaded | Confusion and delay on stage night | Scorecard checks every 20 s and opens itself |
| 6 | Judges lost typed scores if they forgot to press Save | Data loss on a dead phone | Each score autosaves when the judge moves on, without disturbing what is being typed; Lock waits for any save in flight |
| 7 | The “edition model” was cosmetic: nothing stopped a second edition mixing with this one, and there was no way to record the coronation venue or time | Future data mixing; the readiness item could never be completed | One edition per database is enforced; organizer form for venues, coronation time and application window, with validation and audit |
| 8 | That new form overwrote what was typed if the organizer typed quickly after opening it (found in browser testing) | Wrong venue saved silently | Form is filled only while closed |
| 9 | Per-address limits (10 orders, 20 applications per 10 min) | Philippine carriers and venue Wi-Fi share one address across many people: real supporters and applicants would be turned away | 120 orders, 60 applications per 10 min, 300 status checks per minute; the per-email pending cap and payment itself remain |
| 10 | The public page still showed “open” after the scheduled closing time | Visitors tried to pay and were refused | Effective state used publicly; the desk shows “Past closing time” |
| 11 | After voting closed the page kept asking visitors to choose a queen and a package | Confusing, reads as still open | Becomes a gallery with a closed notice |
| 12 | Candidate cards filled a whole phone screen each | With many candidates, packages are thousands of pixels down | Two per row on phones |
| 13 | A mismatch between the Worker's and the database's provider was found only at the first webhook | Paid orders whose notifications are refused | Checked before any order is created |
| 14 | One payment stuck in “processing” blocked finalization forever | Points could never be finalized | Set-aside action: closed voting only, after one hour, with a reason; a late capture is held, not lost |
| 15 | The Privacy Notice promised a retention period, and the Terms declared decisions “final” — neither was decided by the organizers | Invented policy | Replaced with accurate, non-committal text; retention period listed as an open decision |

Still open after the review (not fixable in code): the single organizer account; ChatGPT accounts for judges and the organizer; no confirmation email; the legal questions on paid voting; and everything about production infrastructure, which remains UNVERIFIED.

## O. Changes on 21 November 2026

**People’s Choice Award.** Voting points now decide the People’s Choice Award, named on the voting page, Voting Rules, Terms, desk and printed points report. It is announced on the Results page by a separate organizer action, only from the final points snapshot; a tie is shown as a tie and needs explicit acknowledgement; the winning total is shown only if the organizer chooses. Verified by `tests/db-award.mjs` and in the browser.

**No ChatGPT account required.** Applicants and supporters never needed one. Staff now sign in with the site’s own accounts: the organizer with email + password, judges with email + an access code issued, reset or revoked from the desk. Passwords and codes are hashed (PBKDF2-SHA256, 100,000 iterations) before storage; sessions are host-only, HttpOnly, Secure, SameSite=Strict cookies signed with a key derived from the server secret and re-checked against the database on every request, so a reset or revocation takes effect at once. Ten wrong attempts lock an account for 15 minutes. ChatGPT sign-in still works as an option and can be hidden with `QOQ_CHATGPT_SIGNIN=off`. Verified by `tests/access.mjs` (7 tests) and by a full browser run in which the organizer and a judge never use ChatGPT.

A bug found while testing — every site session was being rejected because of an ambiguous column name in the session check — was fixed before commit.

Remaining limits: a judge should keep to one sign-in method (the first account used is bound to the ballot); there is still one organizer account; there is no self-service “forgot password” email because no email provider exists.

## P. Applicant journey, 22 November 2026

Reviewed as an applicant on a phone with Philippine mobile data. Verified end to end in an emulated phone browser with throttled upload, and by `tests/applicant.mjs` (5 tests; suite now 64).

| Problem an applicant would hit | Now |
| --- | --- |
| Photos over 5 MB rejected — common for current phone cameras (12–50 MP) | Photos are resized on the phone (longest side 2,400 px, JPEG) before upload. A 13.1 MB camera photo arrived as 2.8 MB. |
| Hidden GPS location of the applicant’s home sent to the organizers | Re-encoding removes location and camera data; verified on the stored file. The Privacy Notice now says so. |
| No upload progress; a 90-second cut-off could kill a slow but working upload | Live percentage and progress bar; five-minute allowance. |
| An accidental reload lost everything typed | Typed answers are kept for that browser tab (not photos, never after the tab closes — shared phones). |
| A reload after a lost reply created a duplicate application | The form’s private id survives a reload; a retry returns the same receipt. A changed retry after the first arrived now shows that receipt with a clear note instead of an error. |
| A reload after success showed an empty form | The receipt stays on screen; “Submit another application” starts fresh for someone else on the same phone. |
| No way to know later whether the application arrived | `/apply/status/` with reference + email shows a coarse stage. Decisions are not disclosed; one message for every mismatch. Rate limited. |
| Withdrawal only possible while the receipt was open | Receipt shows a private withdrawal key; withdraw any time, from any device, on the status page. |
| A closed application window was discovered only after filling the form and uploading | The form shows the deadline in advance and says so before anything is typed when closed. |
| Robotic validation (“Value must be ≥ 100”) | Plain messages with an example for every measurement. |
| Receipt always said the venue was “to be announced” | Shows the screening venue once the organizer records it. |
| No link to privacy information at the consent | Consent links to the Privacy Notice. |

Not changed, by design: the photo requirements, the screening guide and every field the organizers defined. No confirmation email (no email provider exists).
