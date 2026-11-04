import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, exportJWK } from 'jose';
import { runtime, environment, origin, post, guestRequest, challengeOK } from './helpers.mjs';
import { verifyAdmin } from '../lib/comments/auth.js';
import { api } from '../lib/comments/common.js';
import { adminGet, adminPost } from '../lib/comments/admin.js';
import { submit } from '../functions/api/comments.js';
let mf, db, keys, env, originalFetch;
before(async () => {
  ({ mf, db } = await runtime()); env = environment(db); keys = await generateKeyPair('RS256', { extractable: true });
  const jwk = await exportJWK(keys.publicKey); jwk.kid = 'test-key'; jwk.alg = 'RS256';
  originalFetch = globalThis.fetch; globalThis.fetch = async url => {
    assert.equal(String(url), env.ACCESS_ISSUER + '/cdn-cgi/access/certs'); return Response.json({keys:[jwk]});
  };
});
after(async () => { globalThis.fetch = originalFetch; await mf?.dispose(); });
beforeEach(async () => { await db.batch(['DELETE FROM comment_admissions','DELETE FROM comments','DELETE FROM comment_posts','DELETE FROM comment_events','UPDATE comment_settings SET accepting=1 WHERE id=1'].map(q=>db.prepare(q))); });
async function token(email='owner@example.test', audience='test-audience', expiry='5m') {
  return new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setIssuer(env.ACCESS_ISSUER)
    .setSubject('owner-sub').setAudience(audience).setIssuedAt().setExpirationTime(expiry).sign(keys.privateKey);
}
async function request(data, changes={}) {
  return new Request(origin+'/api/admin/comments', {method:'POST',headers:{Origin:origin,'Content-Type':'application/json',
    'Cf-Access-Jwt-Assertion':await token(),'X-Comments-Admin':'1',...changes},body:JSON.stringify(data)});
}
test('admin JWT validation rejects missing, forged, expired, wrong-audience and non-owner tokens',async()=>{
  for (const jwt of ['', 'forged', await token('other@example.test'), await token(undefined,'wrong'), await token(undefined,undefined,'-1m')]) {
    await assert.rejects(verifyAdmin(new Request(origin,{headers:{'Cf-Access-Jwt-Assertion':jwt}}),env),e=>e.status===403);
  }
  assert.equal(await verifyAdmin(new Request(origin,{headers:{'Cf-Access-Jwt-Assertion':await token()}}),env),'owner@example.test');
});
test('admin APIs cannot be accessed by header forgery, missing config, or CSRF',async()=>{
  assert.equal((await api(adminGet)({env,request:new Request(origin+'/api/admin/comments',{headers:{'Cf-Access-Authenticated-User-Email':'owner@example.test'}})})).status,403);
  assert.equal((await api(adminGet)({env:{...env,COMMENTS_ADMIN_EMAIL:''},request:new Request(origin+'/api/admin/comments')})).status,503);
  const response=await api(adminPost)({env,request:await request({action:'settings',accepting:true},{Origin:'https://evil.test'})});assert.equal(response.status,403);
  assert.equal((await api(adminPost)({env,request:await request({action:'settings',accepting:true},{'X-Comments-Admin':''})})).status,403);
});
test('owner can approve, export, pause, post with a badge, and delete with an audit trail',async()=>{
  await submit({env,request:guestRequest()},challengeOK); const comment=await db.prepare('SELECT id FROM comments').first();
  async function act(data) { const response=await api(adminPost)({env,request:await request(data)});assert.equal(response.status,200,await response.text()); }
  await act({action:'approve',ids:[comment.id]});
  await act({action:'owner',post:post.id,body:'Thanks for reading!'});
  const exportRequest=new Request(origin+'/api/admin/comments?export=1',{headers:{'Cf-Access-Jwt-Assertion':await token()}});
  const exported=await (await api(adminGet)({env,request:exportRequest})).json();assert.equal(exported.comments.length,2);
  assert.equal(exported.comments.find(c=>c.is_owner).body,'Thanks for reading!');
  await act({action:'settings',accepting:false});assert.equal((await db.prepare('SELECT accepting FROM comment_settings').first()).accepting,0);
  await act({action:'delete',ids:[comment.id]});assert.equal(await db.prepare('SELECT id FROM comments WHERE id=?').bind(comment.id).first(),null);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM comment_events WHERE action='delete'").first()).n,1);
});
