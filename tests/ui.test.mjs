import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';
import {createStore,sanitize} from '../scripts/store.mjs';
import {createOperations} from '../scripts/operations.mjs';
import {startServer} from '../scripts/ui-server.mjs';
const config={accountId:'b'.repeat(32),name:'door-demo',consoleId:'demo-console',cameraIds:['entry'],delaySeconds:5,label:'通知'};
const secrets={CLOUDFLARE_API_TOKEN:'fake-cloud',UNIFI_API_KEY:'fake-unifi',LINE_CHANNEL_ACCESS_TOKEN:'fake-line',LINE_CHANNEL_SECRET:'fake-secret'};
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'line-ui-test-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('settings preserve saved secrets without exposing them to UI',async t=>{
 const root=await fixture(t),store=createStore(root);
 await store.update({config,secrets});
 await store.update({config:{label:'更新'},secrets:{UNIFI_API_KEY:''}});
 const saved=await store.load();assert.equal(saved.config.label,'更新');assert.equal(saved.secrets.UNIFI_API_KEY,'fake-unifi');
 const pub=await store.publicSettings();assert.equal(pub.secretSet.UNIFI_API_KEY,true);
 assert.equal(JSON.stringify(pub).includes('fake-unifi'),false);
 assert.equal(saved.secrets.WEBHOOK_TOKEN.length,64);
});
test('invalid settings cannot replace existing settings or arbitrary file paths',async t=>{
 const store=createStore(await fixture(t));await store.update({config,secrets});
 await store.save(join(store.privateDir,'state.json'),{accountId:config.accountId,name:config.name});
 await assert.rejects(store.update({config:{cameraIds:['../escape']}}));
 await assert.rejects(store.update({config:{accountId:'a'.repeat(32)}}));
 await assert.rejects(store.update({secrets:{WEBHOOK_TOKEN:'attacker'}}));
 assert.deepEqual((await store.load()).config.cameraIds,['entry']);
});
test('account typo can be corrected before any deployment resources exist',async t=>{
 const store=createStore(await fixture(t));await store.update({config,secrets});
 await store.update({config:{accountId:'c'.repeat(32)}});
 assert.equal((await store.publicSettings()).config.accountId,'c'.repeat(32));
 assert.equal((await store.publicSettings()).identityLocked,false);
});
test('operations return camera choices and block unpaired test before send',async t=>{
 const root=await fixture(t);let pushes=0;
 const ops=createOperations(root,{log:()=>{},fetch:async url=>{
  if(String(url).endsWith('/cameras'))return Response.json([{id:'entry',name:'入口'}]);
  if(String(url).endsWith('/status'))return Response.json({ok:true,paired:false,last:null});
  pushes++;throw Error('Unexpected send');
 }});
 assert.deepEqual(await ops.discover(config,secrets),[{id:'entry',name:'入口'}]);
 await assert.rejects(ops.liveTest({...config,origin:'https://door-demo.example.workers.dev'},secrets),/配對|綁定/);
 assert.equal(pushes,0);
});
async function serverFixture(t,operations){
 const root=await fixture(t);await createStore(root).update({config,secrets});
 const app=await startServer({root,operations});
 t.after(()=>new Promise(resolve=>{app.server.closeAllConnections();app.server.close(resolve);}));
 const call=(path,body,headers={})=>fetch(app.origin+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+app.token,origin:app.origin,'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {...app,call,root};
}
test('local API blocks unauthorized, cross-origin and spoofed-host requests',async t=>{
 const app=await serverFixture(t);
 assert.equal((await fetch(app.origin+'/api/settings')).status,401);
 assert.equal((await app.call('/api/settings',undefined,{origin:'https://evil.example'})).status,403);
 const hostStatus=await new Promise((resolve,reject)=>{const req=httpRequest(app.origin+'/api/settings',{headers:{host:'evil.example',authorization:'Bearer '+app.token}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
 assert.equal(hostStatus,403);
 const response=await app.call('/api/settings');assert.equal(response.status,200);
 assert.equal((await response.text()).includes('fake-unifi'),false);
 assert.equal((await app.call('/api/jobs',{action:'exec'})).status,400);
 assert.equal((await app.call('/api/settings',{blob:'x'.repeat(70000)})).status,413);
 assert.equal((await fetch(app.origin+'/.private/secrets.json')).status,404);
});
test('jobs reject conflicts and redact secrets in failures',async t=>{
 let fail;const gate=new Promise((_,reject)=>{fail=reject;});
 const app=await serverFixture(t,()=>({doctor:()=>gate}));
 assert.equal((await app.call('/api/jobs',{action:'doctor'})).status,202);
 assert.equal((await app.call('/api/jobs',{action:'doctor'})).status,409);
 assert.equal((await app.call('/api/settings',{config:{label:'bad'}})).status,409);
 fail(Error('fake-unifi https://host/unifi-alarm?token=supersecret'));
 await new Promise(resolve=>setTimeout(resolve,20));
 const job=await (await app.call('/api/job')).json();
 assert.equal(job.state,'failed');assert.equal(JSON.stringify(job).includes('fake-unifi'),false);
 assert.equal(JSON.stringify(job).includes('supersecret'),false);
});
test('static app loads with security headers without exposing configuration',async t=>{
 const app=await serverFixture(t);
 const page=await fetch(app.origin+'/');assert.equal(page.status,200);
 assert.match(page.headers.get('content-security-policy'),/default-src 'self'/);
 assert.match(page.headers.get('cache-control'),/no-store/);
 assert.equal((await page.text()).includes('fake-unifi'),false);
 for(const asset of ['/app.js','/style.css'])assert.equal((await fetch(app.origin+asset)).status,200);
});
test('sanitizing nested results preserves object structure even for short secret strings',()=>{
 assert.deepEqual(sanitize({accepted:true,value:'x-token',nested:['x']},{secret:'x'}),{accepted:true,value:'[已隱藏]-token',nested:['[已隱藏]']});
});
test('pair preparation stores an expiring code and preserves existing recipient binding',async t=>{
 const root=await fixture(t),store=createStore(root);await store.update({config,secrets});
 const saved=await store.load();saved.config.origin='https://door-demo.example.workers.dev';let uploads=0;
 const ops=createOperations(root,{log:()=>{},fetch:async()=>Response.json({ok:true,paired:false}),runWrangler:async(args,c,s,input)=>{assert.deepEqual(args,['secret','bulk']);assert.ok(JSON.parse(input).PAIR_CODE.startsWith('PAIR-'));uploads++;}});
 const result=await ops.beginPair(saved.config,saved.secrets);
 assert.match(result.code,/^PAIR-/);assert.ok(result.expires>Date.now());assert.ok(result.expires<=Date.now()+900000);
 assert.equal((await store.load()).secrets.PAIR_CODE,result.code);assert.equal(uploads,1);
 const pairedOps=createOperations(root,{log:()=>{},fetch:async()=>Response.json({ok:true,paired:true}),runWrangler:async()=>{throw Error('must not change binding');}});
 assert.deepEqual(await pairedOps.beginPair(saved.config,saved.secrets),{paired:true});
});
test('refresh can use a session-only HttpOnly cookie but external sites cannot write',async t=>{
 const app=await serverFixture(t);
 const bootstrap=await app.call('/api/session',{});assert.equal(bootstrap.status,200);
 const cookie=bootstrap.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.doesNotMatch(cookie,/Max-Age|Expires/);
 const headers={cookie:cookie.split(';')[0]};
 assert.equal((await fetch(app.origin+'/api/settings',{headers})).status,200);
 assert.equal((await fetch(app.origin+'/api/settings',{method:'POST',headers:{...headers,origin:'https://evil.example','content-type':'application/json'},body:'{}'})).status,403);
});
test('shared deployment persists owned resources and secret upload through injected upstreams',async t=>{
 const root=await fixture(t),store=createStore(root);await store.update({config,secrets});
 const {config:c,secrets:s}=await store.load();const commands=[];
 const jpeg=new Uint8Array(2048);jpeg.set([255,216,255]);
 const ops=createOperations(root,{log:()=>{},runWrangler:async(args,_c,_s,input)=>{commands.push(args[0]);if(args[0]==='secret')assert.equal(JSON.parse(input).UNIFI_API_KEY,'fake-unifi');},fetch:async(url,options={})=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/workers/scripts'))return Response.json({success:true,result:[]});
  if(path.endsWith('/workers/subdomain'))return Response.json({success:true,result:{subdomain:'example'}});
  if(path.endsWith('/storage/kv/namespaces'))return Response.json({success:true,result:options.method==='POST'?{id:'test-namespace'}:[]});
  if(path.endsWith('/r2/buckets'))return Response.json({success:true,result:{buckets:[]}});
  if(path.endsWith('/bot/info'))return Response.json({displayName:'Test Bot'});
  if(path.endsWith('/snapshot'))return new Response(jpeg,{headers:{'content-type':'image/jpeg'}});
  if(path==='/health')return Response.json({ok:true,service:'unifi-line-kit',version:'1.1.0'});
  throw Error('unexpected upstream '+path);
 }});
 await ops.deploy(c,s);const saved=await store.load();assert.equal(saved.config.origin,'https://door-demo.example.workers.dev');
 const state=JSON.parse(await readFile(join(root,'.private/state.json'),'utf8'));assert.equal(state.owned,true);assert.equal(state.kvId,'test-namespace');assert.equal(state.lifecycle,true);
 assert.deepEqual(commands,['r2','deploy','secret']);
});
test('shared live test records image verification but does not claim handset receipt',async t=>{
 const root=await fixture(t);const c={...config,origin:'https://door-demo.example.workers.dev'};
 const ops=createOperations(root,{log:()=>{},fetch:async(url,options)=>{
  if(String(url).endsWith('/status'))return Response.json({ok:true,paired:true});
  if(String(url).endsWith('/test')){assert.equal(options.method,'POST');return Response.json({ok:true,images:[c.origin+'/image/test.jpg']});}
  if(String(url).endsWith('/image/test.jpg'))return new Response(new Uint8Array(2048),{headers:{'content-type':'image/jpeg'}});
  throw Error('unexpected upstream');
 }});
 const result=await ops.liveTest(c,secrets);assert.equal(result.accepted,true);assert.equal(result.images,1);assert.equal(result.received,undefined);
 assert.equal(JSON.parse(await readFile(join(root,'.private/test-result.json'),'utf8')).images,1);
});
test('image verification failure preserves LINE acceptance to avoid accidental resend',async t=>{
 const root=await fixture(t),c={...config,origin:'https://door-demo.example.workers.dev'};
 const ops=createOperations(root,{log:()=>{},fetch:async url=>{
  if(String(url).endsWith('/status'))return Response.json({ok:true,paired:true});
  if(String(url).endsWith('/test'))return Response.json({ok:true,images:[c.origin+'/image/test.jpg']});
  return new Response('unavailable',{status:503});
 }});
 await assert.rejects(ops.liveTest(c,secrets),err=>err.delivery==='accepted' && /LINE API 已接受/.test(err.message));
});
