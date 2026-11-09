import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const root=await mkdtemp(join(tmpdir(),'hotline-check-')), password=randomBytes(24).toString('hex'),base='http://127.0.0.1:5191';let child;
async function start(){child=spawn(process.execPath,[new URL('./server.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],{env:{...process.env,PORT:'5191',HOTLINE_DATA_DIR:root,HOTLINE_ADMIN_PASSWORD:password},stdio:['ignore','pipe','inherit']});await new Promise((ok,no)=>{child.stdout.once('data',ok);child.once('error',no);child.once('exit',()=>no(Error('Server exited')));});}
async function stop(){const c=child;if(c.exitCode===null){await new Promise(ok=>{c.once('exit',ok);c.kill();});}}
async function login(){const r=await fetch(base+'/api/login',{method:'POST',body:JSON.stringify({password})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
function form(){const f=new FormData();for(const [k,v]of Object.entries({title:'测试投稿 <script>不会执行</script>',story:'虚构内容，仅验证保存',age:'25',gender:'女',occupation:'学生',email:'',question:'',consent:'yes'}))f.set(k,v);return f;}
try{await start();assert.equal((await fetch(base+'/api/admin/letters')).status,401);
assert.equal((await fetch(base+'/api/submissions',{method:'POST',headers:{Origin:'https://evil.example'},body:form()})).status,403);
const invalid=form();invalid.set('age','121');assert.equal((await fetch(base+'/api/submissions',{method:'POST',body:invalid})).status,400);
const bad=form();bad.set('images',new Blob(['not image'],{type:'image/png'}),'bad.png');assert.equal((await fetch(base+'/api/submissions',{method:'POST',body:bad})).status,400);
const noconsent=form();noconsent.set('consent','no');assert.equal((await fetch(base+'/api/submissions',{method:'POST',body:noconsent})).status,400);
const response=await fetch(base+'/api/submissions',{method:'POST',headers:{Origin:'http://127.0.0.1:5186'},body:form()});assert.equal(response.status,201);assert.equal(response.headers.get('access-control-allow-origin'),'http://127.0.0.1:5186');const {id}=await response.json();
assert.equal((await fetch(base+`/api/admin/images/${id}/0`)).status,401);
let cookie=await login();let rows=await (await fetch(base+'/api/admin/letters',{headers:{Cookie:cookie}})).json();assert.equal(rows.length,1);assert.equal(rows[0].age,25);assert.equal(rows[0].story,'虚构内容，仅验证保存');
await fetch(base+`/api/admin/letters/${id}/read`,{method:'POST',headers:{Cookie:cookie}});await stop();await start();assert.equal((await fetch(base+'/api/admin/letters',{headers:{Cookie:cookie}})).status,401);cookie=await login();rows=await (await fetch(base+'/api/admin/letters',{headers:{Cookie:cookie}})).json();assert.equal(rows.length,1);assert.equal(rows[0].read,true);
await fetch(base+'/api/admin/logout',{method:'POST',headers:{Cookie:cookie}});assert.equal((await fetch(base+'/api/admin/letters',{headers:{Cookie:cookie}})).status,401);
console.log('PASS: submission + attachment rejection + validation + origin restriction + authentication + logout + persistence after restart');
}finally{await stop();await rm(root,{recursive:true,force:true});}
