import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';

// Runtime syntax supports multi-statement migrations, including SQLite triggers.
// D1 exec expects one complete statement per line, so use a parser for this fixed
// migration rather than splitting the trigger body at its internal semicolons.
export function migrationStatements(sql) {
  const clean = sql.replace(/^\s*--.*$/gm, '');
  const statements = []; let buffer = '', trigger = false;
  for (const line of clean.split('\n')) {
    if (!line.trim()) continue;
    buffer += line + '\n';
    if (/^CREATE TRIGGER/i.test(buffer.trim())) trigger = true;
    if ((trigger && /^END;\s*$/.test(line)) || (!trigger && /;\s*$/.test(line))) {
      statements.push(buffer.trim()); buffer = ''; trigger = false;
    }
  }
  if (buffer.trim()) throw new Error('Unterminated migration statement');
  return statements;
}
export async function runtime() {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: '2026-07-30', d1Databases: ['COMMENTS_DB'], r2Buckets: ['COMMENTS_BACKUPS'] });
  const db = await mf.getD1Database('COMMENTS_DB');
  for (const statement of migrationStatements(await readFile('migrations/0001_comments.sql', 'utf8'))) await db.prepare(statement).run();
  return { mf, db, bucket: await mf.getR2Bucket('COMMENTS_BACKUPS') };
}
export const origin = 'https://www.mildlyjournaling.com';
export const post = { id: '/posts/hello-world/', url: origin + '/posts/hello-world/', title: 'Hello world', aliases: [] };
export function environment(db, extras = {}) {
  return { COMMENTS_DB: db, COMMENTS_ENABLED: 'true', COMMENTS_ORIGIN: origin,
    COMMENTS_HASH_SECRET: 'a-test-key-at-least-thirty-two-characters', COMMENTS_CONTACT: 'owner@example.test',
    COMMENTS_ADMIN_EMAIL: 'owner@example.test', ACCESS_ISSUER: 'https://test.cloudflareaccess.com', ACCESS_AUD: 'test-audience',
    TURNSTILE_SITE_KEY: 'test-site', TURNSTILE_SECRET_KEY: 'test-secret',
    ASSETS: { fetch: async () => Response.json({ version: 1, posts: [post] }) }, ...extras };
}
export function guestRequest(overrides = {}, ip = '192.0.2.1') {
  return new Request(origin + '/api/comments', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ post: post.id, author: 'Reader', body: 'A thoughtful comment', request_id: crypto.randomUUID(), turnstile_token: 'test-token', ...overrides }) });
}
export const challengeOK = async () => Response.json({ success: true, hostname: new URL(origin).hostname, action: 'comment' });
