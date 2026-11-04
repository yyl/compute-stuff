import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { runtime, environment, post } from './helpers.mjs';
import { cleanup, backup } from '../maintenance/worker.js';
import { portableExport, digest } from '../lib/comments/common.js';
import { toRemark42 } from '../scripts/export-remark42.mjs';
let mf,db,bucket;
before(async()=>({mf,db,bucket}=await runtime()));after(async()=>{await mf?.dispose();});
test('retention removes old private data and preserves approved comments',async()=>{
  const now=1800000000;
  await db.prepare('UPDATE comment_settings SET accepting=1 WHERE id=1').run();
  await db.prepare('INSERT INTO comment_posts(id,url,title) VALUES(?,?,?)').bind(post.id,post.url,post.title).run();
  for(const [id,status,age] of [['approved','approved',8000000],['pending','pending',8000000],['spam','spam',700000],['rejected','rejected',700000],['recent','pending',100]]) {
    await db.prepare('INSERT INTO comments(id,post_id,author,body,created_at,moderated_at,status) VALUES(?,?,?,?,?,?,?)').bind(id,post.id,'Reader',id,now-age,now-age,status).run();
  }
  await db.prepare('INSERT INTO comment_admissions VALUES(?,?,?,?,?,?,?)').bind('old','c',post.id,'hash','p','b',now-180000).run();
  await cleanup(environment(db),now);
  assert.deepEqual((await db.prepare('SELECT id FROM comments ORDER BY id').all()).results.map(c=>c.id),['approved','recent']);
  assert.equal((await db.prepare('SELECT last_cleanup FROM comment_settings').first()).last_cleanup,now);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM comment_admissions').first()).n,0);
});
test('backup records success only after a complete private object; excludes transient tables',async()=>{
  const env=environment(db,{COMMENTS_BACKUPS:bucket,CF_ACCOUNT_ID:'a'.repeat(32),COMMENTS_DATABASE_ID:'b'.repeat(8)+'-bbbb-bbbb-bbbb-bbbbbbbbbbbb',D1_EXPORT_TOKEN:'private-test-token'});
  const sql='CREATE TABLE comments(id TEXT);\nINSERT INTO comments VALUES (\'preserved\');\n';let calls=0;
  const fetcher=async(url,options)=>{
    if(String(url).includes('api.cloudflare.com')) {
      const request=JSON.parse(options.body);if(calls++===0) {assert.ok(!request.dump_options.tables.includes('comment_admissions'));return Response.json({success:true,result:{status:'active',at_bookmark:'bookmark'}});}
      assert.equal(request.current_bookmark,'bookmark');return Response.json({success:true,result:{status:'complete',at_bookmark:'bookmark',result:{signed_url:'https://download.example.test/backup'}}});
    }
    return new Response(sql);
  };
  const output=await backup(env,1800000000,fetcher,async()=>{});const object=await bucket.get(output.key);
  assert.equal(await object.text(),sql);assert.equal(object.customMetadata.sha256,await digest(sql));
  const old=(await db.prepare('SELECT last_backup FROM comment_settings').first()).last_backup;
  await assert.rejects(backup({...env,COMMENTS_BACKUPS:{put:async()=>{throw new Error('upload failed');}}},1800086400,fetcher,async()=>{}));
  assert.equal((await db.prepare('SELECT last_backup FROM comment_settings').first()).last_backup,old);
});
test('portable export preserves Unicode, time, safe text, unique guest identities and only approved comments',()=>{
  const comments=[{id:'one',post_id:post.id,author:'同じ名前',body:'<script>alert(1)</script>\nこんにちは',created_at:1700000000,status:'approved'},
    {id:'two',post_id:post.id,author:'同じ名前',body:'second',created_at:1700000001,status:'approved'},
    {id:'hidden',post_id:post.id,author:'spam',body:'private',created_at:1700000002,status:'pending'}];
  const lines=toRemark42(portableExport([post],comments),'blog').trim().split('\n').map(JSON.parse);
  assert.equal(lines.length,3);assert.equal(lines[0].version,1);assert.notEqual(lines[1].user.id,lines[2].user.id);
  assert.equal(lines[1].orig,comments[0].body);assert.match(lines[1].text,/&lt;script&gt;/);assert.ok(!lines[1].text.includes('<script>'));
  assert.equal(lines[1].time,'2023-11-14T22:13:20.000Z');assert.equal(lines[1].locator.url,post.url);assert.equal(lines[1].user.admin,false);
});
