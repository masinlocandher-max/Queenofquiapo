# Deployment and activation

Read [SOURCE-RECONCILIATION-2026-11-20.md](SOURCE-RECONCILIATION-2026-11-20.md) for the current source verification and [PRODUCTION-RELEASE-2026-11-16.md](PRODUCTION-RELEASE-2026-11-16.md) for the production baseline. The public site has Supabase configured. The gemstone rules-table correction was published and verified in version 17; all five custom domains are active with active certificates. The previous D1-only/private-site description is historical.

## Source reconciliation authorized on 20 November

1. Synchronize the already-live public files into GitHub PR #1, preserving the Sites project identity and D1/R2 bindings.
2. Align migration filenames with the seven existing production migration records using [PRODUCTION-MIGRATION-MAP-2026-11-16.json](PRODUCTION-MIGRATION-MAP-2026-11-16.json). Every SQL body is unchanged and already applied. Do not run these migrations again or edit production migration history.
3. Synchronize the missing gemstone migration and current release documentation into the Sites source repository. Saving source does not require a new production deployment.
4. Run the corrected suite against a disposable local database with QOQ_REQUIRE_TEST_DB=1. Keep the PR draft until the source review is accepted.
5. Source reconciliation preserves the deployed application, draft PR status, backend, payment gates and public audience. It does not activate purchases or approve commercial terms.

## Future deployments

Capture the then-current live version and migration ledger before proposing any change. Review a version-specific diff and backup/recovery plan. Keep application data and private media available; never reset production to reconcile source. Deploy only a reviewed saved version within the organizer-authorized scope, preserve the public audience, and recheck the catalog and payment gates. A rollback must be reviewed for compatibility with the current database; an arbitrary older Worker may not support it. Never assume a catalog code change authorizes a payment launch.

## Future acceptance checks

- [ ] `https://queenofquiapo.com/` loads over HTTPS; `www` redirects or serves the same site
- [ ] `/vote/` shows six packages and "Payment coming soon"; there is no pay button
- [ ] `/candidates/` and `/results/` show their "to be announced" states
- [ ] `https://queenofquiapo.com/organizer/` returns 404; `https://org.queenofquiapo.com/` asks for sign-in
- [ ] Signed in as the organizer: the desk loads, Overview shows the readiness list
- [ ] Signed in as any other account on `org.`: "does not have access"
- [ ] `https://judge.queenofquiapo.com/` signed out: sign-in prompt; signed in as a non-judge: no access
- [ ] Exercise order creation refusal in an isolated rehearsal. Do not POST to the production order route without approval; even refusal may update rate-limit records.
- [ ] Verify application availability without submitting synthetic production records; perform submission/review/removal in an explicitly isolated rehearsal
- [ ] In the isolated rehearsal, Organizer desk → Audit log shows the authorized removal

## Running the tests

```
npm test          # builds, then runs every suite
```

Database suites need a local PostgreSQL (`QOQ_TEST_PG`, default `postgres://postgres@127.0.0.1:54329`) and skip when it is absent. Each suite builds its own database from the migrations and drops it. Never point `QOQ_TEST_PG` at production.

| Suite | Covers |
| --- | --- |
| `worker-access.mjs` | Host and role isolation, secret handling, checkout refusal, rate limits |
| `db-tabulation.mjs` | Weighted scoring against an independent calculator, ties, near ties, locks, snapshot, certification, concurrency |
| `db-points.mjs` | Fixed rate, payment gates, crediting, duplicates, 60 concurrent payments, refunds, reversals, late settlement, finalization |
| `db-stone-upgrade.mjs` | Preserves applications, candidate and package IDs, historical purchases, credited points and audit history through the gemstone migration |
| `db-intake.mjs` | Status lifecycle, inbox, promotion, roster lock, upgrade over live data, privileges |
| `e2e-platform.mjs` | Real HTTP through the Worker into PostgreSQL: application reliability, private review, a judging night, a signed rehearsal payment, security headers |
| `edition-consistency.mjs` | Every page, calendar file and the database seed agree with `config/edition.json` |
