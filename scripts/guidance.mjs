export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function retryCheck(check, {attempts=6, delay=3000, wait=sleep, onRetry=()=>{}}={}) {
  for(let i=0;i<attempts;i++) {
    try { if(await check()) return true; } catch {}
    if(i<attempts-1) { onRetry(i+1); await wait(delay); }
  }
  return false;
}
export function permissionHint(path) {
  if(path.includes('/workers/subdomain')) return '無法讀取 workers.dev 子網域；檢查 Workers 指令碼（Workers Scripts）／編輯及帳戶範圍。這不代表子網域不存在。';
  if(path.includes('/workers/')) return '請選「帳戶 → Workers 指令碼（Workers Scripts）→ 編輯」，不是「Workers 代理程式設定」。';
  if(path.includes('/storage/kv/')) return '請加入「帳戶 → Workers KV 儲存空間 → 編輯」。';
  if(path.includes('/r2/')) return '請確認 R2 已開通，且有「帳戶 → Workers R2 儲存空間 → 編輯」。';
  return '請確認 token 有效且涵蓋這個 Account ID。';
}
export function statusText(data) {
  const last=data.last;
  return ['✓ Worker 可連線',data.paired ? '✓ LINE 已綁定' : '○ LINE 尚未綁定：執行 npm run pair',
    !last ? '○ 尚無 Alarm 事件紀錄' : last.duplicate ? '最近事件：已略過重複事件（未再次發送）' :
    last.ok ? '最近事件：LINE API 已接受通知' : '最近事件失敗：'+last.error,
    ...(last ? ['事件時間：'+last.time,'事件類型：'+(last.test===true ? 'UniFi Test Alarm' : last.test===false ? '一般事件' : '舊版紀錄，無法區分測試與實際事件')] : [])].join('\n');
}
