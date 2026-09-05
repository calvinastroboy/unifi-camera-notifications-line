import {readFile,writeFile,mkdir,chmod,rename,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {validate} from './config.mjs';
export const SECRET_FIELDS=['CLOUDFLARE_API_TOKEN','UNIFI_API_KEY','LINE_CHANNEL_ACCESS_TOKEN','LINE_CHANNEL_SECRET','LINE_TO'];
export const exists=path=>access(path).then(()=>true,()=>false);
export const read=async path=>JSON.parse(await readFile(path,'utf8'));
export function createStore(root){
 const privateDir=resolve(root,'.private');
 async function save(path,value){
  await mkdir(privateDir,{recursive:true,mode:0o700});
  if(process.platform!=='win32')await chmod(privateDir,0o700);
  const temp=path+'.'+randomBytes(6).toString('hex')+'.tmp';
  await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  await rename(temp,path);
 }
 async function load(){return {
  config:await exists(resolve(privateDir,'customer.json'))?await read(resolve(privateDir,'customer.json')):{},
  secrets:await exists(resolve(privateDir,'secrets.json'))?await read(resolve(privateDir,'secrets.json')):{}
 };}
 async function publicSettings(){const {config,secrets}=await load();return {config,identityLocked:!!config.origin||await exists(resolve(privateDir,'state.json')),secretSet:Object.fromEntries(SECRET_FIELDS.map(k=>[k,!!secrets[k]]))};}
 async function update(input){
  if(!input || typeof input!=='object' || Array.isArray(input))throw Error('設定格式錯誤');
  const prior=await load();const incoming=input.config||{},keys=input.secrets||{};
  const allowed=['accountId','consoleId','cameraIds','delaySeconds','label'];
  for(const key of Object.keys(incoming))if(!allowed.includes(key) && key!=='name')throw Error('不允許的設定欄位');
  for(const key of Object.keys(keys))if(!SECRET_FIELDS.includes(key))throw Error('不允許的金鑰欄位');
  const config={name:'door-alert-'+randomBytes(4).toString('hex'),cameraIds:[],delaySeconds:5,label:'有人來了',...prior.config,...incoming};
  if((prior.config.origin||await exists(resolve(privateDir,'state.json'))) && config.accountId!==prior.config.accountId)throw Error('不同客戶請解壓新的套件；此資料夾已綁定帳戶');
  if(prior.config.name && config.name!==prior.config.name)throw Error('不能更改既有部署名稱');
  validate(config,{allowEmptyCameras:true});
  const secrets={...prior.secrets};
  for(const [key,value] of Object.entries(keys)){
   if(typeof value!=='string' || value.length>8192 || /\s/.test(value))throw Error(key+' 不可包含空白，請重新複製');
   if(value)secrets[key]=value;
  }
  for(const key of SECRET_FIELDS.slice(0,3))if(!secrets[key])throw Error('請填寫 '+key);
  secrets.WEBHOOK_TOKEN ||= randomBytes(32).toString('hex');
  await save(resolve(privateDir,'secrets.json'),secrets);
  await save(resolve(privateDir,'customer.json'),config);
  return publicSettings();
 }
 return {load,publicSettings,update,save,privateDir};
}
export function redact(text,secrets={}){
 let result=String(text).replace(/\x1b\[[0-9;]*[A-Za-z]/g,'');
 for(const value of Object.values(secrets).filter(v=>typeof v==='string' && v.length).sort((a,b)=>b.length-a.length))result=result.split(value).join('[已隱藏]');
 return result.replace(/([?&]token=)[^\s"'&]+/gi,'$1[已隱藏]').replace(/Bearer\s+[^\s"']+/gi,'Bearer [已隱藏]');
}
export function sanitize(value,secrets){
 if(typeof value==='string')return redact(value,secrets);
 if(Array.isArray(value))return value.map(item=>sanitize(item,secrets));
 if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,sanitize(item,secrets)]));
 return value;
}
