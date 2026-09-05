import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStore,redact,sanitize,exists,read} from './store.mjs';
import {createOperations} from './operations.mjs';
import {validate} from './config.mjs';
const assets=resolve(dirname(fileURLToPath(import.meta.url)),'../ui');
const files={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
const actions={doctor:'檢查連線',discover:'讀取攝影機',deploy:'部署至 Cloudflare',pair:'建立 LINE 配對碼',test:'發送測試'};
const error=(message,status=400)=>Object.assign(Error(message),{status});
async function body(req){
 if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw error('請使用 JSON',415);
 let size=0;const chunks=[];
 for await(const chunk of req){size+=chunk.length;if(size>65536)throw error('資料過大',413);chunks.push(chunk);}
 try {const data=JSON.parse(Buffer.concat(chunks).toString());if(!data||Array.isArray(data)||typeof data!=='object')throw Error();return data;}
 catch {throw error('資料格式錯誤');}
}
export async function startServer({root,port=0,operations=createOperations}={}){
 const token=randomBytes(32).toString('hex'),store=createStore(root);
 let origin,cookieName,job=null,busy=false;
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  try{
   if(req.headers.host!==new URL(origin).host)throw error('拒絕非本機來源',403);
   if(req.headers.origin && req.headers.origin!==origin)throw error('拒絕跨網站請求',403);
   const path=new URL(req.url,origin).pathname;
   if(req.method==='GET' && Object.hasOwn(files,path)){
    const [name,type]=files[path];res.writeHead(200,{'Content-Type':type});res.end(await readFile(resolve(assets,name)));return;
   }
   if(!path.startsWith('/api/'))throw error('找不到頁面',404);
   const cookie=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1);
   const supplied=req.headers.authorization||(cookie?'Bearer '+cookie:'');const expected='Bearer '+token;
   if(Buffer.byteLength(supplied)!==Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))throw error('請由啟動捷徑重新開啟網頁',401);
   if(req.method==='POST' && req.headers.origin!==origin)throw error('缺少本機來源',403);
   if(path==='/api/session' && req.method==='POST'){
    await body(req);res.setHeader('Set-Cookie',cookieName+'='+token+'; HttpOnly; SameSite=Strict; Path=/api');send({ok:true});return;
   }
   if(path==='/api/settings' && req.method==='GET'){send(await store.publicSettings());return;}
   if(path==='/api/settings' && req.method==='POST'){
    if(busy)throw error('工作進行中，完成後才能儲存',409);
    busy=true;try {send(await store.update(await body(req)));}finally{busy=false;}return;
   }
   if(path==='/api/job' && req.method==='GET'){send(job||{state:'idle'});return;}
   if(path==='/api/status' && req.method==='GET'){
    const {config,secrets}=await store.load();
    if(!config.origin){send({ok:false,notDeployed:true});return;}
    const result=await operations(root,{log:()=>{}}).authenticated(config,secrets,'/status');
    const proofPath=resolve(store.privateDir,'test-result.json');
    const proof=await exists(proofPath)?await read(proofPath):null;
    send(sanitize({...result,proof:proof?.origin===config.origin?proof:null},secrets));return;
   }
   if(path==='/api/webhooks' && req.method==='GET'){
    const {config:c,secrets:s}=await store.load();
    if(!c.origin)throw error('請先完成部署');
    const live=Date.now()<Number(s.PAIR_EXPIRES||0);
    send({unifi:c.origin+'/unifi-alarm?token='+s.WEBHOOK_TOKEN,line:c.origin+'/line',code:live?s.PAIR_CODE:null,expires:live?Number(s.PAIR_EXPIRES):null});return;
   }
   if(path==='/api/jobs' && req.method==='POST'){
    const {action}=await body(req);
    if(!Object.hasOwn(actions,action))throw error('不支援的操作');
    if(busy)throw error('請等待目前工作完成，勿重複點擊',409);
    busy=true;
    try{
     const {config:c,secrets:s}=await store.load();validate(c,{allowEmptyCameras:action==='discover'});
     job={id:randomBytes(8).toString('hex'),action,title:actions[action],state:'running',started:Date.now(),logs:[]};
     const current=job;
     const log=message=>{current.logs.push(redact(message,s).slice(0,2000));if(current.logs.length>120)current.logs.shift();};
     const ops=operations(root,{log});
     const method={pair:'beginPair',test:'liveTest'}[action]||action;
     log(actions[action]+'…');
     Promise.resolve().then(()=>ops[method](c,s)).then(result=>{
      // Pairing credentials are available only through the explicit webhook endpoint.
      current.result=action==='pair'?{paired:!!result?.paired}:sanitize(result??{},s);
      current.state='succeeded';log('此步驟完成');
     }).catch(err=>{current.state='failed';current.error=redact(err.message,s);if(['accepted','unknown'].includes(err.delivery))current.delivery=err.delivery;log(current.error);})
      .finally(()=>{current.finished=Date.now();busy=false;});
     send({id:current.id},202);return;
    }catch(err){busy=false;throw err;}
   }
   throw error('找不到操作',404);
  }catch(err){
   const {secrets}=await store.load().catch(()=>({secrets:{}}));
   if(!res.headersSent)send({error:redact(err.message,secrets)},err.status||400);else res.end();
  }
 });
 server.requestTimeout=30000;server.headersTimeout=10000;
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});
 origin='http://127.0.0.1:'+server.address().port;
 cookieName='linekit_'+server.address().port;
 return {server,origin,token};
}
