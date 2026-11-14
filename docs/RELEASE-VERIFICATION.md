# Release verification — 15 November 2026 (Asia/Manila)

Reviewed source: `92c9b7c`, branch `claude/queen-of-quiapo-2027-so8cs2`.
This follow-up supersedes the earlier report's infrastructure assumptions, not its unresolved business decisions.

## Verdict

Production release: **NO-GO until backend provisioning and migration rehearsal are complete**.
Software verification: **CONDITIONAL GO**, with the limits below.
Paid voting: **NO-GO**, intentionally disabled. No live transaction was created.

## Independently verified

- Sites project `appgprj_6af16c8a0d24819187a8ae5adb1a2fdf` exists and remains owner-private, version 11. This reviewed branch is not deployed.
- Production has `QOQ_INTAKE_BACKEND=legacy`, a configured reviewer secret and rate-limit salt. It has no Supabase URL, publishable key or server secret configured.
- Existing D1 binding `DB` contains `applications` and `qoq_throttle`. Private record contents were not retrieved.
- The connected Supabase account exposes healthy projects named withlovefmb and Masinloc Connect, neither a Queen of Quiapo project. They were not repurposed.
- All five configured domain records remain pending after a fresh platform validation. Root and www have active SSL; org, judge and vote still await SSL validation.
- 43 automated tests passed, zero failures and zero skips, against disposable PostgreSQL 18.6 databases. The local environment lacked psql, so a test-only Node pg command bridge ran the suite's SQL against the real server; boolean formatting was matched to psql. HTTP tests invoke the Worker handler with Request objects and simulated Supabase transport/private media, not a live gateway or deployed Edge Function.
- The suite covers weighted judging, immutable snapshots, application lifecycle and upgrade preservation, payment replay/concurrency, reversals, server authorization and public-page consistency. These checks do not establish production capacity or legal compliance.
- Browser spot-check at a 390px iframe (375px content viewport due to scrollbar): no horizontal overflow, header computed relative and fully transparent, church image loaded at 20% opacity. The previous agent's full 320–1280px browser workflow was not independently repeated here.

## Corrections in this follow-up

1. The production ChatGPT Sites hostname was classified as preview, which also permitted the simulated payment adapter when rehearsal switches were set. The adapter now additionally requires localhost or 127.0.0.1; order creation, catalog availability and callbacks reject it on the live hostname. Added a regression test.
2. Webhook body reading now stops at 64 KiB even without Content-Length. Added a regression test. Invalid currency strings are rejected instead of truncated into valid currency codes.
3. Restored the approved version-11 hero, low-opacity church asset, and transparent non-sticky header while retaining the branch's new navigation and operational pages.
4. Test databases are restricted to loopback addresses. `QOQ_REQUIRE_TEST_DB=1` makes absent database infrastructure fail rather than skip. Parallel test role creation tolerates the PostgreSQL unique-key race.

## Release blockers and next steps

1. Identify/connect or provision the dedicated Queen of Quiapo Supabase project. Do not use either unrelated project. Configure its private media function/bucket, server-side RPC secret and publishable key through secure infrastructure tools.
2. Rehearse all migrations on the actual target PostgreSQL version. Determine how existing D1 applications and R2 photos remain reviewable before switching intake; the branch's Supabase upgrade test does not migrate live D1/R2 records. Do not change QOQ_INTAKE_BACKEND until that preservation path is verified.
3. Complete the outstanding GoDaddy DNS verification and revalidate each hostname.
4. Reconcile this GitHub release into the Sites source checkout, preserving `.openai/hosting.json` project identity and current audience. Test and package that exact source before deploying.
5. Verify hosted identity headers, private storage access and organizer/judge behavior in a controlled rehearsal. Existing organizer-only authorization is not separated finance/reviewer/tabulation access.
6. Run non-destructive production smoke tests after deployment. Use an explicitly authorized isolated workflow for synthetic applications; never insert fake production candidates, payments or ballots.

No production credentials, votes, scores, applications or access settings were changed during this review. No payment activation was attempted. Award rules, criteria, package approval, refund/late-settlement policy, merchant/provider selection and legal review remain organizer decisions recorded in READINESS-REPORT.md.
