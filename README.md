# Queen of Quiapo

Mobile-first pageant site managed by FMB&CO, Barangay 306, Quiapo, Manila. The public sections are About, Pageant Schedule, Apply Now, and Vote. The schedule contains the candidate screening guide.

## Running and testing

Use Node 22 or later. `npm test` builds the Worker and runs every suite. The database suites need a local PostgreSQL (see `docs/DEPLOYMENT.md`) and skip when it is absent; each builds a disposable database from the migrations. The Sites runtime supplies trusted sign-in identity and environment bindings. The logical bindings are DB (D1, request throttling and the legacy inbox) and BUCKET (private R2, legacy inbox only).

After building, `npm run dev` previews the Worker locally without production identity or data bindings. The development-only `/__preview/responsive?width=390` route frames the public pages at 320, 390, or 768 pixels.

| Document | For |
| --- | --- |
| `docs/READINESS-REPORT.md` | What is verified, what is not, and the open decisions |
| `docs/OPERATIONS.md` | Screening Day and Coronation Night procedures, contingencies, paper ballot |
| `docs/DEPLOYMENT.md` | Release sequence, rollback, smoke test, test suites |
| `docs/PAYMENTS.md` | Purchased-points model, ledger, payment switches and the activation gate |
| `config/edition.json` | The single source for edition dates; a test checks every page, calendar file and the database seed against it |
| `.env.example` | Environment variable names |

The public pageant identity is `public/pageant.css`; `public/voting.css` adds the candidate, package, results and policy pages. Organizer and judge presentation and authorization are independent.

`public/assets/pageant-atmosphere.webp` is a decorative background generated for the website. It contains no contestants, crown, venue, or other purported event photography.

## Roles and domains

| Address | Purpose |
| --- | --- |
| queenofquiapo.com | Public information, candidate application and official notices. The root hostname rejects private backstage URLs. |
| org.queenofquiapo.com | Organizer-only application review, official candidate/photo roster, judge and criteria setup, announcements, voting controls and tabulation. |
| judge.queenofquiapo.com | Assigned judges authenticate and submit their individual scorecards. |
| vote.queenofquiapo.com | Official candidates and voting packages. Payment is off: the page states “Payment coming soon” and no order can be created. |

The retained Sites hostname supports role-checked /organizer/ and /judge/ paths for private testing. Host binding, DNS/TLS and site audience settings are separate deployment steps.

## Data and activation

Apply the migrations in supabase/migrations in filename order to the selected Supabase project. Back up first and follow `docs/DEPLOYMENT.md`. They isolate pageant records in qoq_private, revoke direct table access, protect the private photo bucket and expose narrowly scoped RPCs. Set up one settings record using a SHA-256 hash of a cryptographically random server secret. Never commit the secret. Deploy supabase/functions/qoq-media using its application-level authentication and bootstrap its restricted qoq-private-media bucket before switching the intake backend.

The Worker runtime requires REVIEWER_EMAIL (verified owner), QOQ_RATE_SALT, QOQ_SUPABASE_URL, QOQ_PUBLISHABLE_KEY and QOQ_SERVER_SECRET. Originals of private application photographs and separate approved publicity photos use different object namespaces. Keep the Supabase service-role key confined to its Edge Function. No candidate contact, private photograph, roster, judge score, secret or live vote belongs in this repository.

When QOQ_INTAKE_BACKEND is explicitly set to legacy, the original application inbox remains on its D1/R2 store. Take the intake offline briefly or stop new submissions for the final count/check before changing backends. If existing entries are present, reconcile full records, private media and withdrawal keys before switching. A Supabase outage must never silently split records across stores. Configure the full production connection, test a synthetic submission and withdrawal, and test the organizer role before opening applications to the public.

## Event operations

The full procedures are in `docs/OPERATIONS.md`. In outline:

1. Applications move through Submitted → Under review → Qualified → Screening completed → Approved (or Correction requested, Not selected, Withdrawn). Every change records who and when. An approved applicant is added to the roster by name only; she is public only after a number, a recorded publicity clearance and an explicit Publish.
2. The organizer assigns judges by email and defines weighted criteria totaling 100%, then opens judging, which freezes roster, judges and criteria. Judges save drafts and lock their ballot; a locked ballot cannot be changed by anyone.
3. A candidate's score is the average across locked ballots of each judge's weighted total. Ranking compares exact sums; ties are flagged and never broken by the system. Final lock stores an immutable snapshot with a digest that is re-verified on every read. Results are certified, then published, as separate organizer actions.
4. Voting uses purchased points at a fixed ₱100 = 1,000 points, kept in an append-only ledger and credited only from signature-verified provider events. It is a separate result from judging. Payment collection is off; see `docs/PAYMENTS.md`. The earlier one-vote-per-account ballot is retired and its records are read-only.
5. Only published announcements, published candidates and published results are returned to the public site.

No candidate contact, private photograph, roster, judge score, secret or payment record belongs in this repository. Functional tests are not a capacity benchmark.
