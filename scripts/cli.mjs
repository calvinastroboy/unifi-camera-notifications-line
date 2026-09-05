import {createOperations} from './operations.mjs';
import {createStore,exists,read} from './store.mjs';
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {randomBytes} from "node:crypto";
import {createInterface} from "node:readline/promises";
import {Writable} from "node:stream";
import {validate} from "./config.mjs";
import {statusText} from "./guidance.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)),"..");
const {doctor,deploy,pair,liveTest,authenticated,discover,folder,webhook,checklist}=createOperations(root);
const {privateDir,save}=createStore(root);
const configFile = resolve(privateDir,"customer.json");
const secretFile = resolve(privateDir,"secrets.json");
async function ask(label, fallback = "", secret = false) {
  if (!process.stdin.isTTY) throw new Error("setup 需要互動終端；可按 README 建立設定檔");
  let muted = false;
  const output = new Writable({write(chunk,encoding,callback) {
    if (!muted) process.stdout.write(chunk,encoding); callback();
  }});
  const rl = createInterface({input:process.stdin,output,terminal:true});
  // Give readline the actual prompt so its terminal redraw preserves the label.
  const answer = rl.question(label + (fallback && !secret ? " ["+fallback+"]" : "") + ": ");
  muted = secret;
  try { return (await answer).trim() || fallback; }
  finally { rl.close(); if (secret) process.stdout.write("\n"); }
}
async function field(step,title,help,fallback,check,secret=false) {
  console.log("\n────────────────────────────────────────\n["+step+"/10] "+title+"\n"+help);
  if(secret) console.log("輸入不會顯示字元，這是正常的。貼上後按 Enter。"+
    (fallback ? " 直接 Enter 保留已存值。" : ""));
  for (;;) {
    const value=await ask("請輸入"+(secret ? "（隱藏）" : ""),fallback,secret);
    const error=check(value);
    if(!error) { console.log(value ? "✓ 已接受" : "✓ 已略過"); return value; }
    console.log("\n⚠ "+error+"\n請重新輸入這一項；其他資料不受影響。");
  }
}
async function setup() {
  console.log("\nUniFi → LINE 設定精靈\n共 10 步，只會儲存本機設定；完成後才執行部署。\n每項下方都有取得方式。填錯會在原步驟重填。\n有 [預設值] 可按 Enter 保留。Ctrl+C 取消（本次未完成輸入不儲存）。\n準備：Cloudflare、UniFi、LINE 的管理頁面。\n詳細說明：本資料夾 README.md");
  const prior = await exists(configFile) ? await read(configFile) : {};
  const secrets = await exists(secretFile) ? await read(secretFile) : {};
  const config = {
    accountId:await field(1,"Cloudflare 帳戶 ID（不是 API token）",
      "開啟 https://dash.cloudflare.com/ 並選擇客戶帳戶。\n帳戶網址形如 https://dash.cloudflare.com/【這一段就是帳戶 ID】/home\n只複製中間 32 位英數字，不要貼整個網址，也不是網域的 Zone ID。",
      prior.accountId,v=>/^[a-fA-F0-9]{32}$/.test(v) ? "" : "帳戶 ID 必須是 32 位 0–9、a–f 字元，請從 Cloudflare 帳戶網址複製。").then(v=>v.toLowerCase()),
    name:prior.name || "door-alert-"+randomBytes(4).toString("hex"),
    consoleId:await field(2,"UniFi 主機 ID",
      "開啟 https://unifi.ui.com/ → 選擇主機 → Protect。\n從網址 /consoles/ 後複製到下一個 / 之前的整段 ID，包含冒號及後面的數字。\n這不是內網 IP，也不是攝影機 ID。",
      prior.consoleId,v=>/^[a-zA-Z0-9:_-]+$/.test(v) ? "" : "請貼上主機的完整 ID，不含網址及斜線。"),
    cameraIds:(await field(3,"要截圖的攝影機",
      "貼上 1–4 個攝影機 ID，用英文逗號分隔；順序就是 LINE 圖片順序。\n還不知道 ID？直接 Enter 略過。儲存後執行 npm run discover 取得清單，再重跑 setup。",
      prior.cameraIds?.join(","),v=>!v || (v.split(",").length<=4 && v.split(",").every(x=>/^[a-zA-Z0-9_-]+$/.test(x.trim()))) ? "" : "最多 4 個 ID，用英文逗號分隔，每個 ID 不可空白。"))
      .split(",").map(x=>x.trim()).filter(Boolean),
    delaySeconds:Number(await field(4,"開門後等待多久截圖",
      "單位：秒。建議 5 秒，讓進出的人走入畫面。可填 0–10；0 表示立即抓圖。",
      String(prior.delaySeconds ?? 5),v=>/^\d+$/.test(v) && Number(v)<=10 ? "" : "請輸入 0 到 10 的整數，例如 5。")),
    label:await field(5,"LINE 通知文字",
      "這段文字會與相機截圖一起發送。例如：🚪 展廳門已打開",
      prior.label || "🚪 門已打開",v=>v.length>0 && v.length<=1000 ? "" : "請輸入 1–1000 字的通知文字。"),
    origin:prior.origin,
  };
  validate(config,{allowEmptyCameras:true});
  const secretFields=[
    ["CLOUDFLARE_API_TOKEN","Cloudflare 部署權杖",
      "Cloudflare → 個人資料 → API Tokens → Create Token。\n指定此客戶帳戶，授予 Workers Scripts / Edit、Workers KV Storage / Edit、Workers R2 Storage / Edit。\n建立後複製 token；不要填 Account ID 或 Global API Key。",true],
    ["UNIFI_API_KEY","UniFi API key",
      "登入 UniFi Site Manager，由有權限的 owner 在 API／Integrations 管理頁建立金鑰。\n金鑰需可存取此主機的 Protect；建立後複製完整 key。",true],
    ["LINE_CHANNEL_ACCESS_TOKEN","LINE Channel access token",
      "開啟 https://developers.line.biz/console/ → 選 Provider → Messaging API channel。\nMessaging API 分頁 → Channel access token → Issue，複製完整 token。\n尚無 channel：先到 LINE Official Account Manager 啟用 Messaging API。",true],
    ["LINE_CHANNEL_SECRET","LINE Channel secret",
      "同一個 LINE channel → Basic settings → Channel secret。\n這和上一項 access token 不同，用來驗證 LINE 配對訊息。\n建議填入；若直接使用已知收件人 ID，可 Enter 略過。",false],
    ["LINE_TO","LINE 收件人 ID（可略過）",
      "一般使用者直接 Enter 略過，部署後用 npm run pair 綁定。\n若已知 userId／groupId 可貼上；不是 LINE 暱稱、電話號碼或 @機器人名稱。",false],
  ];
  for (let i=0;i<secretFields.length;i++) {
    const [key,title,help,required]=secretFields[i];
    secrets[key]=await field(i+6,title,help,secrets[key] || "",
      v=>required && !v ? "這一項必填，請先到上述頁面取得。" : /\s/.test(v) ? "內容含空白或換行，請重新複製完整金鑰。" : "",true);
  }
  secrets.WEBHOOK_TOKEN ||= randomBytes(32).toString("hex");
  for (const k of ["CLOUDFLARE_API_TOKEN","UNIFI_API_KEY","LINE_CHANNEL_ACCESS_TOKEN"])
    if (!secrets[k]) throw new Error("缺少 "+k);
  await save(configFile,config); await save(secretFile,secrets);
  console.log("\n✓ 10 步設定已儲存。尚未部署，也尚未發送通知。\n攝影機："+config.cameraIds.length+" 台；截圖延遲："+config.delaySeconds+" 秒。\n資料在 .private/，包含明文金鑰，請勿分享。");
  if(!secrets.LINE_TO && !secrets.LINE_CHANNEL_SECRET)
    console.log("\n注意：LINE 收件人 ID 和 Channel secret 都未填；請再執行 setup 補上其中一項，才能發送通知。");
  console.log(config.cameraIds.length ? "\n下一步先檢查連線：\n  npm run doctor\n通過後部署：\n  npm run deploy" :
    "\n你略過了攝影機 ID。下一步：\n  npm run discover\n查到 ID 後：\n  npm run setup\n其餘已填資料按 Enter 保留，再填第 3 步。");
}
async function main() {
  const command=process.argv[2];
  if(command==="setup") return setup();
  if(command==='folder') return folder();
  if(!["doctor","discover","deploy","pair","status","test","webhook","checklist"].includes(command)) {
    console.log("用法：node scripts/cli.mjs setup|doctor|discover|deploy|pair|status|test|folder|webhook|checklist"); return;
  }
  if(!await exists(configFile) || !await exists(secretFile)) throw new Error("請先執行 npm run setup");
  const c=validate(await read(configFile),{allowEmptyCameras:command==="discover"}),s=await read(secretFile);
  if(command==="doctor") return doctor(c,s);
  if(command==="deploy") return deploy(c,s);
  if(command==="pair") return pair(c,s);
  if(command==='webhook') return webhook(c,s);
  if(command==='checklist') return checklist(c,s);
  if(command==="status") { console.log(statusText(await authenticated(c,s,"/status"))); return; }
  if(command==="test") return liveTest(c,s);
  if(command==="discover") {
    console.table(await discover(c,s));
  }
}
main().catch(error=>{console.error("未完成："+error.message);process.exitCode=1;});
