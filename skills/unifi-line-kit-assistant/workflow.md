# Installation and resume

## Preparation

Confirm customer, 1–4 cameras in desired order, notification text, trigger (sensor/person/motion/line crossing as supported), delay 0–10 seconds (default 5). Trigger source and screenshot cameras are independent. Do not assume a door sensor exists.

User supplies through local UI:

- Cloudflare Account ID and scoped user API token: Account → Workers Scripts Edit, Workers KV Storage Edit, Workers R2 Storage Edit; target customer account only. R2 must be activated and workers.dev configured. “Workers 代理程式設定” is not Workers Scripts. S3 access keys and Global API Key are not the deployment token.
- UniFi Console ID and API key with access to that Protect console; remote management available. Console ID is not camera ID or LAN IP.
- LINE Messaging API Channel access token and Channel secret from the same channel. Official Account must first have Messaging API enabled. User chooses the provider and adds bot as friend.

For exact account instructions read only sections 二、三、四 of `操作指南.md` as needed. For changed external screens, verify the relevant official documentation instead of guessing. Do not create accounts, accept subscription terms or choose a different customer's provider to bypass a blocker.

## Preferred: local wizard

`npm run ui` → 準備帳號 → 連接服務 → 選擇攝影機 → 檢查與部署 → 連接 LINE → 測試與啟用.

Use one route (UI or CLI) at a time to avoid concurrent writes. Let the user enter keys locally; blank existing secret fields preserve saved values. Start.command / Start.cmd are customer launchers. Local UI stays bound to 127.0.0.1; never expose it publicly. Remote agent without access to the user's browser: give one step and wait for the user, not an unprotected port-forward.

## CLI alternative

1. `npm run setup` in an interactive terminal. If cameras unknown, leave camera list empty, `npm run discover`, then run setup to choose them. No `--json`, `--yes` or unattended setup flags exist in 1.2.x.
2. `npm run deploy` after scope is authorized; it runs doctor itself. Run `npm run doctor` separately only for a requested preflight/diagnosis. Deployment creates R2 for images and KV for metadata/deduplication. Do not substitute an old KV-image template.
3. `npm run status`. If reachable but not paired, prepare LINE page/user before `npm run pair`. Let the command's polling run in a background terminal; do not repeatedly start pair. Ctrl+C stops waiting, not the already-created pairing code.
4. User copies URL and code through local UI (or locally opens `.private/line-pairing.json`). LINE Developers → same Channel → Messaging API → Webhook URL: `https://WORKER_HOST/line`; Verify and enable Use webhook. User privately messages the bot the exact `PAIR-…` code within 15 minutes. Verify success via status; never read the code into an agent transcript just to instruct the user.
5. One authorized `npm run test:live`; ask user to confirm all images. API acceptance alone is not handset receipt. Avoid redundant test loops.
6. User copies UniFi URL from the UI's 取得 Webhook (or locally from `.private/unifi-webhook.txt.json`): `/unifi-alarm?token=…`. UniFi Protect Alarm → requested trigger/device/schedule → Action Webhook → POST. This is not LINE's `/line` URL. Save and reopen to check persisted settings. Do not replace existing unrelated alarms.
7. Physically trigger once, then `npm run checklist`; confirm phone images are current, intended cameras and order. Do not mark complete while waiting for the physical test.

## Resume / changes

Resume existing customer using existing `.private` and resource IDs. Do not rerun setup/deploy merely because a phone notification is missing. A changed local camera/text/delay/key needs an authorized deployment to reach the Worker. An already-paired deployment does not require a new pair code.

For a second customer, extract clean `dist/unifi-line-kit.zip` into a separate folder and repeat preparation → setup → deploy → pair → test → Alarm → physical test. Never copy `.private`; never run checklist before deploying. Changing customer ownership in an existing deployment is not a shortcut.

R2 images are available for about 24 hours under current kit settings; lifecycle deletion is asynchronous. Captures are live images after the configured delay, not historical event frames. No permanent onsite computer is needed after deployment, but this is supplementary notification, not guaranteed alarm delivery.
