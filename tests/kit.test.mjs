import test from "node:test";
import assert from "node:assert/strict";
import worker,{eventIdentity} from "../src/worker.mjs";
import {validate,runtimeConfig} from "../scripts/config.mjs";
class KV {
  data=new Map();
  expires=new Map(); now=0;
  async get(k,type) { if(this.expires.has(k) && this.now>=this.expires.get(k))this.data.delete(k); const v=this.data.get(k) ?? null; return type==="json" && v ? JSON.parse(v) : v; }
  async put(k,v,options={}) {this.data.set(k,v);if(options.expirationTtl)this.expires.set(k,this.now+options.expirationTtl);}
  async delete(k) {this.data.delete(k);}
}
class R2 {
  data=new Map();
  async put(k,body,options) {this.data.set(k,{body,...options});}
  async get(k) {const o=this.data.get(k);return o && {...o,writeHttpMetadata:h=>h.set("content-type",o.httpMetadata.contentType)};}
}
function env() {return {
  WEBHOOK_TOKEN:"a".repeat(64),UNIFI_API_KEY:"fake-unifi",LINE_CHANNEL_ACCESS_TOKEN:"fake-line",
  LINE_TO:"U-test",LINE_CHANNEL_SECRET:"fake-secret",CONSOLE_ID:"console",
  CAMERA_IDS:'["entry","room"]',DELAY_SECONDS:"0",ALARM_LABEL:"Door",
  PUBLIC_ORIGIN:"https://door-test.example.workers.dev",IMAGES:new R2(),SNAPSHOTS:new KV(),
};}
const request=(path,method="POST",body={},token="a".repeat(64))=>new Request("https://door-test.example.workers.dev"+path,{
  method,headers:{authorization:"Bearer "+token},...(method==="POST" ? {body:JSON.stringify(body)} : {}),
});
function jpeg() {const v=new Uint8Array(2048);v.set([255,216,255]);return v;}
async function mockNetwork(fn) {
  const prior=globalThis.fetch, pushes=[];
  globalThis.fetch=async (url,options)=>{
    if(String(url).startsWith("https://api.ui.com/")) return new Response(jpeg(),{headers:{"content-type":"image/jpeg"}});
    if(String(url)==="https://api.line.me/v2/bot/message/push") {
      pushes.push(JSON.parse(options.body));return new Response("{}");
    }
    throw new Error("Unexpected network");
  };
  try {await fn(pushes);}finally{globalThis.fetch=prior;}
}
test("customer config rejects unsafe resource names and foreign test URLs",()=>{
  const c={accountId:"b".repeat(32),name:"door-test",consoleId:"console",cameraIds:["entry"],delaySeconds:5,label:"Door"};
  assert.equal(validate(c),c);
  assert.throws(()=>validate({...c,name:"../production"}));
  assert.throws(()=>validate({...c,origin:"https://evil.example"}));
  assert.throws(()=>validate({...c,cameraIds:Array(5).fill("entry")}));
  assert.throws(()=>validate({...c,delaySeconds:20}));
  assert.equal(runtimeConfig(c,{kvId:"namespace"}).vars.CAMERA_IDS,'["entry"]');
});
test("alarm rule ID does not replace the actual event ID",()=>{
  assert.equal(eventIdentity({alarm_id:"rule",alarm:{triggers:[{eventId:"opening-1"}]}}),"opening-1");
  assert.equal(eventIdentity({alarm_id:"rule"}),"");
});
test("unauthenticated test cannot capture or send",async()=>{
  assert.equal((await worker.fetch(request("/test","POST",{},"wrong"),env())).status,401);
});
test("R2-backed LINE images can be read and expire at the application boundary",async()=>{
  await mockNetwork(async pushes=>{
    const e=env();
    const r=await worker.fetch(request("/test"),e);
    assert.equal(r.status,200);
    const result=await r.json();
    assert.equal(pushes.length,1);
    assert.deepEqual(pushes[0].messages.map(x=>x.type),["text","image","image"]);
    assert.equal(e.IMAGES.data.size,2);
    assert.equal(e.SNAPSHOTS.data.size,0);
    for(const url of result.images) {
      const image=await worker.fetch(new Request(url),e);
      assert.equal(image.status,200);
      assert.deepEqual(new Uint8Array(await image.arrayBuffer()),jpeg());
      assert.equal(image.headers.get("content-type"),"image/jpeg");
    }
    for(const o of e.IMAGES.data.values()) o.customMetadata.expiresAt="1";
    assert.equal((await worker.fetch(new Request(result.images[0]),e)).status,404);
  });
});
test("each actual event runs once, different events under the same rule run separately",async()=>{
  await mockNetwork(async pushes=>{
    const e=env();
    for(const eventId of ["one","one","two"]) {
      const tasks=[];
      const r=await worker.fetch(request("/unifi-alarm","POST",{
        alarm_id:"rule",timestamp:Date.now(),alarm:{triggers:[{eventId}]},
      }),e,{waitUntil:p=>tasks.push(p)});
      assert.equal(r.status,202);
      await Promise.all(tasks);
    }
    assert.equal(pushes.length,2);
  });
});
test("rejects oversized bodies and stale events before scheduling",async()=>{
  const e=env();
  assert.equal((await worker.fetch(request("/unifi-alarm","POST",{timestamp:1}),e)).status,400);
  assert.equal((await worker.fetch(request("/unifi-alarm","POST",{value:"a".repeat(70000)}),e)).status,413);
});
test('Test Alarm can repeat after 60 seconds while real events retain 600-second dedupe',async()=>{
  await mockNetwork(async pushes=>{
    const e=env();
    const send=async(eventId)=>{
      const tasks=[];
      await worker.fetch(request('/unifi-alarm','POST',{alarm_id:'rule',alarm:{triggers:[{eventId}]}}),e,{waitUntil:p=>tasks.push(p)});
      await Promise.all(tasks);
    };
    await send('testEventId');await send('testEventId');assert.equal(pushes.length,1);
    await send('real');assert.equal(pushes.length,2);
    e.SNAPSHOTS.now=61;
    await send('testEventId');assert.equal(pushes.length,3);
    assert.equal((await e.SNAPSHOTS.get('last:result','json')).test,true);
    await send('real');assert.equal(pushes.length,3);
    e.SNAPSHOTS.now=601;await send('real');assert.equal(pushes.length,4);
  });
});
test("LINE pairing needs a valid signature, a live code and a direct user message",async()=>{
  const e=env();e.LINE_TO="";e.PAIR_CODE="PAIR-private";e.PAIR_EXPIRES=String(Date.now()+60000);
  const body=JSON.stringify({events:[{source:{type:"user",userId:"U-paired"},
    message:{type:"text",text:e.PAIR_CODE}}]});
  const make=signature=>new Request("https://door-test.example.workers.dev/line",{
    method:"POST",body,headers:{"x-line-signature":signature},
  });
  assert.equal((await worker.fetch(make("invalid"),e)).status,401);
  assert.equal(await e.SNAPSHOTS.get("line:recipient"),null);
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(e.LINE_CHANNEL_SECRET),
    {name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const sign=Buffer.from(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(body))).toString("base64");
  assert.equal((await worker.fetch(make(sign),e)).status,200);
  assert.equal(await e.SNAPSHOTS.get("line:recipient"),"U-paired");
});
test("a missing R2 write prevents sending broken images",async()=>{
  await mockNetwork(async pushes=>{
    const e=env();e.IMAGES.put=async()=>{throw new Error("R2_WRITE_FAILED");};
    assert.equal((await worker.fetch(request("/test"),e)).status,502);
    assert.equal(pushes.length,0);
  });
});
test("an expired pairing code cannot bind a recipient",async()=>{
  const e=env();e.LINE_TO="";e.PAIR_CODE="expired";e.PAIR_EXPIRES="1";
  const body=JSON.stringify({events:[{source:{type:"user",userId:"U-wrong"},message:{type:"text",text:"expired"}}]});
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(e.LINE_CHANNEL_SECRET),
    {name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signature=Buffer.from(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(body))).toString("base64");
  await worker.fetch(new Request("https://door-test.example.workers.dev/line",{
    method:"POST",body,headers:{"x-line-signature":signature}}),e);
  assert.equal(await e.SNAPSHOTS.get("line:recipient"),null);
});
