# Event operations guide — Queen of Quiapo 2027

For the organizer and tabulation staff. Everything happens in the organizer desk at `org.queenofquiapo.com`.

## Before Screening Day (January 4, 3:00–9:00 PM)

1. **Applications tab.** Open each application, check both photographs, and mark it *Under review* → *Qualified for screening* (or *Correction requested* / *Not selected*). Add a note for anything the screening panel should know.
2. A yellow **Possible duplicate** tag means the same email or mobile number applied twice. Open both before deciding.
3. Use **Export CSV** for the registration desk list. The export is recorded in the audit log. Treat the file as confidential and delete it after the event.
4. Applicants are told on their receipt to come 3:00–4:00 PM for registration. The venue still says "to be announced" on the website — publish it as an Announcement once confirmed.
5. Confirmation emails are **not** sent by this system. Applicants keep their on-screen receipt.

## On Screening Day

1. As each applicant is screened, mark her *Screening completed*, then *Approved* or *Not selected*. Nothing here is shown publicly.
2. For each approved applicant press **Add to official roster**. Only her pageant name is copied.
3. **Candidates tab.** For each candidate: assign her number, upload the official portrait (not the screening photo), type the publicity clearance reference (for example "Signed release, 4 Jan"), and tick *Published* only when the signed release is in your hands.
4. When the roster is final, press **Lock roster**.

## Before Coronation Night (January 6)

1. **Judging tab.** Add each judge with the exact email they will sign in with. Add the criteria; weights must total 100%.
2. **Rehearse.** Ask every judge to open `judge.queenofquiapo.com` on the device they will use and sign in. Their row should change to "Signed in" after judging opens. Do this on the venue's internet.
3. Check **Overview → Event readiness**. Every line is read from live records.
4. Print the paper ballots below as a fallback.

## During judging

1. Press **Open judging**. This freezes the roster, judges and criteria.
2. Judges enter scores (0–100, up to two decimals), press **Save draft** as they go, and **Lock my ballot** when complete. A locked ballot cannot be changed by anyone, including you.
3. Watch **Ballot progress**: scores entered, last active, locked time. The desk refreshes when you switch tabs or return to the window.
4. **Results tab** shows *PROVISIONAL* figures while ballots are outstanding. Do not announce from a provisional screen.
5. When all ballots are locked: **Lock final tabulation**. The system stores the full record with a report ID and re-verifies it against the ballots every time the page loads.
6. **Print result sheet** and **Print judge audit.** Have a second person recompute at least the top three by hand from the judge audit: for each judge, multiply each score by its weight, add, then average across judges.
7. **Certify results.** If there is a tie, the system will not break it. Apply the official tie rule, or certify the shared placement.
8. Announce on stage from the certified sheet. Afterwards choose what the public sees and press **Publish results**.

## Voting points

Payment is not active. Until it is: the voting page shows candidates and packages with "Payment coming soon"; nothing needs daily attention. When it is activated, follow `docs/PAYMENTS.md`, and each day check **Voting & revenue → Reconciliation** shows "Reconciled".

## If something goes wrong

| Problem | What to do |
| --- | --- |
| A judge's device dies or logs out | Sign in on any other device with the same account. Saved drafts are on the server. Unsaved typing on the dead device is lost — judges should save after each candidate. |
| A judge entered a wrong score **before locking** | The judge corrects it and saves. |
| A judge entered a wrong score **after locking** | It cannot be changed in the system. Record the correction on paper, signed by the judge and the chair, tabulate that placement by hand, and note it on the result sheet. Do not certify online results that you know are wrong. |
| A judge cannot attend after judging has opened | The system requires every assigned ballot. Switch to paper for the whole panel, or have the judge score remotely. |
| Venue internet fails | Use mobile data hotspots. If nothing connects, switch the **whole panel** to paper ballots. Never mix: one segment is either all online or all paper. |
| "Temporarily unavailable" messages | Nothing was changed. Wait a minute and retry. If it persists, go to paper. |
| Results screen says the stored result **no longer matches** | Stop. Do not announce or certify. Use the printed judge audit and hand tabulation; report to technical support. |
| Disputed result | The judge audit sheet and the audit log are the record. Results already certified are never edited; a correction is a new, signed document. |
| Website down during the show | The show does not depend on it. Applications, results and voting information resume when it returns. |

There is no "import paper scores" button, on purpose: scores entered by anyone other than the judge would bypass the lock and the audit trail. A paper result is announced as a paper result.

## Paper ballot (print one per judge)

```
QUEEN OF QUIAPO 2027 — JUDGE'S BALLOT            Judge: ______________________

No. | Candidate            | Criterion 1 (__%) | Criterion 2 (__%) | Criterion 3 (__%) | Criterion 4 (__%)
----|----------------------|-------------------|-------------------|-------------------|------------------
 1  |                      |                   |                   |                   |
 2  |                      |                   |                   |                   |
 3  |                      |                   |                   |                   |

Scores 0–100. Corrections must be initialled.          Signature: ____________  Time: ______
```

Hand tabulation: weighted total per judge = Σ (score × weight ÷ 100). Candidate score = average of the judges' weighted totals. Rank highest first. Equal scores are a tie.

## After the event

- Publish the certified results and an announcement.
- Keep the printed, signed result sheet and judge audit.
- Remove applications that did not proceed (Applications → open → Remove this application) once the retention period you promised has passed.
- Remove judges' access by archiving the edition; review who still has the organizer account password.
