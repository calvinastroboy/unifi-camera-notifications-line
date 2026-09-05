export function validate(config, {allowEmptyCameras = false} = {}) {
  if (!/^[a-f0-9]{32}$/.test(config.accountId || "")) throw new Error("Cloudflare Account ID 必須是 32 位十六進位字元");
  if (!/^[a-z][a-z0-9-]{2,45}$/.test(config.name || "")) throw new Error("Worker 名稱格式錯誤");
  if (typeof config.consoleId !== "string" || !/^[a-zA-Z0-9:_-]+$/.test(config.consoleId)) throw new Error("請填入 Console ID");
  if (!Array.isArray(config.cameraIds) || (!allowEmptyCameras && config.cameraIds.length < 1) || config.cameraIds.length > 4 ||
      config.cameraIds.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id)))
    throw new Error("請填入 1–4 個相機 ID");
  if (!Number.isInteger(config.delaySeconds) || config.delaySeconds < 0 || config.delaySeconds > 10)
    throw new Error("延遲必須為 0–10 秒整數");
  if (typeof config.label !== "string" || !config.label.trim() || config.label.length > 1000) throw new Error("通知文字格式錯誤");
  if (config.origin && !/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(config.origin))
    throw new Error("測試網址只接受本套件的 workers.dev HTTPS 網址");
  if (config.origin && new URL(config.origin).hostname.split(".")[0] !== config.name)
    throw new Error("網址與 Worker 名稱不符");
  return config;
}
export function runtimeConfig(c,state) {
  validate(c);
  return {name:c.name,account_id:c.accountId,main:"../src/worker.mjs",
    compatibility_date:"2026-09-01",workers_dev:true,
    kv_namespaces:[{binding:"SNAPSHOTS",id:state.kvId}],
    r2_buckets:[{binding:"IMAGES",bucket_name:c.name+"-images"}],
    vars:{CONSOLE_ID:c.consoleId,CAMERA_IDS:JSON.stringify(c.cameraIds),
      ALARM_LABEL:c.label,DELAY_SECONDS:String(c.delaySeconds),PUBLIC_ORIGIN:c.origin}};
}
