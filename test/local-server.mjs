// Local-only harness. Production Functions never import this module.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import { runtime, environment } from './helpers.mjs';
import { onRequestGet, submit } from '../functions/api/comments.js';
import { onRequestGet as adminGet, onRequestPost as adminPost } from '../functions/api/admin/comments.js';
import { onRequest as adminPage } from '../functions/admin/comments/[[path]].js';
import { api } from '../lib/comments/common.js';

const bootstrap = `
window.turnstile={
  render:function(selector,options){window.__localChallenge=options;document.querySelector(selector).textContent='Local demo: spam check simulated.';setTimeout(()=>options.callback('local-demo-token'),10);return 0},
  reset:function(){setTimeout(()=>window.__localChallenge.callback('local-demo-token'),10)}
};
document.addEventListener('DOMContentLoaded',function(){
  var notice=document.createElement('aside');notice.className='local-comments-notice';
  notice.append(document.createTextNode('Local demo · comments reset when the server stops · '));
  var admin=document.createElement('a');admin.href='/__local/comments-login';admin.textContent='Open moderation';notice.append(admin);document.body.prepend(notice);
});`;

export async function startLocalServer({ port = 0 } = {}) {
  const { mf, db } = await runtime(); const originalFetch = globalThis.fetch;
  let server, base, env;
  try {
    const root = resolve('build');
    const manifest = JSON.parse(await readFile(resolve(root, 'comments-posts.json'), 'utf8'));
    async function asset(input) {
      const url = new URL(typeof input === 'string' ? input : input.url); let path;
      try { path = decodeURIComponent(url.pathname); } catch { return new Response('Invalid path', { status: 400 }); }
      const filename = resolve(root, '.' + (path.endsWith('/') ? path + 'index.html' : path));
      if (!filename.startsWith(root + '/')) return new Response('Not found', { status: 404 });
      try {
        const bytes = await readFile(filename); const extension = extname(filename);
        const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }[extension] || 'application/octet-stream';
        let body = bytes;
        if (extension === '.html') {
          // Keep generated navigation local without editing the Hugo output.
          const productionOrigin = new URL(manifest.posts[0].url).origin;
          body = bytes.toString('utf8').replaceAll(productionOrigin + '/', base + '/')
            .replace('</head>', '<script src="/__local/comments-bootstrap.js"></script><link rel="stylesheet" href="/__local/comments-demo.css"></head>');
        }
        return new Response(body, { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
      } catch { return new Response('Not found', { status: 404 }); }
    }
    const keys = await generateKeyPair('RS256', { extractable: true });
    const jwk = await exportJWK(keys.publicKey); jwk.kid = 'local-key'; jwk.alg = 'RS256';
    const issuer = `https://local-${crypto.randomUUID()}.cloudflareaccess.com`;
    globalThis.fetch = async (url, options) => String(url) === issuer + '/cdn-cgi/access/certs'
      ? Response.json({ keys: [jwk] }) : originalFetch(url, options);
    server = createServer(async (req, res) => {
      try {
        if (req.headers.host !== new URL(base).host) { res.writeHead(403); res.end('Local requests only'); return; }
        const url = new URL(req.url, base); let response;
        if (url.pathname === '/__local/comments-bootstrap.js') response = new Response(bootstrap, { headers: { 'Content-Type': 'text/javascript' } });
        else if (url.pathname === '/__local/comments-demo.css') response = new Response('.local-comments-notice{padding:.7rem 1rem;border-bottom:1px solid #8886;background:Canvas;color:CanvasText;font:14px/1.6 system-ui;text-align:center}.local-comments-notice a{color:inherit;text-decoration:underline}', { headers: { 'Content-Type': 'text/css' } });
        else if (url.pathname === '/__local/comments-login' && req.method === 'GET') {
          const jwt = await new SignJWT({ email: env.COMMENTS_ADMIN_EMAIL }).setProtectedHeader({ alg: 'RS256', kid: 'local-key' })
            .setIssuer(issuer).setAudience(env.ACCESS_AUD).setSubject('local-owner').setIssuedAt().setExpirationTime('8h').sign(keys.privateKey);
          response = new Response(null, { status: 303, headers: { Location: '/admin/comments/',
            'Set-Cookie': `CF_Authorization=${jwt}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`, 'Cache-Control': 'no-store' } });
        } else {
          let body;
          if (!['GET', 'HEAD'].includes(req.method)) {
            const chunks = []; let size = 0;
            for await (const chunk of req) { size += chunk.length; if (size > 16384) break; chunks.push(chunk); }
            if (size > 16384) { res.writeHead(413); res.end('Request too large'); return; }
            body = Buffer.concat(chunks);
          }
          const request = new Request(url, { method: req.method, headers: { ...req.headers, 'CF-Connecting-IP': '127.0.0.1' }, ...(body ? { body } : {}) });
          const context = { env, request };
          if (url.pathname === '/api/comments') response = req.method === 'POST'
            ? await api(c => submit(c, async () => Response.json({ success: true, hostname: '127.0.0.1', action: 'comment' })))(context)
            : await onRequestGet(context);
          else if (url.pathname === '/api/admin/comments') response = await (req.method === 'POST' ? adminPost : adminGet)(context);
          else if (url.pathname.startsWith('/admin/comments/')) response = await adminPage(context);
          else response = await asset(url.href);
        }
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
      } catch { res.writeHead(500); res.end('Local test server error'); }
    });
    await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
    base = `http://127.0.0.1:${server.address().port}`;
    env = environment(db, { COMMENTS_ORIGIN: base, ACCESS_ISSUER: issuer, COMMENTS_HASH_SECRET: crypto.randomUUID(),
      ASSETS: { fetch: async input => new URL(typeof input === 'string' ? input : input.url).pathname === '/comments-posts.json'
        ? Response.json({ ...manifest, posts: manifest.posts.map(post => ({ ...post, url: base + new URL(post.url).pathname })) }) : asset(input) } });
    await db.prepare('UPDATE comment_settings SET accepting=1 WHERE id=1').run();
    return { base, db, async close() {
      await new Promise(done => server.close(done)); globalThis.fetch = originalFetch; await mf.dispose();
    } };
  } catch (error) {
    if (server?.listening) await new Promise(done => server.close(done));
    globalThis.fetch = originalFetch; await mf.dispose(); throw error;
  }
}
