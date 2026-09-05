# Diagnose the failed stage only

First read `npm run status` once if deployed. Preserve the error stage and HTTP/code, redact credentials. Do not dump `.private`, raw request bodies, headers or full logs. For missing local config, return to UI rather than querying the cloud. If unchanged failure repeats after a targeted correction, stop blind retries and request the missing permission/evidence.

| Evidence | Next action |
|---|---|
| Account ID invalid | 32 hexadecimal characters, not token, whole URL or Zone ID. |
| Cloudflare 403 / 10000 `/workers/scripts` | Workers Scripts Edit, correct account scope/token; not Workers Agents configuration. |
| 403 `/workers/subdomain` | Same Scripts permission and scope first. 403 does not prove the subdomain is absent. |
| R2 route error | Distinguish activation, account scope and R2 Edit; ask user to complete any subscription consent. |
| Deploy saved but readiness failed | Check status after a short wait; do not recreate config/resources. |
| Existing resource but missing state | Confirm ownership and restore authorized local state; no deleting resources or choosing another customer's binding. |
| `paired: false` / LINE_NOT_PAIRED | Start pairing only after deployment works; correct channel, Channel secret, `/line`, Verify + Use webhook, bot friend, private message exact unexpired code. |
| Pair wait interrupted/expired | Status first. Interrupted waiting is not failed pairing. If still unpaired and expired, generate a new code when user is ready. |
| Test send timeout / delivery unknown | Phone confirmation and status before retry; status may not record `/test`. No automatic resend or success claim. |
| LINE accepted but image check failed | User may already have message; check phone first. Diagnose image fetch, not pairing. |
| Repeated Test Alarm suppressed | UniFi uses fixed `testEventId`; wait at least 60 seconds before one authorized repeat. Real event-ID dedupe is 600 seconds, not a universal ten-minute notification interval. |
| API test works but physical event absent | Reopen saved Alarm: enabled, selected source, schedule, actual trigger, POST, exact authenticated URL. No unintended Person AND requirement. |
| One camera fails | doctor verifies each selected camera; any required failed capture prevents the whole image notification. Check access/ID/online status; do not silently remove a camera. |
| Older images stop loading | Current expiry is about 24 hours. For fresh failures inspect R2 binding and image route before changing retention; do not make bucket public as a workaround. |

`npm run webhook -- unifi` prints an authenticated URL; `npm run webhook -- line` can print a pairing code. These are user-local display commands, not safe agent transcript diagnostics. Use local UI for copying instead.

For deeper bugs inspect the relevant function in `scripts/operations.mjs`, `scripts/guidance.mjs` or `src/worker.mjs` only after these checks. A diagnosis request does not authorize a patch/deploy. Never claim all services work merely because doctor passes.
