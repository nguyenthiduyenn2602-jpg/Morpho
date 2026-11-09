import admin from './admin.html';
const enc = new TextEncoder();
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_BODY = 64 * 1024;
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type':'application/json'}});
const fail = (message, status = 400) => { throw Object.assign(new Error(message), {status}); };
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('');
const hash = async value => hex(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? enc.encode(value) : value));
async function hmac(secret, value) { const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name:'HMAC',hash:'SHA-256'},false,['sign']); return hex(await crypto.subtle.sign('HMAC',key,enc.encode(value))); }
function equal(a,b) { if (a.length !== b.length) return false; let d=0; for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0; }
const stmt = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
async function limited(req) {
 if(Number(req.headers.get('content-length'))>MAX_BODY)fail('投稿大小超过限制',413);
 if(!req.body)return new Uint8Array();const reader=req.body.getReader();const chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BODY){await reader.cancel();fail('投稿大小超过限制',413);}chunks.push(value);}
 const result=new Uint8Array(size);let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.length;}return result;
}
async function rate(env,key,max,seconds) {
 const window=Math.floor(Date.now()/1000/seconds);const id=`${key}:${window}`;
 const row=await stmt(env,'INSERT INTO limits (id,n,expires) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET n=n+1 RETURNING n',id,(window+2)*seconds).first();
 if(row.n>max)fail('请求过于频繁，请稍后再试',429);
}

async function authenticate(req,env){
 const token=/(?:^|; )hotline_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.get('cookie')||'')?.[1];if(!token)fail('请先登录',401);
 const digest=await hash(token);const session=await stmt(env,'SELECT id FROM sessions WHERE id=? AND expires>?',digest,Date.now()).first();if(!session)fail('登录已过期',401);return digest;
}
async function route(req,env){
 const url=new URL(req.url),path=url.pathname,origin=req.headers.get('origin');
 const local=env.LOCAL_TEST==='true'&&['127.0.0.1','localhost'].includes(url.hostname);
 if(!local&&url.protocol!=='https:')fail('需要 HTTPS',403);
 if(!env.ADMIN_SECRET||env.ADMIN_SECRET.length<32||!env.RATE_SECRET||env.RATE_SECRET.length<32)fail('服务尚未配置',503);
 const allowed=(env.ALLOWED_ORIGIN||'').split(',').map(v=>v.trim()).includes(origin)||origin===url.origin;
 if(origin&&!allowed)fail('来源不允许',403);
 if(req.method==='OPTIONS')return new Response(null,{status:204});
 if(path==='/admin'&&req.method==='GET')return new Response(admin,{headers:{'Content-Type':'text/html; charset=utf-8'}});
 const ip=req.headers.get('CF-Connecting-IP')||(local?'local':'unknown');
 const ipKey=await hmac(env.RATE_SECRET,`${Math.floor(Date.now()/86400000)}:${ip}`);
 if(req.method!=='GET'&&req.method!=='HEAD'){
  if(path==='/api/submissions'){if(!allowed)fail('来源不允许',403);await rate(env,'submit:'+ipKey,12,600);await rate(env,'global',200,86400);}
  else {if(origin!==url.origin)fail('需要同源请求',403);await rate(env,'admin:'+ipKey,30,60);}
 }
 if(path==='/api/login'&&req.method==='POST'){
  await rate(env,'login:'+ipKey,8,600);
  const bytes=await limited(req);if(bytes.length>2048)fail('请求过大');const body=JSON.parse(new TextDecoder().decode(bytes));
  if(!equal(await hash(String(body.password||'')),await hash(env.ADMIN_SECRET)))fail('口令不正确',401);
  const token=hex(crypto.getRandomValues(new Uint8Array(32)));await stmt(env,'INSERT INTO sessions(id,expires) VALUES (?,?)',await hash(token),Date.now()+3600000).run();
  const r=json({ok:true});r.headers.set('Set-Cookie',`hotline_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${local?'':'; Secure'}`);return r;
 }
 if(path.startsWith('/api/admin/')){
  const session=await authenticate(req,env);
  if(path==='/api/admin/logout'&&req.method==='POST'){await stmt(env,'DELETE FROM sessions WHERE id=?',session).run();const r=json({ok:true});r.headers.set('Set-Cookie',`hotline_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${local?'':'; Secure'}`);return r;}
  if(path==='/api/admin/letters'&&req.method==='GET'){
   const offset=Math.max(0,Math.min(100000,Number(url.searchParams.get('offset'))||0));
   const result=await stmt(env,"SELECT id,created,body,is_read FROM letters WHERE status='ready' ORDER BY created DESC,id DESC LIMIT 30 OFFSET ?",offset).all();
   return json(result.results.map(r=>({...JSON.parse(r.body),id:r.id,created:r.created,read:!!r.is_read})));
  }
  const mark=/^\/api\/admin\/letters\/([a-f0-9-]+)\/read$/.exec(path);
  if(mark&&req.method==='POST'&&UUID.test(mark[1])){await stmt(env,"UPDATE letters SET is_read=1 WHERE id=? AND status='ready'",mark[1]).run();return json({ok:true});}
 }
 if(path==='/api/submissions'&&req.method==='POST'){
  const bytes=await limited(req);const f=await new Request(req.url,{method:'POST',headers:{'Content-Type':req.headers.get('content-type')||''},body:bytes}).formData();
  const id=f.get('requestId');if(typeof id!=='string'||!UUID.test(id))fail('投稿编号无效');
  const data={};for(const [key,max,required] of [['title',80,true],['story',6000,true],['question',1000,false],['email',254,false],['gender',30,true],['occupation',80,true]]){const v=f.get(key);if(typeof v!=='string'||v.length>max||(required&&!v.trim()))fail('请检查填写内容');data[key]=v.trim();}
  data.age=Number(f.get('age'));if(!Number.isInteger(data.age)||data.age<1||data.age>120)fail('请检查年龄');
  if(data.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))fail('邮箱格式不正确');
  if(f.get('consent')!=='yes')fail('请确认投稿说明');
  if([...f.values()].some(v=>typeof v!=='string')||f.has('images'))fail('第一版仅接收文字，不支持附件');
  data.consentVersion='2026-11-06-text';
  const digest=await hash(JSON.stringify(data));
  const prior=await stmt(env,'SELECT digest,status,created FROM letters WHERE id=?',id).first();
  if(prior){if(prior.digest!==digest)fail('此编号对应不同内容，请返回修改后再提交',409);if(prior.status==='ready')return json({id,created:prior.created});if(prior.status!=='failed')fail('此投稿正在处理，请稍后重试；持续未恢复时请保留编号联系管理员',409);}
  const created=new Date().toISOString();
  const reservation=prior ? await stmt(env,"UPDATE letters SET status='pending' WHERE id=? AND status='failed'",id).run() : await stmt(env,"INSERT OR IGNORE INTO letters(id,digest,status,created,body,is_read) VALUES (?,?,'pending',?,?,0)",id,digest,created,JSON.stringify(data)).run();if(!reservation.meta.changes)fail('此投稿正在处理，请稍后重试',409);
  // A single request owns the pending reservation. Failed writes can retry without duplicating the letter.
  try {
  await stmt(env,"UPDATE letters SET status='ready' WHERE id=?",id).run();
  return json({id,created:prior?.created||created},201);
  } catch(error) {
   // Do not overwrite a ready row if the commit succeeded but its response was lost.
   await stmt(env,"UPDATE letters SET status='failed' WHERE id=? AND status='pending'",id).run();
   throw error;
  }
 }
 return json({error:'不存在'},404);
}
export default {
 async fetch(req,env){let r;try{r=await route(req,env);}catch(e){r=json({error:e.status?e.message:'服务未能确认保存，请保留内容并稍后重试'},e.status||500);}
  r.headers.set('Cache-Control','no-store');r.headers.set('X-Content-Type-Options','nosniff');r.headers.set('Referrer-Policy','no-referrer');r.headers.set('X-Frame-Options','DENY');
  if((env.ALLOWED_ORIGIN||'').split(',').map(v=>v.trim()).includes(req.headers.get('origin'))){r.headers.set('Access-Control-Allow-Origin',req.headers.get('origin'));r.headers.set('Vary','Origin');r.headers.set('Access-Control-Allow-Methods','POST, OPTIONS');r.headers.set('Access-Control-Allow-Headers','Content-Type');}
  return r;
 },
 async scheduled(event,env){await env.DB.batch([stmt(env,'DELETE FROM limits WHERE expires<?',Math.floor(Date.now()/1000)),stmt(env,'DELETE FROM sessions WHERE expires<?',Date.now())]);}
};
