# Queen of Quiapo source reconciliation

20 November 2026, Asia/Manila. Authorized scope: reconcile the source with the existing public website, complete domain setup where account access permits, and prepare the operating rules and commercial terms for approval.

## Source baseline and changes

The production baseline inspected for this reconciliation was Sites version 16, source `d8eb93ee31548f14bbaee36ca7a2ed00b3f1fdbc`. GitHub PR #1 started at `f10c67aff4ff9eea606714976d292a0c843ca51a`, tree `1697b1b2ee97cb391c1c2196952e8fedb8926dd3`. The inspected GitHub snapshot reproduces that complete tree exactly.

The reconciliation imports the already-deployed gemstone storefront, Home navigation, package rendering and minimum-price checks into the GitHub branch. The imported `public`, `server`, `config` and `scripts` directories first matched that deployed source byte for byte. Final review found a stale public rules table still using the old package names; the six labels are now corrected to match the gemstone storefront. This table correction is the only runtime-file change relative to the production baseline. No voting, scoring or payment behavior changes.

Both source trees now include the seven already-applied SQL files with filenames matching production migration versions and names. Fresh read-only hashes of all seven stored SQL bodies match [the migration map](PRODUCTION-MIGRATION-MAP-2026-11-16.json). No production migration was replayed, repaired or reset. The Sites-only legacy SQL test files remain intact. Each repository retains its own hosting manifest; Sites retains its project ID, DB and BUCKET bindings.

Tests now use the gemstone names and account for the six additional rename audit events. The upgrade regression preserves application rows/events, candidate and package IDs, historical order snapshots, payment events, ledger entries and all prior audit entries. Documentation now identifies older infrastructure and package descriptions as historical.

## Verification

- Full suite rerun on 20 November: **44 passed, 0 failed, 0 skipped**, with `QOQ_REQUIRE_TEST_DB=1`.
- Real disposable PostgreSQL 18.6, reached only on loopback. A test-only Node pg bridge supplies the psql interface. The target production project reports PostgreSQL 17.11; this run is not a target-version compatibility or load certification.
- Worker HTTP tests use simulated Supabase transport and in-memory private media backed by the disposable SQL database. They are not live payment-provider, production upload or real judge sign-in tests.
- Browser verification: all six live gemstone selections display the correct amount and points while the payment-unavailable notice stays visible. The local 390-pixel homepage preview renders the approved hero and mobile header without visible clipping. This is a focused visual check, not a complete launch journey rehearsal.
- Build emits 47 public assets. All seven migration hashes are unchanged. `git diff --check` passes.
- Production read-only state: phase `setup`, voting `not_configured`, payments disabled, provider unset, package approval unset, public point totals off, and no configured judging criteria. Application close and voting times remain unset. Counts for applications, candidates, judges, orders and ledger rows are zero; no contents of private records were retrieved.
- Current catalog: Quartz PHP100/1,000 points; Amethyst PHP500/5,000; Sapphire PHP1,000/10,000; Emerald PHP2,500/25,000; Ruby PHP5,000/50,000; Diamond PHP10,000/100,000. The fixed rate and minimum remain enforced.

No synthetic production applicants, purchases, votes or ballots were created. No merchant, provider, commercial approval, judging criterion or schedule was invented or activated. The corrected public rules table requires publication from the synchronized source; confirm its saved version and deployment status before claiming it is live. The PR remains a draft for review.

## Domains and launch decisions

A fresh hosting validation on 20 November still reported all five custom names pending. GoDaddy's zone showed seven existing records: one root A record, www pointing to the root, the existing NS/SOA records, Domain Connect and DMARC. An additive 12-record import was prepared: the second root A address, three service CNAMEs, five ownership TXT records and three certificate-validation TXT records. GoDaddy requires the account owner's SMS verification before committing the import. Do not claim these records or the domains are active until the zone and hosting validation confirm them.

The private rules and commercial review pack separates proposed terms from approved configuration. It covers the People's Choice award, gemstone catalog, deadlines, refunds, late confirmations, tie treatment, judging criteria, service scope, a proposed fixed fee, payment recipient and settlement controls. It is not an executed agreement and is not public website policy.

Remaining launch work: complete DNS identity verification and validate HTTPS/host access; obtain named organizer decisions and signed commercial terms; publish approved candidates and rules; integrate and verify a real payment provider; rehearse actual organizer/judge access, devices, private uploads and certification. Payments remain disabled until that separate launch work is accepted.
