const $=id=>document.getElementById(id);
const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
const titles=[['讓每一次通知，都有畫面。','不用打指令。跟著六個步驟，把攝影機畫面送到你的 LINE。'],['把三個服務，連接起來。','照著欄位下方的說明貼上資料。已儲存的金鑰，留空就會保留。'],['你想收到哪些畫面？','勾選相機、排好順序，再設定通知文字和截圖時間。'],['準備好了，交給雲端。','先確認連線，再部署。按下部署才會修改 Cloudflare。'],['讓 LINE 知道要傳給誰。','複製網址、傳送配對碼。我們會自動確認是否連接成功。'],['收到畫面，才算完成。','先測試 LINE，再到 UniFi 設定事件，最後實際觸發一次。']];
let current=0,settings={config:{},secretSet:{}},selected=[],cameraNames=new Map(),active=false,seenJob='',pairTimer=null;
const secretKeys=['CLOUDFLARE_API_TOKEN','UNIFI_API_KEY','LINE_CHANNEL_ACCESS_TOKEN','LINE_CHANNEL_SECRET'];
function notify(message,bad=false){$('notice').hidden=false;$('notice').textContent=message;$('notice').classList.toggle('error',bad);}
async function api(path,body){
 const response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:{...(token?{authorization:'Bearer '+token}:{}),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const data=await response.json();if(!response.ok)throw Error(data.error||'連線失敗');return data;
}
function go(step){
 current=step;document.querySelectorAll('[data-panel]').forEach(el=>el.hidden=Number(el.dataset.panel)!==step);
 document.querySelectorAll('.nav-item').forEach(el=>{const yes=Number(el.dataset.step)===step;el.classList.toggle('active',yes);if(yes)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');});
 $('step-label').textContent='STEP 0'+(step+1)+' / 06';$('page-title').textContent=titles[step][0];$('page-subtitle').textContent=titles[step][1];
 window.scrollTo({top:0,behavior:'smooth'});
}
function lock(value){active=value;document.querySelectorAll('.mutation').forEach(el=>el.disabled=value);}
async function loadSettings(){
 settings=await api('settings');const c=settings.config;
 const form=$('settings-form');form.elements.accountId.value=c.accountId||'';form.elements.accountId.readOnly=!!settings.identityLocked;form.elements.consoleId.value=c.consoleId||'';
 for(const k of secretKeys){form.elements[k].value='';document.querySelector('[data-secret="'+k+'"]').textContent=settings.secretSet[k]?'✓ 已設定。留空保留；如需更換，再貼上新值。':'尚未設定，請從對應服務複製。';}
 selected=[...(c.cameraIds||[])];$('alarm-label').value=c.label||'有人來了';$('delay').value=c.delaySeconds??5;updateDelay();
 $('save-state').textContent=c.accountId?'設定已儲存':'尚未設定';
 $('target-account').textContent=c.accountId||'尚未設定';$('target-name').textContent=c.name||'儲存後自動建立';$('target-cameras').textContent=selected.length+' 台';$('target-delay').textContent=(c.delaySeconds??5)+' 秒';renderSelected();
}
function updateDelay(){$('delay-value').textContent=$('delay').value+' 秒';}
function renderSelected(){
 const box=$('selected-cameras');box.replaceChildren();
 selected.forEach((id,index)=>{const row=document.createElement('div');row.className='selected-row';const name=document.createElement('span');name.className='camera-name';name.textContent=(index+1)+'. '+(cameraNames.get(id)||id);row.append(name);
  for(const [label,delta] of [['↑',-1],['↓',1]]){const b=document.createElement('button');b.type='button';b.textContent=label;b.setAttribute('aria-label',(delta<0?'上移 ':'下移 ')+(cameraNames.get(id)||id));b.disabled=index+delta<0||index+delta>=selected.length;b.onclick=()=>{[selected[index],selected[index+delta]]=[selected[index+delta],selected[index]];renderSelected();};row.append(b);}
  const remove=document.createElement('button');remove.textContent='移除';remove.type='button';remove.onclick=()=>{selected=selected.filter(x=>x!==id);renderSelected();syncChecks();};row.append(remove);box.append(row);
 });
 $('manual-cameras').value=selected.join(',');
}
function syncChecks(){document.querySelectorAll('[data-camera]').forEach(el=>el.checked=selected.includes(el.dataset.camera));}
function renderCameras(list){
 const box=$('camera-list');box.replaceChildren();
 if(!list.length){const p=document.createElement('p');p.className='empty';p.textContent='沒有找到攝影機。請確認主機 ID 和權限，或手動輸入 ID。';box.append(p);return;}
 for(const camera of list){cameraNames.set(camera.id,camera.name);const label=document.createElement('label');label.className='camera-choice';const check=document.createElement('input');check.type='checkbox';check.dataset.camera=camera.id;check.checked=selected.includes(camera.id);
  check.onchange=()=>{if(check.checked){if(selected.length>=4){check.checked=false;notify('最多選 4 台攝影機。',true);return;}selected.push(camera.id);}else selected=selected.filter(id=>id!==camera.id);renderSelected();};
  const text=document.createElement('span');text.textContent=camera.name;const small=document.createElement('small');small.textContent=camera.id;text.append(small);label.append(check,text);box.append(label);
 }renderSelected();
}
async function job(action){
 if(active)return;
 $('notice').hidden=true;lock(true);
 try {await api('jobs',{action});await pollJob();$('job-panel').scrollIntoView({behavior:'smooth',block:'nearest'});}
 catch(error){lock(false);notify(error.message,true);}
}
async function pollJob(){
 try{
  const j=await api('job');if(j.state==='idle')return;
  $('job-panel').hidden=false;$('job-title').textContent=j.title;$('job-state').textContent={running:'進行中',succeeded:'已完成',failed:'需要處理'}[j.state];$('job-state').classList.toggle('failed',j.state==='failed');
  $('job-time').textContent='已耗時 '+Math.max(0,Math.floor(((j.finished||Date.now())-j.started)/1000))+' 秒';$('job-log').textContent=j.logs.join('\n');lock(j.state==='running');
  if(j.state==='running'){$('job-next').textContent='請保持本機服務開啟，這裡會自動更新。';setTimeout(pollJob,1500);return;}
  if(seenJob===j.id)return;seenJob=j.id;
  if(j.state==='failed'){
   $('job-next').textContent=j.action==='test'?'請先查看手機與上方結果。若再次按「發送測試」，可能多送一則通知。':'請依上方提示修正，再按原本的操作按鈕重試。已完成的部署資源會保留。';
   if(j.action==='test'){$('test-result').textContent=(j.delivery==='accepted'?'✓ LINE API 已接受通知。後續驗證未完成。 ':j.delivery==='unknown'?'通知是否送出尚未確認。 ':'測試未完成。 ')+j.error;$('phone-confirm').checked=false;}
   notify(j.error,true);return;
  }
  const next={doctor:'檢查通過，尚未發送 LINE。下一步按「部署至 Cloudflare」。',discover:'相機清單已讀取，請勾選要收到的畫面。',deploy:'部署已完成。下一步：連接 LINE。',pair:'配對資料已準備好，請完成 LINE 的兩個步驟。',test:'LINE API 已接受，圖片網址可讀。請拿起手機確認每張圖片。'};
  $('job-next').textContent=next[j.action];notify(next[j.action]);
  if(j.action==='discover'){renderCameras(j.result);go(2);}
  if(j.action==='deploy')await loadSettings();
  if(j.action==='pair'){go(4);if(j.result.paired){$('pair-status').textContent='✓ LINE 已連接，可以到下一步發送測試。';}else{await webhooks();startPairPolling();}}
  if(j.action==='test'){$('test-result').textContent='✓ LINE API 已接受通知；'+j.result.images+' 張圖片網址可讀。請在手機確認實際顯示。';$('phone-confirm').checked=false;}
 }catch(error){lock(false);notify('無法更新進度：'+error.message+' 請勿直接重複部署；可先重新檢查狀態。',true);}
}
async function webhooks(){
 const data=await api('webhooks');$('line-url').value=data.line;$('unifi-url').value=data.unifi;$('unifi-details').hidden=false;
 $('pair-details').hidden=false;$('pair-code').value=data.code||'配對碼未建立或已過期';$('pair-expiry').textContent=data.expires?'有效至 '+new Date(data.expires).toLocaleTimeString()+'。勿分享配對碼。':'請按「開始配對」取得新碼。';return data;
}
async function status(){
 const data=await api('status');
 if(data.notDeployed){$('pair-status').textContent='請先完成第 4 步：部署至 Cloudflare。';$('status-result').textContent='尚未部署。';return data;}
 $('pair-status').textContent=data.paired?'✓ LINE 已連接，可以到下一步發送測試。':'尚未連接 LINE。請確認 Webhook 已啟用，再私訊配對碼。';
 const last=data.last;let event='尚無 Alarm 事件紀錄';
 if(last)event=(last.test===true?'Test Alarm':last.test===false?'一般事件':'事件')+'：'+(last.duplicate?'重複事件，已略過':last.ok?'LINE API 已接受':('失敗：'+last.error))+'\n時間：'+last.time;
 $('status-result').textContent='✓ Worker 可連線\n'+(data.paired?'✓ LINE 已連接':'○ LINE 尚未連接')+'\n'+event;
 if(data.proof)$('test-result').textContent='歷史測試：'+new Date(data.proof.time).toLocaleString()+'，'+data.proof.images+' 張圖片網址可讀。仍需手機確認。';
 if(data.paired){clearInterval(pairTimer);pairTimer=null;$('pair-details').hidden=true;}
 return data;
}
function startPairPolling(){clearInterval(pairTimer);let failures=0;const tick=async()=>{try{await status();failures=0;const time=$('pair-expiry').textContent;if(time && !$('pair-details').hidden){const code=await api('webhooks');if(!code.code){clearInterval(pairTimer);$('pair-status').textContent='配對碼已到期，請重新按「開始配對」。';}}}catch(error){if(++failures>=3){clearInterval(pairTimer);notify('暫時無法確認配對，請按「檢查連接狀態」重試。'+error.message,true);}}};pairTimer=setInterval(tick,10000);tick();}
function safe(fn){return async event=>{try{await fn(event);}catch(error){notify(error.message,true);}};}
document.querySelectorAll('[data-step]').forEach(el=>el.addEventListener('click',()=>go(Number(el.dataset.step))));
document.querySelectorAll('[data-action]').forEach(el=>el.addEventListener('click',()=>job(el.dataset.action)));
document.querySelector('.brand').addEventListener('click',event=>{event.preventDefault();go(0);});
$('settings-form').addEventListener('submit',safe(async event=>{
 event.preventDefault();if(active)return;const f=event.target;
 const secrets=Object.fromEntries(secretKeys.map(k=>[k,f.elements[k].value.trim()]));
 if(!secrets.LINE_CHANNEL_SECRET&&!settings.secretSet.LINE_CHANNEL_SECRET&&!settings.secretSet.LINE_TO)throw Error('請填寫 LINE Channel secret，稍後才能連接收件人。');
 lock(true);try{await api('settings',{config:{accountId:f.elements.accountId.value.trim().toLowerCase(),consoleId:f.elements.consoleId.value.trim()},secrets});await loadSettings();notify('資料已儲存。接著選擇攝影機。');go(2);}finally{lock(false);}
}));
$('camera-form').addEventListener('submit',safe(async event=>{
 event.preventDefault();if(active)return;if(!selected.length)throw Error('請至少選一台攝影機。');
 lock(true);try{await api('settings',{config:{cameraIds:selected,label:$('alarm-label').value,delaySeconds:Number($('delay').value)}});await loadSettings();notify('相機與通知設定已儲存。');go(3);}finally{lock(false);}
}));
$('apply-manual').onclick=safe(async()=>{const ids=$('manual-cameras').value.split(',').map(x=>x.trim()).filter(Boolean);if(!ids.length||ids.length>4||new Set(ids).size!==ids.length||ids.some(id=>! /^[a-zA-Z0-9_-]+$/.test(id)))throw Error('請填入 1–4 個不同的攝影機 ID，以英文逗號分隔。');selected=ids;renderSelected();syncChecks();notify('已選取，請記得按「儲存並繼續」。');});
$('delay').oninput=updateDelay;$('discover').onclick=()=>job('discover');
$('pair-refresh').onclick=safe(async()=>{await status();});$('status-refresh').onclick=safe(async()=>{await status();});
$('show-webhooks').onclick=safe(webhooks);
document.querySelectorAll('[data-copy]').forEach(button=>button.onclick=safe(async()=>{const input=$(button.dataset.copy);if(!input.value)throw Error('請先取得資料');try{await navigator.clipboard.writeText(input.value);const previous=button.textContent;button.textContent='已複製 ✓';setTimeout(()=>button.textContent=previous,2000);}catch{input.focus();input.select();notify('已選取文字，請按 Command+C（Windows：Ctrl+C）複製。');}}));
try{if(token)await api('session',{});await loadSettings();await pollJob();}catch(error){notify(error.message,true);}
