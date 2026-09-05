# UniFi → LINE 可分享部署工具

第一次使用請先閱讀 [完整操作指南](操作指南.md)：從帳號申請、取得 API 金鑰，到網頁設定、LINE 配對及實際驗收。

想讓 Codex、Claude 或 Hermes 協助？請看 [給 Agent 的使用說明](給Agent的使用說明.md)，內附低上下文用量的操作技能與可直接複製的指示。

不需要 AI。使用者準備自己的帳號與金鑰，在電腦執行腳本完成安裝；
日後事件通知在客戶自己的 Cloudflare 執行，安裝電腦可關機。

流程：UniFi Protect Alarm → Worker → 延遲截圖 → R2 → LINE Messaging API。

## 最簡單的用法：開啟網頁精靈（1.2 版）

1. 先安裝 Node.js 22 或更新版本。
2. 解壓縮分享包。Mac 雙擊 **Start.command**；Windows 雙擊 **Start.cmd**。
3. 第一次啟動會安裝必要套件，再自動打開瀏覽器。保持該終端開啟。
4. 依畫面完成「準備帳號 → 連接服務 → 選擇相機 → 檢查與部署 → 連接 LINE → 測試與啟用」。

已設定的客戶直接啟動即可，不要重新申請所有金鑰。既有金鑰顯示「已設定」，欄位留空保留。
不同客戶請使用新的解壓資料夾。套件不提供多客戶共用管理頁。

若捷徑無法開啟，也可在套件資料夾執行：

```sh
npm ci
npm run ui
```

Linux 使用以上指令。Mac 若 ZIP 解壓工具未保留執行權限，可先執行 `chmod +x Start.command`；不要為此停用系統安全保護。Windows 捷徑尚未經 Windows 實機驗證。

網頁只在這台電腦的 127.0.0.1 運作。初次開啟須使用啟動器提供的完整網址；網址含本機會話憑證，勿分享。重新整理能接回本次服務狀態；服務重新啟動後，需使用新網址。
金鑰存在 .private，不放進瀏覽器 localStorage；瀏覽器僅使用 HttpOnly／SameSite 的暫時會話 cookie。介面不自動部署、購買服務或發送 LINE，必須按對應按鈕。

關閉本機工具不影響已部署的雲端通知。若部署進行中，不要關閉終端；意外中斷後先檢查狀態，勿直接重複建立新客戶設定。

相機清單讀取失敗時可手動輸入 ID；實際支援的相機清單 API 取決於 Protect 版本及權限。LINE 與 UniFi Webhook 需照頁面指示手動貼至各自管理頁。
本版測試涵蓋本機 API 安全、設定保存、共用操作層、瀏覽器表單與模擬流程；不因本機測試通過就宣稱真實 LINE 已收到。

## 適用範圍

- Windows、macOS、Linux；先安裝 Node.js 22 或更新版（含 npm）。
- 一份解壓資料夾對應一位客戶／一個部署。
- 每次通知 1–4 台相機，圖片順序由設定決定。
- LINE 私人帳號可透過配對取得收件人 ID；群組需手動提供 groupId 並邀請機器人加入。
- 提供本機網頁設定精靈，也保留原本命令列指令。
- 帳號註冊、R2 訂閱授權、取得金鑰、LINE webhook 和 UniFi Alarm 設定需人工操作。
- 程式採 MIT 授權，可以分享、修改與商業使用。本工具不是 UniFi／LINE／Cloudflare 官方產品。

## 1. 先準備帳號

Cloudflare：
1. 在 https://dash.cloudflare.com/ 登入客戶帳號。
2. 開通 R2，閱讀按量計費與免費額度條款。超額可能收費；本工具不承諾永久零成本。
3. 到 Workers 頁面啟用自己的 workers.dev 子網域。
4. 記下 Account ID（不是 Zone ID）。
5. 建立只涵蓋此客戶帳戶的 API token，包含：
   - Account / Workers Scripts / Edit
   - Account / Workers KV Storage / Edit
   - Account / Workers R2 Storage / Edit
   若權限名稱隨平台改版變動，以 Cloudflare 現行 token 權限選單為準。
   不需要 Global API key、不需要其他客戶的帳戶權限。
6. 此 token 只供安裝電腦呼叫 Cloudflare；不會部署到 Worker。
   安裝完成可撤銷；日後更新先重新建立 token 並執行 setup。

UniFi：
1. 登入 https://unifi.ui.com/ ，確認 Remote Management、Protect 相機及門磁正常。
2. 由具有權限的 owner 建立允許存取指定主機／Protect 的 API key。
3. Console ID 可從 Site Manager 主機網址的 /consoles/ 後取得完整那一段；
   不要把內網 IP、序號或相機 ID 當作 Console ID。
4. 相機 ID 可用本工具 discover 列出。若版本／權限不支援，從 Protect Devices
   的裝置網址或裝置表列識別資訊取得。setup 允許暫時留空，查到後再執行 setup。

LINE：
1. 建立 LINE Official Account，於 Official Account Manager 啟用 Messaging API。
2. 到 https://developers.line.biz/console/ 取得 Channel access token 和 Channel secret。
3. 收件人需加此機器人好友。不要使用已停止服務的 LINE Notify token。
4. 若是已有其他用途的 LINE channel，請先評估 webhook 影響；建議專用 channel。
   一個 channel 的 webhook URL 只有一個，貼上新 URL 會取代原本接收位置。

## 2. 安裝並填入資料

解壓分享 ZIP。在解壓後的 unifi-line-kit 資料夾開啟終端：

```sh
npm ci
npm run setup
```

setup 會逐項詢問帳戶、主機、相機、通知文字與金鑰。金鑰輸入不顯示字元。
已填值按 Enter 保留；若要清空已儲存的 LINE_TO，直接編輯本機 secrets.json。

所有客戶資料存於 .private/：
- customer.json：帳戶、相機、延遲等設定。
- secrets.json：**明文機密**，請只存於可信任的安裝電腦。
- state.json：已建立的資源，用來安全重新執行部署。
- wrangler.json：此客戶專用部署設定。
- line-pairing.json：短期 LINE 配對資料。
- unifi-webhook.txt.json：含驗證 token 的 UniFi webhook URL。

Unix 系統使用目錄 0700／檔案 0600；Windows 仍需使用者自行保護資料夾 ACL。
不要同步 .private 到公用雲碟，不要傳送整個安裝資料夾給另一位客戶。

不知道相機 ID 時：

```sh
npm run discover
npm run setup
```

discover 只列出目前設定 Console 的相機名稱與 ID。若存取失敗，確認 Console ID、
Protect 版本及權限，並使用上述手動取得方式。之後依序輸入 1–4 個 ID。

## 3. 檢查與部署

```sh
npm run doctor
npm run deploy
```

doctor 檢查 Cloudflare R2、LINE bot 身分與每台相機圖片（不發送 LINE）。
它檢查讀取能力；部署所需寫入權限仍以部署 API 的結果為準。

deploy 自動：
1. 再次檢查連線與圖片格式。
2. 建立此部署專用 KV 和 R2 bucket。
3. 設定 R2 一天後到期的 lifecycle。
4. 產生 Worker 設定、部署程式、透過 stdin 寫入 Worker secrets。
5. 檢查 /health，產生 UniFi webhook 設定檔。

預設 Worker 名稱含隨機尾碼。同一資料夾重新執行會沿用已記錄資源；
不同客戶務必使用新的分享 ZIP 解壓，不要複製舊客戶的 .private/。
如果發現同名既有資源卻沒有本機所有權記錄，腳本會停止，避免覆蓋。
網路中斷可能發生「雲端建立成功、本機尚未記錄」，此時請核對 Dashboard 資源，
復原 state.json 或聯絡安裝人員；不要隨意刪除其他資源。

若部署已存在，deploy 會更新該 Worker 程式及套件管理的 secrets。
首次程式部署與 secrets 更新是兩個操作；若第二步失敗，通知不會可用，
修正權限後重跑 deploy。不會自動回滾或刪除資源。

## 4. LINE 配對

如果已填 LINE_TO，跳到下一節。若是一般個人收件人：

```sh
npm run pair
```

開啟 .private/line-pairing.json：
1. 將 webhook 貼入 LINE Developers → Messaging API → Webhook URL。
2. 啟用 Use webhook，按 Verify。
3. 加機器人好友，**用私人對話**傳送檔案中的 code（含 PAIR- 前綴）。
4. 配對碼 15 分鐘有效，已綁定後不接受再次配對。
5. `pair` 會每 10 秒檢查一次，成功時顯示「配對成功」。Ctrl+C 只停止等待；配對碼仍在原期限內有效。可另開終端執行以下指令，確認已綁定：

```sh
npm run status
npm run test:live
```

LINE webhook 使用 Channel secret 驗證簽章。測試通知是一則文字加所有相機圖片，
會使用 LINE 訊息額度。API 成功只代表接受請求，仍需使用者確認圖片實際顯示。
KV 配對狀態在不同節點短暫同步延遲時，稍後再查 status。

第一版不提供換綁精靈。要換收件人可填入新的 LINE_TO 後 deploy；
此設定優先於先前配對結果。

## 5. 設定 UniFi Alarm

開啟 .private/unifi-webhook.txt.json，複製 url（它包含密鑰，勿貼到公開文件）。

在 UniFi Protect → Alarm Manager：
1. 新增規則，或在既有門磁規則新增 Webhook action。
2. 選 Sensors → Open Status Changed，指定實際的門磁感測器。
3. 設定 Webhook 為 POST，貼上完整 URL。
4. 儲存，再重新打開，核對來源、事件、POST 和 URL 都有保留。
5. 確認規則啟用；實際開門，確認每張圖片和通知時間。

門磁事件本身可以觸發抓圖，不需要再加 Person AND 條件。
若需要關門通知，另外建立 Close Status Changed 規則；此版本共用通知文字。
UniFi 的測試事件不代表真實開門驗收完成。沒有門磁也可選相機支援的 Person、Motion 或越線事件；觸發來源和要截圖的相機可分別設定。

## 1.1 版操作捷徑與驗收

所有指令都在這個套件資料夾執行：

```sh
npm run folder
npm run webhook -- unifi
npm run webhook -- line
npm run checklist
```

- `folder`：直接開啟本套件的 `.private`，不用尋找隱藏資料夾。
- `webhook -- unifi`：顯示要貼入 UniFi Alarm 的 POST URL。
- `webhook -- line`：顯示 LINE Developers 的 Webhook URL 與尚有效的配對碼。配對等待期間，可在第二個終端執行。
- 上述 URL／配對碼可能含憑證，勿公開終端截圖。
- `checklist`：分別列出服務連線、配對、歷史圖片讀取測試、一般事件結果，以及仍需人工確認的手機收圖。
- `test:live`：先確認已配對，未配對不發送；API 接受不等於手機收到。
- `doctor`：部署前檢查 API 讀取權限；寫入權限仍需部署時確認。Workers 權限要選「Workers 指令碼（Workers Scripts）／編輯」，不是「Workers 代理程式設定」。另需 KV、R2 編輯權限及正確帳戶範圍。
- 部署後健康檢查最多嘗試 6 次。若仍未就緒，先查 `status`，不要重新 `setup`。
- UniFi 固定 `testEventId` 使用獨立 60 秒防連點；請隔至少 60 秒再按 Test Alarm。一般事件仍以事件 ID 防重複 600 秒；無事件 ID 時按規則防連點 60 秒。KV 同步有延遲，這不是精確限流保證。

既有安裝更新程式後執行 `npm ci`、`npm run deploy`，才會將新版事件處理部署至雲端；保留自己的 `.private`，不用重做 setup。不要以其他客戶的 `.private` 覆蓋。

## 6. 延遲、狀態與故障排查

setup 的 delaySeconds 預設 5，可設定 0–10。再執行 deploy 生效。
延遲從 Worker 處理事件開始計算，網路與相機抓圖時間會再增加延遲。

本版使用 Worker waitUntil，先回覆 202，再在背景執行；**不是持久化工作佇列**。
執行上限或平台中斷可能導致漏通知，沒有跨程序自動重試。
若需要嚴格可靠投遞，下一版應改用持久化工作排程。

```sh
npm run status
```

status 顯示 LINE 是否綁定及最近一次背景工作結果，沒有影像或金鑰內容。
KV 防重複是盡力而為：跨節點一致性和同時到達可能造成重複，不能當成原子鎖。
實際 eventId 用於去重；缺少 eventId 時對同一規則抑制 60 秒內的重複通知。

| 現象 | 檢查 |
|---|---|
| Cloudflare 10042 | 客戶尚未開通 R2 |
| Cloudflare 401／403 | token 權限、Account ID、token 到期 |
| 相機 401／403／404 | API key 權限、完整 Console ID、相機 ID、Protect 版本 |
| SNAPSHOT_SIZE | 圖片須 1KB–1MB，使用原圖作 LINE 預覽；此版不自動縮圖 |
| LINE_NOT_PAIRED | 配對尚未完成或未填 LINE_TO |
| LINE_HTTP_401 | LINE access token 無效 |
| LINE_HTTP_429 | LINE 頻率限制或訊息額度；到官方後台核對 |
| 測試成功但門磁沒通知 | 檢查 Alarm 啟用、來源、POST 與 URL，重新打開已存設定 |
| 文字到但圖失敗 | test:live 會檢查 R2 公開圖片網址；並在手機確認 |
| API 回覆 202 | 只代表背景工作已受理；用 status 查看結果 |

每張圖片使用隨機網址，網址持有者在有效期內可以讀取，勿公開分享。
Worker 在圖片滿 24 小時後拒絕存取；R2 lifecycle 清理是非同步，
不能保證恰好第 24 小時刪除。LINE 已下載的圖片不會因此從聊天中刪除。
LINE 發送失敗或結果不明時，本版不自動重送，以避免重複推送。
任一必要相機抓圖失敗，本次整組通知不發送，可從 status 查看失敗。

## 7. 分享、更新與移除

```sh
npm test
npm run share
```

**只分享 dist/unifi-line-kit.zip。** share 以明確白名單打包程式、文件、測試與依賴鎖檔，
即使本機已 setup，也不會打包 .private/、node_modules/、截圖、.env 或部署日誌。
不要用 Finder／檔案總管把整個工作資料夾壓縮分享。

更新時備份客戶自己的 .private/ 到安全位置，更新套件中的程式與鎖檔，
執行 npm ci、npm test、npm run doctor、npm run deploy，再實際驗收。
保存舊版分享 ZIP 可供回復程式；本版未提供自動回滾指令。

移除需在 Cloudflare Dashboard 核對此客戶的 Worker 名稱、專用 R2 與 KV，
停用對應 UniFi Alarm webhook 後再刪除。腳本不提供一鍵刪除，避免誤刪資料。
刪除 bucket 不等於取消帳戶 R2 訂閱；若不再使用，另至帳單管理處理。

## 官方文件與驗證範圍

- UniFi Protect API：https://developer.ui.com/protect
- LINE Messaging API：https://developers.line.biz/en/docs/messaging-api/
- Cloudflare Wrangler：https://developers.cloudflare.com/workers/wrangler/
- R2 計費：https://developers.cloudflare.com/r2/pricing/
- R2 生命週期：https://developers.cloudflare.com/r2/buckets/object-lifecycles/

核心 R2 → LINE 路徑曾在實際場域驗證；這份通用安裝套件新增的 CLI、
LINE 配對與參數化流程，以離線測試及 Wrangler dry-run 驗證，
尚需在一個全新客戶帳戶完成首次端到端驗收。不要把既有現場的成功當成
所有新客戶環境都已驗證。
