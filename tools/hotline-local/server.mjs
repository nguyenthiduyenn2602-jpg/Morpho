// Local verification server only. Never expose this development server publicly.
import http from 'node:http';
import {readFile,writeFile,mkdir,readdir,rename,rm} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
const port=Number(process.env.PORT||5187), origin=`http://127.0.0.1:${port}`;
const root=resolve(process.env.HOTLINE_DATA_DIR||'.hotline-local-data');
const password=process.env.HOTLINE_ADMIN_PASSWORD;
if(!password||password.length<16) throw Error('Set HOTLINE_ADMIN_PASSWORD (16+ characters)');
await mkdir(root,{recursive:true});
const sessions=new Map(); let attempts=[]; let uploads=0;
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const equal=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
function isImage(b,t){return t==='image/png'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):t==='image/jpeg'?b[0]===255&&b[1]===216&&b[2]===255:t==='image/webp'&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP';}
async function route(req){
 const url=new URL(req.url),path=url.pathname;
 const from=req.headers.get('origin');
 if(from&&!['http://127.0.0.1:5186',origin].includes(from)) return json({error:'来源不允许'},403);
 if(req.method==='OPTIONS') return new Response(null,{status:204});
 if(path==='/admin'&&req.method==='GET') return new Response(await readFile(join(dirname(fileURLToPath(import.meta.url)),'admin.html')),{headers:{'Content-Type':'text/html; charset=utf-8'}});
 if(path==='/api/login'&&req.method==='POST'){
  attempts=attempts.filter(x=>Date.now()-x<60000); if(attempts.length>=10)fail('请稍后再试',429);attempts.push(Date.now());
  const b=await req.json();if(!equal(String(b.password||''),password))fail('口令不正确',401);
  const token=randomBytes(32).toString('hex');sessions.set(token,Date.now()+3600000);
  const r=json({ok:true});r.headers.set('Set-Cookie',`hotline_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);return r;
 }
 if(path.startsWith('/api/admin')){
  const token=/hotline_session=([a-f0-9]+)/.exec(req.headers.get('cookie')||'')?.[1];
  if(!token||!(sessions.get(token)>Date.now()))fail('请先登录',401);
  if(path==='/api/admin/logout'&&req.method==='POST'){sessions.delete(token);const r=json({ok:true});r.headers.set('Set-Cookie','hotline_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return r;}
  if(path==='/api/admin/letters'&&req.method==='GET'){
   const names=(await readdir(root)).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n));
   const rows=await Promise.all(names.map(n=>readFile(join(root,n),'utf8').then(JSON.parse)));
   return json(rows.sort((a,b)=>b.created.localeCompare(a.created)));
  }
  const mark=/^\/api\/admin\/letters\/([a-f0-9-]{36})\/read$/.exec(path);
  if(mark&&req.method==='POST'){const p=join(root,mark[1]+'.json');const row=JSON.parse(await readFile(p,'utf8'));row.read=true;const tmp=p+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(row));await rename(tmp,p);return json({ok:true});}
 }
 if(path==='/api/submissions'&&req.method==='POST'){
  if(uploads>=2)fail('正在处理其他投稿，请稍后重试',429);uploads++;
  let id,committed=false;
  try{
   const f=await req.formData(); const data={};
   for(const [key,max,required] of [['title',80,true],['story',6000,true],['question',1000,false],['email',254,false],['gender',30,true],['occupation',80,true]]){const v=f.get(key);if(typeof v!=='string'||v.length>max||(required&&!v.trim()))fail('请检查填写内容');data[key]=v.trim();}
   const age=Number(f.get('age'));if(!Number.isInteger(age)||age<1||age>120)fail('请检查年龄');data.age=age;
   if(data.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))fail('邮箱格式不正确');
   if(f.get('consent')!=='yes')fail('请先阅读并确认投稿说明');
   if([...f.values()].some(v=>typeof v!=='string')||f.has('images'))fail('第一版仅接收文字，不支持附件');
   const images=[];
   id=randomUUID();await mkdir(join(root,id));
   for(let i=0;i<images.length;i++)await writeFile(join(root,id,String(i)),images[i].bytes);
   const row={id,created:new Date().toISOString(),read:false,...data,consentVersion:'2026-11-02',images:images.map(p=>({type:p.type}))};
   await writeFile(join(root,id+'.tmp'),JSON.stringify(row));await rename(join(root,id+'.tmp'),join(root,id+'.json'));committed=true;
   return json({id,created:row.created},201);
  }finally{uploads--;if(id&&!committed){await rm(join(root,id),{recursive:true,force:true});await rm(join(root,id+'.tmp'),{force:true});}}
 }
 return json({error:'不存在'},404);
}
const server=http.createServer(async (req,res)=>{
 try{
  if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403);res.end();return;}
  const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>64*1024)fail('投稿总大小超过限制',413);parts.push(part);}
  const r=new Request(origin+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(parts)}:{})});
  let out;try{out=await route(r);}catch(e){out=json({error:e.status?e.message:'保存或读取失败，请重试'},e.status||500);}
  out.headers.set('Cache-Control','no-store');out.headers.set('X-Content-Type-Options','nosniff');out.headers.set('Referrer-Policy','no-referrer');
  if(req.headers.origin==='http://127.0.0.1:5186'){out.headers.set('Access-Control-Allow-Origin',req.headers.origin);out.headers.set('Access-Control-Allow-Methods','POST, OPTIONS');out.headers.set('Access-Control-Allow-Headers','Content-Type');}
  res.writeHead(out.status,Object.fromEntries(out.headers));res.end(Buffer.from(await out.arrayBuffer()));
 }catch(e){res.writeHead(e.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.status?e.message:'请求失败'}));}
});
server.requestTimeout=30000;server.listen(port,'127.0.0.1',()=>console.log(`Local hotline: ${origin}/admin`));
