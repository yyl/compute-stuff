// Optional integration rehearsal with an official, checksum-verified Remark42
// binary. Usage: node test/remark42-rehearsal.mjs /path/to/remark42
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { portableExport } from '../lib/comments/common.js';
import { toRemark42 } from '../scripts/export-remark42.mjs';
const binary=process.argv[2];if(!binary)throw new Error('Provide the path to a checksum-verified Remark42 binary.');
const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
const root=await mkdtemp(join(tmpdir(),'blog-remark42-'));const base=`http://127.0.0.1:${port}`;const secret=crypto.randomUUID();const password=crypto.randomUUID();
let serverOutput='';
const server=spawn(resolve(binary),[`--url=${base}`,`--secret=${secret}`,'server','--address=127.0.0.1',`--port=${port}`,'--site=rehearsal',`--admin-passwd=${password}`,'--auth.anon'],{cwd:root,stdio:['ignore','pipe','pipe']});
server.stdout.on('data',x=>serverOutput+=x);server.stderr.on('data',x=>serverOutput+=x);
try {
  let healthy=false;for(let i=0;i<80;i++){try{const response=await fetch(base+'/ping');if(response.ok){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.ok(healthy,'Remark42 did not start');
  const post={id:'/posts/rehearsal/',url:'https://www.mildlyjournaling.com/posts/rehearsal/',title:'Migration rehearsal',accepting:1};
  const comments=[{id:'first-comment',post_id:post.id,author:'同じ名前',body:'Hello <script>test</script>\nこんにちは',created_at:1700000000,status:'approved'},
    {id:'second-comment',post_id:post.id,author:'同じ名前',body:'Second comment 🏄',created_at:1700000010,status:'approved'},
    {id:'private-comment',post_id:post.id,author:'Pending',body:'Never published',created_at:1700000020,status:'pending'}];
  const file=join(root,'fixture.jsonl');await writeFile(file,toRemark42(portableExport([post],comments),'rehearsal'),{mode:0o600});
  const restore=spawn(resolve(binary),[`--url=${base}`,`--secret=${secret}`,'restore','--site=rehearsal',`--admin-passwd=${password}`,`--file=${file}`],{cwd:root,stdio:['ignore','pipe','pipe']});
  let output='';restore.stdout.on('data',x=>output+=x);restore.stderr.on('data',x=>output+=x);
  const code=await new Promise((r,j)=>{restore.on('exit',r);restore.on('error',j);});assert.equal(code,0,output);
  // The CLI returns once the server accepts the asynchronous import (202).
  let data;
  for(let i=0;i<100;i++) {
    const response=await fetch(`${base}/api/v1/find?site=rehearsal&url=${encodeURIComponent(post.url)}&sort=time`);assert.equal(response.status,200);
    data=await response.json();if(data.comments.length===2)break;await new Promise(r=>setTimeout(r,100));
  }
  const imported=data.comments;
  assert.equal(imported.length,2,`${output}\n${JSON.stringify(data)}\n${serverOutput}`);for(const original of comments.filter(c=>c.status==='approved')) {
    const found=imported.find(c=>c.id===original.id);assert.ok(found);assert.equal(found.orig,original.body);assert.equal(found.user.name,original.author);
    assert.equal(Date.parse(found.time),original.created_at*1000);assert.equal(found.locator.url,post.url);assert.equal(found.imported,true);assert.ok(!found.text.includes('<script>'));
  }
  assert.notEqual(imported[0].user.id,imported[1].user.id);console.log('Remark42 rehearsal passed: two approved comments imported; IDs, names, Unicode, line breaks, timestamps and post URLs preserved; pending excluded and HTML escaped.');
}finally{server.kill('SIGTERM');await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));await rm(root,{recursive:true,force:true});}
