const encoder = new TextEncoder();
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});
function equal(a = "", b = "") {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 65536) { await reader.cancel(); throw new Error("BODY_TOO_LARGE"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
export function eventIdentity(payload) {
  const trigger = payload?.alarm?.triggers?.[0] ?? payload?.triggers?.[0];
  // alarm_id identifies a rule, not an individual door opening.
  return trigger?.eventId || payload?.eventId || "";
}
export function cameras(env) {
  const ids = JSON.parse(env.CAMERA_IDS || "[]");
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 4 ||
      ids.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id)))
    throw new Error("CAMERA_CONFIG");
  return ids;
}
async function capture(env, cameraId) {
  const url = "https://api.ui.com/v1/connector/consoles/" + encodeURIComponent(env.CONSOLE_ID)
    + "/proxy/protect/integration/v1/cameras/" + encodeURIComponent(cameraId) + "/snapshot";
  const response = await fetch(url, {
    headers: { "X-API-Key": env.UNIFI_API_KEY }, signal: AbortSignal.timeout(12000),
  });
  const type = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!response.ok || !["image/jpeg","image/png"].includes(type)) throw new Error("SNAPSHOT_HTTP_" + response.status);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 1024 || bytes.byteLength > 1000000) throw new Error("SNAPSHOT_SIZE");
  const magic = new Uint8Array(bytes);
  if (type === "image/jpeg" ? !(magic[0] === 255 && magic[1] === 216 && magic[2] === 255) :
      !(magic[0] === 137 && magic[1] === 80 && magic[2] === 78 && magic[3] === 71))
    throw new Error("SNAPSHOT_FORMAT");
  const id = crypto.randomUUID() + (type === "image/png" ? ".png" : ".jpg");
  await env.IMAGES.put(id, bytes, { httpMetadata: { contentType: type },
    customMetadata: { expiresAt: String(Date.now() + 86400000) } });
  return env.PUBLIC_ORIGIN + "/image/" + id;
}
async function notify(env, payload, test = false) {
  const key = eventIdentity(payload);
  const rule = String(payload?.alarm_id || payload?.alarm?.name || "door").slice(0,128);
  const testAlarm = key === "testEventId";
  const dedupe = testAlarm ? "test-alarm:" + rule : key ? "event:" + key.slice(0,128) : "debounce:" + rule;
  if (!test && await env.SNAPSHOTS.get(dedupe)) return { ok: true, duplicate: true };
  const recipient = env.LINE_TO || await env.SNAPSHOTS.get("line:recipient");
  if (!recipient) throw new Error("LINE_NOT_PAIRED");
  if (!test) await env.SNAPSHOTS.put(dedupe, "1", { expirationTtl: key && !testAlarm ? 600 : 60 });
  let pushStarted = false;
  try {
    const delay = Number(env.DELAY_SECONDS || 0);
    if (!Number.isFinite(delay) || delay < 0 || delay > 10) throw new Error("DELAY_CONFIG");
    if (delay) await new Promise(resolve => setTimeout(resolve, delay * 1000));
    const urls = await Promise.all(cameras(env).map(id => capture(env,id)));
    pushStarted = true;
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method:"POST", signal:AbortSignal.timeout(8000),
      headers:{authorization:"Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN,"content-type":"application/json",
        "X-Line-Retry-Key":crypto.randomUUID()},
      body:JSON.stringify({to:recipient,messages:[
        {type:"text",text:(test ? "【測試】" : "") + env.ALARM_LABEL},
        ...urls.map(url => ({type:"image",originalContentUrl:url,previewImageUrl:url})),
      ]}),
    });
    if (!response.ok) throw new Error("LINE_HTTP_" + response.status);
    return {ok:true,images:urls};
  } catch (error) {
    // Do not release a dedupe key after an uncertain LINE send.
    if (!test && !pushStarted) await env.SNAPSHOTS.delete(dedupe);
    throw error;
  }
}
async function lineWebhook(request, env) {
  const raw = await readBody(request);
  const key = await crypto.subtle.importKey("raw",encoder.encode(env.LINE_CHANNEL_SECRET || ""),
    {name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const hash = new Uint8Array(await crypto.subtle.sign("HMAC",key,encoder.encode(raw)));
  const signature = btoa(String.fromCharCode(...hash));
  if (!equal(signature,request.headers.get("x-line-signature") || "")) return json({ok:false},401);
  const payload = JSON.parse(raw);
  if (Date.now() < Number(env.PAIR_EXPIRES) && env.PAIR_CODE &&
      !await env.SNAPSHOTS.get("line:recipient")) {
    for (const event of payload.events || []) {
      if (event.source?.type !== "user" || event.message?.type !== "text" ||
          !equal(event.message.text.trim(),env.PAIR_CODE)) continue;
      await env.SNAPSHOTS.put("line:recipient",event.source.userId);
      break;
    }
  }
  return json({ok:true});
}
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health")
        return json({ok:true,service:"unifi-line-kit",version:"1.1.0"});
      if (request.method === "GET" && url.pathname.startsWith("/image/")) {
        const id = url.pathname.slice(7);
        if (!/^[0-9a-f-]{36}\.(jpg|png)$/.test(id)) return json({ok:false},404);
        const object = await env.IMAGES.get(id);
        if (!object || Date.now() >= Number(object.customMetadata?.expiresAt || 0))
          return json({ok:false},404);
        const headers = new Headers({"cache-control":"private, no-store","x-content-type-options":"nosniff"});
        object.writeHttpMetadata(headers);
        return new Response(object.body,{headers});
      }
      if (request.method === "POST" && url.pathname === "/line")
        return await lineWebhook(request,env);
      const supplied = request.headers.get("authorization")?.replace(/^Bearer /,"") ||
        url.searchParams.get("token") || "";
      if (!env.WEBHOOK_TOKEN || env.WEBHOOK_TOKEN.length < 32 || !equal(supplied,env.WEBHOOK_TOKEN))
        return json({ok:false},401);
      if (request.method === "GET" && url.pathname === "/status")
        return json({ok:true,paired:Boolean(env.LINE_TO || await env.SNAPSHOTS.get("line:recipient")),
          last:await env.SNAPSHOTS.get("last:result","json")});
      if (request.method !== "POST" || !["/test","/unifi-alarm"].includes(url.pathname))
        return json({ok:false},404);
      if (url.pathname === "/test") return json(await notify(env,null,true));
      const payload = JSON.parse(await readBody(request));
      const trigger = payload?.alarm?.triggers?.[0] ?? payload?.triggers?.[0];
      const rawTimestamp = payload?.timestamp ?? trigger?.timestamp;
      if (rawTimestamp !== undefined) {
        const value = Number(rawTimestamp);
        const timestamp = value < 1e12 ? value * 1000 : value;
        if (!Number.isFinite(timestamp) || Math.abs(Date.now()-timestamp) > 300000)
          return json({ok:false,error:"STALE_EVENT"},400);
      }
      ctx.waitUntil((async () => {
        let result;
        try { const sent = await notify(env,payload); result = {ok:true,duplicate:!!sent.duplicate}; }
        catch (error) { result = {ok:false,error:error.message}; console.error(error.message); }
        await env.SNAPSHOTS.put("last:result",JSON.stringify({...result,test:eventIdentity(payload)==="testEventId",time:new Date().toISOString()}));
      })());
      return json({ok:true,accepted:true},202);
    } catch (error) {
      const code = /^[A-Z_0-9]+$/.test(error.message) ? error.message : "REQUEST_FAILED";
      return json({ok:false,error:code},code === "BODY_TOO_LARGE" ? 413 : 502);
    }
  },
};
