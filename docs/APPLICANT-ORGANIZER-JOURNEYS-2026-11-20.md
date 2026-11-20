# Applicant and organizer journeys — 20 November 2026

This review covers applicant intake and organizer entry/review. It does not certify the remaining voting, judging, payment-provider or final event-launch journeys. The source baseline was public Sites version 18 (44af7d943b818dc8baccce2df999aa6955277e79) and GitHub release branch 97b7f03d785f7f0c2d133af8fb706059e8871e23.

## Applicant experience

- Preparation checklist followed by five focused sections with visible progress and Back/Continue controls. Required fields are validated before advancing; the optional profile can be skipped.
- “Pageant name” replaces the ambiguous “Female name” label without changing the stored field. Contact guidance, measurements and existing photo requirements remain intact.
- Application availability comes from the existing public event API. An outage does not claim applications are open or permit an unverified submission. Entries can still be prepared while availability is checked.
- Local photo previews, supported-format/size feedback and removal controls precede a complete editable review. Screening consent remains required and public use still requires separate permission.
- Uploading locks the form. An ambiguous acknowledgement retains the identical FormData and submission ID for retry, preventing edits from producing a conflicting retry. A definitive rejection restores editing. Neither personal data nor photos are saved to browser storage.
- Receipt includes the server timestamp, reference-copy action, text download and print. A missing timestamp is not replaced with a fabricated receipt time. Receipt explains screening, unpublished status and the absence of automated confirmation email. Withdrawal still requires an explicit confirmation.

## Organizer experience

- Branded role-specific entrances distinguish signed-out, wrong-account and service-failure states. Sign-in, sign-out/account switching, retry, public website and applicant links are explicit.
- Authorized desk identifies only the current authenticated email (HTML-escaped) and offers sign-out. The assigned organizer email is never shown to a denied or anonymous visitor.
- Overview provides direct links to application review, roster preparation and judging setup, plus a refresh timestamp. Zero received applications is “Awaiting applications,” not a completed review task.
- Inbox has loading/retry, empty-search guidance, Clear filters, accurate visible-row counts and guarded asynchronous responses so an older request cannot replace a newer view.
- Applicant details and private photographs appear before decision controls. Review actions disable repeated clicks, keep a private history and do not claim to send email. An unsaved note warns before leaving.
- On an authorization failure, private sections are hidden, applicant/photo detail is cleared, navigation is disabled, and recovery replaces the stale session identity. An in-flight response cannot reopen a workspace after denial.

## Verification

- 47 automated tests passed, zero failures/skips, with database execution required on disposable PostgreSQL 18.6. Production remains PostgreSQL 17.11; this is not an exact production-engine certification.
- Three new Worker tests cover safe account recovery, escaped authenticated identity/no-store responses, and assignment-service failure without private workspace exposure.
- The 15 access/edition checks passed again after presentation adjustments. Subsequent edits are applicant closed-window guidance and session presentation, with final syntax/build checks.
- Browser rehearsal exercised missing required fields, forward/back navigation, optional-profile skipping, rejected text-file upload, valid photo previews, review edits with preserved values, a simulated lost acknowledgement followed by an identical successful retry, receipt download, and withdrawal cancellation.
- Browser rehearsal exercised organizer overview, search with no matches, Clear filters, applicant details, private note/status history, and expiry of an already-loaded session. Private records disappeared and sign-in recovery appeared.
- Mobile layouts were visually reviewed using the local responsive preview at 390 px; this is browser viewport verification, not a physical-device test.
- Local fixture routes are implemented only in scripts/journey-preview.mjs, imported by the development server. They are not included in the built production Worker. They use simulated records, no production credentials and no production data bindings. Fixtures are explicitly labelled LOCAL REHEARSAL.
- No synthetic production applications, votes, payments, judges or candidates were created. No database migration, payment switch, assigned-account configuration or commercial term was changed.

## Local reproduction

Run `npm run build`, then the standard development server. `/__preview/journey?scenario=applicant-retry` simulates one ambiguous response followed by an identical retry; `applicant-closed` exercises unavailable intake. `organizer`, `organizer-denied` and `organizer-expired` exercise the corresponding workspace states. The mode is carried by a localhost session cookie and never applies to production. `/__preview/responsive?width=390&page=/organizer/` frames the selected rehearsal at mobile width. These fixture responses verify front-end behavior; the separate database/Worker suites verify storage and role enforcement.

A real organizer OAuth sign-in and an isolated real-upload rehearsal remain distinct acceptance checks; simulated browser responses must never be described as production authentication or storage evidence.
