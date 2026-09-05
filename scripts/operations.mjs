import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import {validate,runtimeConfig} from './config.mjs';
import {retryCheck,sleep,permissionHint,statusText} from './guidance.mjs';
import {createStore,exists,read} from './store.mjs';
export function createOperations(root,{log=console.log,fetch=globalThis.fetch,runWrangler}={}) {
const {privateDir,save}=createStore(root);
const configFile=resolve(privateDir,'customer.json'),secretFile=resolve(privateDir,'secrets.json');
const stateFile=resolve(privateDir,'state.json'),wranglerFile=resolve(privateDir,'wrangler.json');
async function cf(c,s,path,method="GET",body) {
  const response = await fetch("https://api.cloudflare.com/client/v4/accounts/"+c.accountId+path,{
    method,headers:{authorization:"Bearer "+s.CLOUDFLARE_API_TOKEN,"content-type":"application/json"},
    body:body === undefined ? undefined : JSON.stringify(body),signal:AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok || data.success === false) {
    const error = new Error("Cloudflare "+method+" "+path+" HTTP "+response.status+"；代碼 "+
      (data.errors || []).map(x=>x.code).join(",")+"。"+permissionHint(path));
    error.status = response.status; throw error;
  }
  return data.result;
}
async function wrangler(args,c,s,input) {
  if(runWrangler)return runWrangler(args,c,s,input);
  const executable = resolve(root,"node_modules/wrangler/bin/wrangler.js");
  await access(executable);
  return await new Promise((resolvePromise,reject) => {
    const child = spawn(process.execPath,[executable,...args,"--config",wranglerFile],{
      cwd:root,shell:false,env:{...process.env,CLOUDFLARE_ACCOUNT_ID:c.accountId,
        CLOUDFLARE_API_TOKEN:s.CLOUDFLARE_API_TOKEN,WRANGLER_SEND_METRICS:"false"},
      stdio:[input ? "pipe" : "ignore","pipe","pipe"],
    });
    for(const stream of [child.stdout,child.stderr]) {
      let pending='';stream.setEncoding('utf8');
      stream.on('data',chunk=>{pending+=chunk;const lines=pending.split(/\r?\n|\r/);pending=lines.pop();for(const line of lines)if(line)log(line);});
      stream.on('end',()=>{if(pending)log(pending);});
    }
    if(child.stdin)child.stdin.on('error',reject);
    child.on("error",reject);
    child.on("exit",code=>code===0 ? resolvePromise() : reject(new Error("Wrangler 執行失敗；已完成的資源保留，可重新執行")));
    if(input) child.stdin.end(input);
  });
}
function connector(c,path) {
  return "https://api.ui.com/v1/connector/consoles/"+encodeURIComponent(c.consoleId)+"/proxy/protect/integration/v1/"+path;
}
async function doctor(c,s) {
  validate(c);
  log('檢查部署讀取權限：Workers 指令碼、KV、R2、workers.dev。寫入權限會在部署時驗證。');
  const failures=[];
  for(const path of ['/workers/scripts','/storage/kv/namespaces?per_page=1','/workers/subdomain']) {
    try { await cf(c,s,path); log('✓ '+path); }
    catch(error) { failures.push(error.message); }
  }
  if(failures.length) throw new Error('\n'+failures.join('\n'));
  await cf(c,s,"/r2/buckets");
  log("✓ Cloudflare 帳戶 / R2 可讀取");
  const bot = await fetch("https://api.line.me/v2/bot/info",{
    headers:{authorization:"Bearer "+s.LINE_CHANNEL_ACCESS_TOKEN},signal:AbortSignal.timeout(15000)});
  if (!bot.ok) throw new Error("LINE token 驗證失敗 HTTP "+bot.status);
  log("✓ LINE bot："+(await bot.json()).displayName);
  for (const id of c.cameraIds) {
    const r = await fetch(connector(c,"cameras/"+encodeURIComponent(id)+"/snapshot"),{
      headers:{"X-API-Key":s.UNIFI_API_KEY},signal:AbortSignal.timeout(15000)});
    const type=(r.headers.get("content-type") || "").split(";")[0];
    if (!r.ok || !["image/jpeg","image/png"].includes(type)) throw new Error("相機抓圖失敗 HTTP "+r.status);
    const bytes = new Uint8Array(await r.arrayBuffer());
    if(bytes.length<1024 || bytes.length>1000000) throw new Error("圖片大小不適合 LINE 預覽（須 1KB–1MB）");
    if(type==="image/jpeg" ? !(bytes[0]===255 && bytes[1]===216 && bytes[2]===255) :
      !(bytes[0]===137 && bytes[1]===80 && bytes[2]===78 && bytes[3]===71)) throw new Error("圖片內容格式錯誤");
    log("✓ 相機 "+(c.cameraIds.indexOf(id)+1)+"："+bytes.length+" bytes");
  }
  log("連線檢查完成，未發送 LINE 通知。");
}
async function deploy(c,s) {
  await doctor(c,s);
  let state = await exists(stateFile) ? await read(stateFile) : {accountId:c.accountId,name:c.name};
  if(state.accountId!==c.accountId || state.name!==c.name) throw new Error("此資料夾已綁定另一個部署。新客戶請解壓新的分享套件");
  // First deployment never overwrites an existing Worker.
  const workers = await cf(c,s,"/workers/scripts");
  if (!state.owned && workers.some(w=>w.id===c.name)) throw new Error("同名 Worker 已存在，拒絕覆蓋。請使用新的名稱");
  const domain = await cf(c,s,"/workers/subdomain");
  if (!domain.subdomain) throw new Error("請先到 Cloudflare Workers 頁面啟用 workers.dev 子網域");
  c.origin = "https://"+c.name+"."+domain.subdomain+".workers.dev";
  await save(configFile,c);
  if(!state.kvId) {
    const matching=[];
    for(let page=1;;page++) {
      const list=await cf(c,s,"/storage/kv/namespaces?per_page=100&page="+page);
      matching.push(...list.filter(n=>n.title===c.name+"-dedupe"));
      if(list.length<100) break;
    }
    if(matching.length) throw new Error("同名 KV 已存在但缺少本機 state；請確認資源歸屬後復原 .private/state.json");
    const kv=await cf(c,s,"/storage/kv/namespaces","POST",{title:c.name+"-dedupe"});
    state.kvId=kv.id; await save(stateFile,state);
  }
  if(!state.bucket) {
    const buckets=await cf(c,s,"/r2/buckets");
    if((buckets.buckets || []).some(b=>b.name===c.name+"-images")) throw new Error("同名 R2 已存在但缺少本機 state；請先確認資源歸屬");
    await cf(c,s,"/r2/buckets","POST",{name:c.name+"-images"});
    state.bucket=true; await save(stateFile,state);
  }
  await save(wranglerFile,runtimeConfig(c,state));
  if(!state.lifecycle) {
    await wrangler(["r2","bucket","lifecycle","add",c.name+"-images","expire-snapshots","--expire-days","1","--force"],c,s);
    state.lifecycle=true; await save(stateFile,state);
  }
  await wrangler(["deploy"],c,s);
  state.owned=true; await save(stateFile,state);
  const runtimeSecrets=Object.fromEntries([
    "UNIFI_API_KEY","LINE_CHANNEL_ACCESS_TOKEN","LINE_CHANNEL_SECRET","LINE_TO",
    "WEBHOOK_TOKEN","PAIR_CODE","PAIR_EXPIRES",
  ].filter(k=>s[k]).map(k=>[k,s[k]]));
  if(!s.LINE_TO) runtimeSecrets.LINE_TO=null;
  await wrangler(["secret","bulk"],c,s,JSON.stringify(runtimeSecrets));
  await save(resolve(privateDir,"unifi-webhook.txt.json"),{
    method:"POST",url:c.origin+"/unifi-alarm?token="+s.WEBHOOK_TOKEN,
    instructions:"UniFi Protect → Alarm Manager → Sensors → Open Status Changed → 選門磁 → Webhook POST → 儲存後重新開啟核對",
  });
  const healthy=await retryCheck(async()=>{
    const r=await fetch(c.origin+'/health',{signal:AbortSignal.timeout(5000)});
    const body=await r.json();return r.ok && body.ok && body.service==='unifi-line-kit';
  },{onRetry:n=>log('部署已完成，等待服務就緒（'+n+'/6）…')});
  if(!healthy) throw new Error("雲端部署與金鑰已完成，但服務尚未通過就緒檢查。稍後執行 npm run status；不需要重新 setup。");
  log("部署完成："+c.origin+"\nWebhook URL 儲存在 .private/unifi-webhook.txt.json（不要分享）。\n已填 LINE_TO：npm run test:live；未填：npm run pair");
  log('查看驗收清單：npm run checklist；查看 webhook：npm run webhook -- unifi');
}
async function authenticated(c,s,path,method="GET") {
  validate(c);
  if(!c.origin) throw new Error("請先部署");
  const r=await fetch(c.origin+path,{method,headers:{authorization:"Bearer "+s.WEBHOOK_TOKEN},
    signal:AbortSignal.timeout(60000),redirect:"error"});
  const data=await r.json();
  if(!r.ok) throw new Error("Worker HTTP "+r.status+" "+(data.error || ""));
  return data;
}
async function beginPair(c,s) {
  if(!s.LINE_CHANNEL_SECRET) throw new Error("請先透過 setup 填入 LINE Channel secret");
  const status=await authenticated(c,s,"/status");
  if(status.paired) { log("已綁定收件人。可執行 npm run test:live"); return {paired:true}; }
  s.PAIR_CODE="PAIR-"+randomBytes(12).toString("hex");
  s.PAIR_EXPIRES=String(Date.now()+15*60*1000);
  await save(secretFile,s);
  await wrangler(["secret","bulk"],c,s,JSON.stringify({
    PAIR_CODE:s.PAIR_CODE,PAIR_EXPIRES:s.PAIR_EXPIRES,LINE_CHANNEL_SECRET:s.LINE_CHANNEL_SECRET}));
  await save(resolve(privateDir,"line-pairing.json"),{webhook:c.origin+"/line",code:s.PAIR_CODE,expires:s.PAIR_EXPIRES});
  return {paired:false,webhook:c.origin+'/line',code:s.PAIR_CODE,expires:Number(s.PAIR_EXPIRES)};
}
async function pair(c,s) {
  const result=await beginPair(c,s);
  if(!result || result.paired)return;
  log('請開啟 .private/line-pairing.json，將 webhook 貼入 LINE Developers，開啟 Use webhook 並 Verify。私訊機器人傳送 code（15 分鐘內）。');
  log('另開終端執行 npm run webhook -- line 查看網址與配對碼。等待配對中，Ctrl+C 可停止等待。');
  let failures=0;
  while(Date.now()<Number(s.PAIR_EXPIRES)) {
    try {
      if((await authenticated(c,s,'/status')).paired) {
        log('✓ LINE 配對成功！下一步：npm run test:live'); return;
      }
      failures=0;
    } catch { if(++failures>=3) throw new Error('暫時無法查詢配對狀態；配對不一定失敗，請執行 npm run status 核對。'); }
    log('等待你傳送配對碼，剩餘 '+Math.max(0,Math.ceil((Number(s.PAIR_EXPIRES)-Date.now())/60000))+' 分鐘。');
    await sleep(10000);
  }
  log('配對碼已到期。請重新執行 npm run pair 取得新碼。');
}
async function liveTest(c,s) {
  if(!(await authenticated(c,s,'/status')).paired) {
    throw new Error('尚未綁定 LINE 收件人，請先配對；沒有發送測試。');
  }
  log("本指令將向已綁定的 LINE 收件人送出一則測試（含所有相機圖片）。");
  let result;
  try { result=await authenticated(c,s,"/test","POST"); }
  catch(error) { throw Object.assign(new Error('通知送出狀態未確認：'+error.message+'。請先查看手機；再次測試可能多送一則通知。'),{delivery:'unknown'}); }
  try {
  if(!result.images?.length) throw new Error("未取得測試圖片");
  for(const image of result.images) {
    if(new URL(image).origin!==c.origin) throw new Error("圖片網址不是此部署");
    const r=await fetch(image,{signal:AbortSignal.timeout(15000),redirect:"error"});
    if(!r.ok || !(r.headers.get("content-type") || "").startsWith("image/")) throw new Error("公開圖片讀取失敗");
    log("✓ R2 公開圖片可讀："+(await r.arrayBuffer()).byteLength+" bytes");
  }
  log("LINE API 已接受；請到 LINE 確認每張圖片正常，再實際開門驗收。");
  await save(resolve(privateDir,'test-result.json'),{origin:c.origin,time:new Date().toISOString(),images:result.images.length});
  log('查看完整驗收清單：npm run checklist');
  return {accepted:true,images:result.images.length,time:new Date().toISOString()};
  } catch(error) {
    throw Object.assign(new Error('LINE API 已接受通知，但後續圖片檢查或紀錄未完成：'+error.message+'。請先查看手機；再次測試會再送一則通知。'),{delivery:'accepted'});
  }
}
async function folder() {
  if(!await exists(privateDir)) throw new Error('此套件還沒有設定資料。請先 npm run setup。套件位置：'+root);
  log('客戶私密資料夾（不要分享）：'+privateDir);
  const command=process.platform==='darwin' ? 'open' : process.platform==='win32' ? 'explorer.exe' : 'xdg-open';
  await new Promise((done,reject)=>{const child=spawn(command,[privateDir],{shell:false,stdio:'ignore'});
    child.on('error',()=>reject(new Error('無法自動開啟；請將上述完整路徑貼入檔案管理員。')));
    child.on('exit',code=>code===0 ? done() : reject(new Error('請手動開啟上述資料夾。')));});
}
async function webhook(c,s) {
  const kind=process.argv[3];
  if(!['unifi','line'].includes(kind)) {log('UniFi Alarm：npm run webhook -- unifi\nLINE 配對：npm run webhook -- line\n網址可能含密鑰，請勿公開終端畫面。');return;}
  if(!c.origin) throw new Error('請先 npm run deploy');
  if(kind==='unifi') {
    log('【UniFi Alarm】Action → Webhook → POST\n'+c.origin+'/unifi-alarm?token='+s.WEBHOOK_TOKEN);
    log('可使用 Person、Motion、越線或門磁事件。儲存後重新開啟核對。');
  } else {
    log('【LINE Developers】Messaging API → Webhook URL\n'+c.origin+'/line\n開啟 Use webhook，按 Verify。');
    if(!s.PAIR_CODE || Date.now()>=Number(s.PAIR_EXPIRES||0)) log('配對碼不存在或已到期；執行 npm run pair。');
    else log('私訊機器人的配對碼：'+s.PAIR_CODE+'\n到期時間：'+new Date(Number(s.PAIR_EXPIRES)).toLocaleString());
  }
}
async function checklist(c,s) {
  const data=await authenticated(c,s,'/status');log(statusText(data));
  const proof=await exists(resolve(privateDir,'test-result.json')) ? await read(resolve(privateDir,'test-result.json')) : null;
  log(proof?.origin===c.origin ? '✓ 曾完成圖片網址讀取及 LINE API 測試：'+proof.time : '○ 尚無本機圖片測試紀錄：npm run test:live');
  log('□ 手機確認測試中的所有圖片均顯示（人工驗收）');
  log(data.last?.ok && !data.last.duplicate && data.last.test===false ? '✓ 最近一般 Alarm 事件已送達 LINE API' : '○ 尚待一般 Alarm 事件成功紀錄；實際觸發 Person／門磁後再查');
  log('□ 實際觸發後，手機收到正確相機的圖片（人工驗收）\nAPI 接受、Test Alarm 成功，都不能替代手機與真實事件驗收。');
}

async function discover(c,s) {
    const r=await fetch(connector(c,"cameras"),{headers:{"X-API-Key":s.UNIFI_API_KEY},signal:AbortSignal.timeout(15000)});
    if(!r.ok) throw new Error("相機列舉失敗 HTTP "+r.status+"；請依 README 使用 Protect 裝置頁取得 ID");
    const data=await r.json(); const list=Array.isArray(data) ? data : data.data;
    if(!Array.isArray(list)) throw new Error("API 回應格式與預期不符，請使用手動 ID");
    return list.map(x=>({name:String(x.name||x.id),id:String(x.id)}));
}
return {doctor,deploy,pair,beginPair,liveTest,authenticated,discover,folder,webhook,checklist};
}
