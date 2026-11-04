// Full local SQL export/restore through Wrangler, using isolated scratch stores.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const stamp=Date.now().toString();const root=resolve('.cache',`restore-rehearsal-${stamp}`);await mkdir(root,{recursive:true});
const source=resolve(root,'source'),target=resolve(root,'target'),backup=resolve(root,'backup.sql');
for(const path of [source,target]) {
  await mkdir(path,{recursive:true});
  await writeFile(resolve(path,'wrangler.json'),JSON.stringify({name:'restore-rehearsal',compatibility_date:'2026-11-03',
    d1_databases:[{binding:'COMMENTS_DB',database_name:'comments-rehearsal',database_id:'00000000-0000-0000-0000-000000000000',migrations_dir:resolve('migrations')}]}));
}
async function wrangler(args){
  const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
  const code=await new Promise((r,j)=>{child.on('exit',r);child.on('error',j);});assert.equal(code,0,stderr+stdout);return stdout;
}
await wrangler(['d1','migrations','apply','COMMENTS_DB','--local','--config',resolve(source,'wrangler.json')]);
const fixture=resolve(root,'fixture.sql');await writeFile(fixture,`INSERT INTO comment_posts(id,url,title) VALUES('test','https://www.mildlyjournaling.com/posts/test/','Test');
INSERT INTO comments(id,post_id,author,body,created_at,status) VALUES('approved','test','名前','Line one\n<text>こんにちは',1700000000,'approved');
INSERT INTO comments(id,post_id,author,body,created_at,status) VALUES('pending','test','Reader','Private pending',1700000001,'pending');\n`);
await wrangler(['d1','execute','COMMENTS_DB','--local','--config',resolve(source,'wrangler.json'),'--file',fixture]);
await wrangler(['d1','export','COMMENTS_DB','--local','--config',resolve(source,'wrangler.json'),'--output',backup,
  '--table','comment_settings','--table','comment_posts','--table','comments','--table','comment_events','--table','d1_migrations']);
const sql=await readFile(backup,'utf8');assert.ok(!sql.includes('CREATE TABLE comment_admissions'));assert.ok(!sql.includes('CREATE TABLE "comment_admissions"'));
await wrangler(['d1','execute','COMMENTS_DB','--local','--config',resolve(target,'wrangler.json'),'--file',backup]);
await wrangler(['d1','execute','COMMENTS_DB','--local','--config',resolve(target,'wrangler.json'),'--file',resolve('scripts/recovery-transient.sql')]);
const result=JSON.parse(await wrangler(['d1','execute','COMMENTS_DB','--local','--config',resolve(target,'wrangler.json'),'--command','SELECT id,body,created_at,status FROM comments ORDER BY id','--json']));
assert.deepEqual(result[0].results,[{id:'approved',body:'Line one\n<text>こんにちは',created_at:1700000000,status:'approved'},
  {id:'pending',body:'Private pending',created_at:1700000001,status:'pending'}]);
console.log('SQL restore rehearsal passed: actual Wrangler export/import preserves approved and pending text, Unicode, timestamps and state; transient schema recreated.');
