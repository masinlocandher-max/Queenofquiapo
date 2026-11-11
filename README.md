# Queen of Quiapo

Mobile-first pageant site managed by FMB&CO, Barangay 306, Quiapo, Manila. The public sections are About, Pageant Schedule, Apply Now, and Vote. The schedule contains the candidate screening guide.

## Running and testing

Use Node 24 or later. Run `npm run build` to bundle the Worker and public assets, then `node --test tests/worker-access.mjs`. The Sites runtime supplies trusted sign-in identity and environment bindings. The logical bindings for the existing application service are DB (D1) and BUCKET (private R2). Add the deployment-specific project ID to the local hosting manifest before publishing.

After building, `npm run dev` previews the same Worker locally without production identity or data bindings. Rebuild after source edits. The development-only `/__preview/responsive?width=390` route frames the public pages at 320, 390, or 768 pixels; add `&page=/apply/` to inspect a specific public route.

The public visual layer is `public/refinement.css`: the transparent emblem and original wordmark occupy their own column alongside the pageant invitation, with the existing galaxy image softly fading into the pearl page behind the artwork. Event dates and application preparation follow. The artwork stacks above the invitation on mobile. Public task pages share the same typography and spacing. Organizer and judge presentation and authorization are independent.

## Roles and domains

| Address | Purpose |
| --- | --- |
| queenofquiapo.com | Public information, candidate application and official notices. The root hostname rejects private backstage URLs. |
| org.queenofquiapo.com | Organizer-only application review, official candidate/photo roster, judge and criteria setup, announcements, voting controls and tabulation. |
| judge.queenofquiapo.com | Assigned judges authenticate and submit their individual scorecards. |
| vote.queenofquiapo.com | Shows availability. No ballot is offered before an approved roster and explicit opening. |

The retained Sites hostname supports role-checked /organizer/ and /judge/ paths for private testing. Host binding, DNS/TLS and site audience settings are separate deployment steps.

## Data and activation

Apply the migrations in supabase/migrations in filename order to the selected Supabase project. They isolate pageant records in qoq_private, revoke direct table access, protect the private photo bucket and expose narrowly scoped RPCs. Set up one settings record using a SHA-256 hash of a cryptographically random server secret. Never commit the secret. Deploy supabase/functions/qoq-media using its application-level authentication and bootstrap its restricted qoq-private-media bucket before switching the intake backend.

The Worker runtime requires REVIEWER_EMAIL (verified owner), QOQ_RATE_SALT, QOQ_SUPABASE_URL, QOQ_PUBLISHABLE_KEY and QOQ_SERVER_SECRET. Originals of private application photographs and separate approved publicity photos use different object namespaces. Keep the Supabase service-role key confined to its Edge Function. No candidate contact, private photograph, roster, judge score, secret or live vote belongs in this repository.

When QOQ_INTAKE_BACKEND is explicitly set to legacy, the original application inbox remains on its D1/R2 store. Take the intake offline briefly or stop new submissions for the final count/check before changing backends. If existing entries are present, reconcile full records, private media and withdrawal keys before switching. A Supabase outage must never silently split records across stores. Configure the full production connection, test a synthetic submission and withdrawal, and test the organizer role before opening applications to the public.

## Event operations

1. The organizer enters approved public names and cleared candidate photos, nominates judges by email, and defines weighted criteria totaling 100%.
2. The organizer opens judging. Each assigned judge can save their own draft, review the full scorecard, then lock it. Locking is irreversible for that edition. Incomplete ballots cannot be locked. The configuration freezes at scoring start.
3. The organizer can inspect the locked ballots and the weighted tabulation. Final lock requires every judge's submitted ballot. A final score snapshot stays immutable. Ties remain ties unless an approved competition rule is defined for a future edition.
4. Public voting is a separate tally. Opening requires at least one eligible candidate and an explicit organizer action. The database enforces one accepted vote per account and verified email in the current edition. The edge limits attempts and rejects cross-origin writes. Public votes do not enter the judges' scores.
5. Only approved published announcements are returned to the public site. Drafts, internal scorecards and totals remain private. Supabase tests in supabase/tests run transactionally on test infrastructure. Never run vote or score fixtures in a production edition.

Before public release, verify DNS and certificates, signed-out access, judge assignment, locked ballot immutability, a full scoring rehearsal in a disposable environment, and rate limits under traffic representative of your event. Functional tests are not a capacity benchmark.
