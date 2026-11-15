# Queen of Quiapo production release — 16 November 2026

The public hosted website is deployed at https://queen-of-quiapo.fbautisat23.chatgpt.site/ . Sites version 14, source commit `4c4326d411e8b8e3ec06b2e5cb53dd6d69e263d5`, deployment `appgdep_6afa3ebce0448191a9452910b4c559ce` succeeded. Audience was changed to public on the organizer's explicit instruction to make it live.

Dedicated Supabase project `wzrjhtanzdtyrhwstkxx` (Queen of Quiapo 2027, withlovefmb organization, Singapore) has all six application migrations applied. The qoq-media Edge Function is active and independently authenticates server requests. Its bootstrap returned HTTP 200. The qoq-private-media bucket is non-public and limited to 5 MiB images. Server credentials are stored only in hosted secrets.

Existing D1 applications were checked before the backend switch: zero records. D1 and R2 bindings remain for rollback and throttling. No fake production applicants, candidates, orders, votes or ballots were created. Database operational counts confirmed zero applications, candidates and orders; phase setup; voting not_configured; payments_enabled false.

Public browser verification confirmed the voting catalog displays six proposals at the fixed rate of PHP100 for 1,000 points, and Payment coming soon. Signed-out organizer and judge pages return HTTP401. The prior isolated suite passed 43 tests; the deployment-specific access and edition tests were rerun and passed. Live testing found Cloudflare Workers rejects redirect:error; database and media fetches now use redirect:manual and reject non-success responses, without forwarding credentials to redirect destinations.

Remaining conditions: GoDaddy requires phone verification to commit the prepared additive DNS import. Custom domains must be revalidated after it succeeds. Official candidates, judges, criteria, deadlines, commercial policies and final package approval remain organizer configuration. Authenticated organizer/judge production workflows and real application uploads remain UNVERIFIED; isolated tests are not represented as production submissions. Multi-role organizer privileges are not implemented. Payments remain disabled and no provider is integrated.

This document supersedes the earlier report's statement that nothing was deployed. The source of truth for the deployed Worker is the Sites source repository; GitHub PR1 contains the reviewed feature branch and requires synchronization of the production redirect compatibility change before merge.
