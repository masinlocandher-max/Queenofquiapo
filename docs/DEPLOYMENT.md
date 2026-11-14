# Deployment and activation

## What I could and could not verify (14 November 2026)

| Item | Status |
| --- | --- |
| Build, 41 automated tests, browser run at 320–1280 px | **Verified locally** |
| Migrations on a clean database and over an existing live edition | **Verified locally** (PostgreSQL 16; production Supabase runs 17) |
| `queenofquiapo.com`, `www`, `org.`, `judge.`, `vote.` DNS, TLS and routing | **UNVERIFIED** — the build environment's network policy blocks these hosts |
| Hosting project and deployed version | **UNVERIFIED** — the site is hosted on the ChatGPT Sites runtime (`queen-of-quiapo.fbautisat23.chatgpt.site`); there is no deploy access from this repository |
| Supabase project, applied migrations, Edge Function, private bucket | **UNVERIFIED** — the connected Supabase account holds only two unrelated, inactive projects; no Queen of Quiapo project is visible |
| Secrets and environment variables | **UNVERIFIED** — names are documented in `.env.example`; values were never visible |

Nothing in this branch has been deployed. Production is exactly as it was.

## Release sequence

1. **Back up** the production database (Supabase dashboard → Database → Backups, or `pg_dump`).
2. **Rehearse the migration** on a Supabase branch or a restored copy: apply `supabase/migrations` in filename order. The three files dated `20261114…` are additive; they delete nothing and keep legacy votes read-only.
3. **Apply to production** in a quiet period. They run in seconds.
4. **Deploy the Worker** from this branch (`npm run build`, then publish `dist/` through Sites).
5. **Do not set any payment variable.** Leave `QOQ_PAYMENTS_ENABLED` unset.
6. **Smoke test** (below). Keep `QOQ_CSP` unset (report-only) until sign-in is confirmed, then set `QOQ_CSP=enforce`.

Order matters: the new Worker calls database functions that exist only after step 3. Deploying the Worker first would make the organizer desk and voting page show "temporarily unavailable" (applications would still be accepted).

**Rollback:** redeploy the previous Worker build. The new tables and columns can stay; the previous Worker ignores them. The one behaviour that does not roll back is the retired one-vote ballot — by design.

## Production smoke test (non-destructive)

- [ ] `https://queenofquiapo.com/` loads over HTTPS; `www` redirects or serves the same site
- [ ] `/vote/` shows six packages and "Payment coming soon"; there is no pay button
- [ ] `/candidates/` and `/results/` show their "to be announced" states
- [ ] `https://queenofquiapo.com/organizer/` returns 404; `https://org.queenofquiapo.com/` asks for sign-in
- [ ] Signed in as the organizer: the desk loads, Overview shows the readiness list
- [ ] Signed in as any other account on `org.`: "does not have access"
- [ ] `https://judge.queenofquiapo.com/` signed out: sign-in prompt; signed in as a non-judge: no access
- [ ] `POST /api/competition/order.create` returns 409 "coming soon"
- [ ] Submit one real test application from a phone, find it in the inbox, open both photos, then remove it
- [ ] Organizer desk → Audit log shows the removal

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
| `db-intake.mjs` | Status lifecycle, inbox, promotion, roster lock, upgrade over live data, privileges |
| `e2e-platform.mjs` | Real HTTP through the Worker into PostgreSQL: application reliability, private review, a judging night, a signed rehearsal payment, security headers |
| `edition-consistency.mjs` | Every page, calendar file and the database seed agree with `config/edition.json` |
