> Historical audit of 16 November. The source corrections described here were reverified and applied on 20 November; see [SOURCE-RECONCILIATION-2026-11-20.md](SOURCE-RECONCILIATION-2026-11-20.md).

# Queen of Quiapo 2027 — verified production state, 16 November 2026

This records the existing production state inspected on 16 November 2026 (Asia/Manila). No deployment or production data mutation was made during this audit.

## Public website and catalog

Public URL: https://queen-of-quiapo.fbautisat23.chatgpt.site/

Voting URL: https://queen-of-quiapo.fbautisat23.chatgpt.site/vote/

Sites version **16**, source commit `d8eb93ee31548f14bbaee36ca7a2ed00b3f1fdbc`, deployment `appgdep_6afa47fe6f1881919b9d01e7bf6db2ef` succeeded at 08:02:28 Philippine time on 16 November 2026. Audience is public. Version 14 and commit `4c4326d411e8b8e3ec06b2e5cb53dd6d69e263d5` remain historical releases.

The public browser page, each package-selection summary, the public catalog API and production database agree:

| Package | Price | Points |
| --- | ---: | ---: |
| Quartz | ₱100 | 1,000 |
| Amethyst | ₱500 | 5,000 |
| Sapphire | ₱1,000 | 10,000 |
| Emerald | ₱2,500 | 25,000 |
| Ruby | ₱5,000 | 50,000 |
| Diamond | ₱10,000 | 100,000 |

The page explicitly states a ₱100 minimum and a fixed rate of ₱100 = 1,000 points, without discounts or bonuses. Database constraints require `points >= 1000`, `price_centavos >= 10000` and `price_centavos = points * 10`.

## Payment and approval state

- Public catalog: `paymentsEnabled=false`, voting `not_configured`, no candidates and no opening/closing times.
- All six package selections leave checkout hidden and its submit button disabled; “Payment coming soon” remains visible.
- Hosted configuration revision 3: `QOQ_PAYMENTS_ENABLED=false`; no provider or webhook secret configured.
- Database: `payments_enabled=false`, `payment_provider=null`, `packages_approved_at=null`.
- The Worker payment adapter supports only local rehearsal hosts. Its payment code matches GitHub head `f10c67aff4ff9eea606714976d292a0c843ca51a`.
- No live order-creation or webhook request was sent. The public catalog POST reads data. Checkout refusal is exercised in isolated tests.

Renewed package approval remains required. Approval of the source proposal is not commercial package approval or payment activation.

## Migration history and data

Supabase project `wzrjhtanzdtyrhwstkxx` has seven recorded migrations. Their stored SQL bodies match GitHub byte for byte. The gemstone migration is recorded as version `20261115235136`, name `qoq_stone_packages`; its previous repository filename was `20261116010000_qoq_stone_packages.sql`.

[PRODUCTION-MIGRATION-MAP-2026-11-16.json](PRODUCTION-MIGRATION-MAP-2026-11-16.json) maps all previous filenames to recorded versions, names, SHA-256 hashes and proposed filenames. The proposal renames source files to mirror the existing production ledger. SQL is unchanged. **Do not replay these migrations, reset the database or repair production history as part of this proposal.** Review a fresh migration list before any future database deployment.

The migration renames packages in place, preserving IDs, prices and points. The historical 25,000-point Diamond becomes Emerald; the 100,000-point Crown becomes Diamond. Historical order snapshots retain the name at purchase. Package approval is revoked and payments disabled.

Read-only current counts: applications 0, candidates 0, orders 0, ledger entries 0; phase setup. These observations do not authorize a reset. D1/R2 bindings remain intact. No applications, media, candidates, scores, orders, ledger entries, access controls or payment settings were changed.

## Source reconciliation

PR #1 remains open and draft at `f10c67aff4ff9eea606714976d292a0c843ca51a`. Its description still refers to private version 11 and unavailable Supabase infrastructure; that is stale.

The live Sites source has gemstone storefront files, package rendering, minimum checks, the organizer input minimum and Home navigation missing from GitHub. The Sites source omits the already-applied gemstone migration and release record. The proposal reconciles source and documentation without deployment.

The `redirect: 'manual'` compatibility fix is already present in both repositories' database and media modules; the earlier statement that it still needed synchronization is obsolete.

## Verification and limitations

The unmodified GitHub head was reproduced from 84 SHA-verified files. Its isolated PostgreSQL 18.6 suite produced **30 passes, 13 failures, zero skips**: tests still used old package names and the legacy-upgrade test did not account for six added rename audit events. The previous 43-pass result does not describe this head.

The proposal updates those fixtures, checks rejection of inserts/edits below the minimum, and adds an upgrade test preserving applications/events, candidates, package IDs and values, historical purchases, payment events, credited points and prior audit rows. Final validation: **44 tests passed, zero failed and zero skipped**, with QOQ_REQUIRE_TEST_DB=1 against disposable PostgreSQL 18.6. The Worker build includes 47 public assets. All seven migration hashes remain unchanged, both source patches pass apply checks, and the proposed public/server files exactly match the deployed source.

This audit verified the desktop voting page and all six selections. It did not repeat full mobile, organizer, judge, live-upload or custom-domain acceptance tests. Prior release claims about private-media setup and D1 counts before switching storage remain historical evidence. Candidates, judges, criteria, deadlines, commercial policies, renewed package approval and a real payment provider are separate launch decisions.
