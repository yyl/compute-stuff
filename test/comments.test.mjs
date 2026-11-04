import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runtime, environment, guestRequest, challengeOK, post, origin } from './helpers.mjs';
import { submit, onRequestGet, onRequestPost } from '../functions/api/comments.js';
import { api } from '../lib/comments/common.js';
let mf, db;
before(async () => ({ mf, db } = await runtime()));
after(async () => { await mf?.dispose(); });
beforeEach(async () => {
  await db.batch(['DELETE FROM comment_admissions', 'DELETE FROM comments', 'DELETE FROM comment_posts', 'DELETE FROM comment_events',
    'UPDATE comment_settings SET accepting=1,daily_limit=100,pending_limit=200,source_window_limit=3,source_daily_limit=10 WHERE id=1'].map(q => db.prepare(q)));
});
async function send(env = environment(db), request = guestRequest(), verifier = challengeOK) { return api(context => submit(context, verifier))({ env, request }); }
test('creates pending comments and exposes only approved display fields', async () => {
  assert.equal((await send()).status, 202);
  const row = await db.prepare('SELECT * FROM comments').first(); assert.equal(row.status, 'pending'); assert.equal(row.is_owner, 0);
  const request = new Request(origin + '/api/comments?post=' + encodeURIComponent(post.id));
  let response = await onRequestGet({ env: environment(db), request }); assert.deepEqual((await response.json()).comments, []);
  await db.prepare("UPDATE comments SET status='approved'").run();
  response = await onRequestGet({ env: environment(db), request }); const data = await response.json();
  assert.deepEqual(Object.keys(data.comments[0]).sort(), ['author','body','created_at','id','is_owner']);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});
test('same submission is idempotent, even if approval occurred after a lost response', async () => {
  const id = crypto.randomUUID(); assert.equal((await send(undefined, guestRequest({ request_id: id }))).status, 202);
  assert.equal((await send(undefined, guestRequest({ request_id: id, turnstile_token: '' }), () => { throw new Error('must not revalidate'); })).status, 202);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM comments').first()).n, 1);
  assert.equal((await send(undefined, guestRequest({ request_id: id, body: 'changed' }))).status, 409);
});
test('rejects untrusted fields, unknown posts, controls, oversized bodies and invalid origins', async () => {
  for (const patch of [{ status: 'approved' }, { is_owner: 1 }, { parent_id: 'x' }, { post: '/missing/' }, { body: '\u0000' }])
    assert.ok((await send(undefined, guestRequest(patch))).status >= 400);
  const wrong = guestRequest(); wrong.headers.set('Origin', 'https://evil.test'); assert.equal((await send(undefined, wrong)).status, 403);
  assert.equal((await send(undefined, guestRequest({ body: 'x'.repeat(17000) }))).status, 413);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM comments').first()).n, 0);
});
test('challenge failure, wrong action and verifier outages fail closed', async () => {
  for (const value of [{success:false}, {success:true,hostname:'evil.test',action:'comment'}, {success:true,hostname:new URL(origin).hostname,action:'wrong'}])
    assert.equal((await send(undefined, guestRequest(), async () => Response.json(value))).status, 400);
  assert.equal((await send(undefined, guestRequest(), async () => { throw new Error('offline'); })).status, 503);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM comments').first()).n, 0);
});
test('runtime pause and incomplete deployment cannot accept comments', async () => {
  assert.equal((await send(environment(db, { COMMENTS_ENABLED: 'false' }))).status, 503);
  assert.equal((await send(environment(db, { COMMENTS_ADMIN_EMAIL: '' }))).status, 503);
  await db.prepare('UPDATE comment_settings SET accepting=0 WHERE id=1').run(); assert.equal((await send()).status, 503);
});
test('database-backed global cap holds under simultaneous requests and rolls back failures', async () => {
  await db.prepare('UPDATE comment_settings SET daily_limit=5 WHERE id=1').run();
  const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => send(undefined, guestRequest({ body: `comment ${i}` }, `192.0.2.${i}`))));
  assert.equal(responses.filter(r => r.status === 202).length, 5);
  assert.equal(responses.filter(r => r.status === 429).length, 15);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM comments').first()).n, 5);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM comment_admissions').first()).n, 5);
});
test('queue limit, source limit and duplicates are enforced; deleting spam does not replenish day allowance', async () => {
  const responses = [];
  for (let i=0;i<4;i++) responses.push(await send(undefined, guestRequest({body:`content ${i}`})));
  assert.deepEqual(responses.map(r=>r.status),[202,202,202,429]);
  assert.equal((await send(undefined, guestRequest({body:'content 0'}))).status,429);
  await db.prepare('DELETE FROM comments').run(); assert.equal((await send()).status,429);
  await db.prepare('DELETE FROM comment_admissions').run();
  assert.equal((await send()).status,202); assert.equal((await send()).status,409);
  await db.prepare('UPDATE comment_settings SET pending_limit=1 WHERE id=1').run();
  assert.equal((await send(undefined, guestRequest({body:'another'},'192.0.2.99'))).status,429);
});
test('paused post cannot accept and its persistent key retains canonical URL aliases', async () => {
  assert.equal((await send()).status,202);
  await db.prepare('UPDATE comment_posts SET accepting=0').run();
  assert.equal((await send(undefined,guestRequest({body:'second'}))).status,503);
  await db.prepare('UPDATE comment_posts SET accepting=1').run();
  const changed={...post,url:origin+'/posts/new-title/'};
  const env=environment(db,{ASSETS:{fetch:async()=>Response.json({posts:[changed]})}});
  assert.equal((await send(env,guestRequest({body:'after rename'},'192.0.2.5'))).status,202);
  const saved=await db.prepare('SELECT * FROM comment_posts').first();
  assert.equal(saved.url,changed.url); assert.deepEqual(JSON.parse(saved.aliases),[post.url]);
});
test('public function fails safely without a database and does not expose exception details', async () => {
  const response = await onRequestPost({env:environment(undefined),request:guestRequest()});
  assert.equal(response.status,503); assert.match((await response.json()).error,/configured/);
});
