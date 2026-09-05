---
name: unifi-line-kit-assistant
description: Use when a user has unifi-line-kit and needs help deploying, pairing, verifying, or troubleshooting UniFi Protect camera notifications to LINE through Cloudflare Workers and R2.
---

# UniFi LINE Kit Assistant

Use the existing kit, not a newly generated Worker. Applies to kit 1.2.x. Instructions are runtime-neutral: use the agent's available filesystem, terminal and browser tools. No other skill/plugin is required.

## Start cheaply

1. Locate the user's kit folder (contains `package.json` named `unifi-line-kit` and `scripts/cli.mjs`). In the distributed kit it is two directories above this skill. If the skill was installed elsewhere, ask for the kit path; do not scan the whole disk.
2. Check `package.json` and whether `.private/customer.json` and `.private/secrets.json` exist, without printing their contents. Node must be 22+. Run `npm ci` only when dependencies are absent or changed.
3. New install: open `npm run ui` and let the user enter secrets locally. Existing install: run `npm run status` once; if local config is incomplete, resume the UI instead of recreating resources. A missing origin means deployment is not yet complete.
4. Read [workflow.md](workflow.md) only for installation/pairing; read [troubleshooting.md](troubleshooting.md) only for a relevant failure. Read a matching section of the kit's `操作指南.md` for account-screen guidance. Do not load source, the whole manual or historical chats on the normal path. If implementation inspection is needed, inspect the named command only.

## Command contract

Run from the kit root. All commands below are `npm run NAME`.

| NAME | Effect / when |
|---|---|
| ui | Local setup page; URL contains a session credential. Keep terminal running. |
| setup | Local configuration, interactive TTY required; UI is simpler for secrets. |
| discover | Read camera list; usable before cameras are configured. |
| doctor | Read live snapshots and LINE bot identity; no LINE push. Not proof of Cloudflare deployment permissions. |
| deploy | Creates/updates cloud resources and secrets; runs doctor internally. |
| pair | Updates pairing secrets, code valid 15 minutes, then polls every 10 seconds. |
| status | Read Worker connectivity, pairing and latest Alarm result. |
| test:live | Sends a real LINE message with camera images. |
| checklist | Read evidence; requires configured, reachable deployment. Not an installation step. |
| share | Builds sanitized `dist/unifi-line-kit.zip`. |

## Boundaries and completion

- Confirm target customer and requested changes before cloud writes, pairing, Alarm edits or real sends; existing explicit authorization for that action is sufficient. Status/diagnosis alone does not authorize repair. Registration, login, 2FA, billing consent and provider ownership choices belong to the user.
- Never print secrets, `.private` contents, signed image URLs, full authenticated Webhooks or local session URLs into chat/logs. Let the user copy via the local UI. Share only the generated ZIP. A second customer starts from a fresh ZIP, not an existing configured folder.
- A send timeout means delivery unknown; a post-send image check failure may mean LINE already accepted it. Check the phone and `status` before proposing another send; ask before a retry that could duplicate a message.
- Complete only after deployment is reachable, LINE is paired, the user confirms every test image, the saved UniFi Alarm is reopened and checked, and a real event produces the expected images. Until then report the precise pending step. `test:live` does not establish a real Alarm result.
- Keep replies to: **已確認 / 下一步 / 需要你做**. Preserve a short non-secret progress note when pausing. Execute scripts for mechanics; do not repeatedly poll via the model, regenerate working code or promise a measured token saving.
