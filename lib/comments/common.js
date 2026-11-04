export class HttpError extends Error {
  constructor(status, message, headers = {}) { super(message); this.status = status; this.headers = headers; }
}
export const nowSeconds = () => Math.floor(Date.now() / 1000);
export const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...extra },
});
export function api(handler) {
  return async context => {
    try { return await handler(context); }
    catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status, error.headers);
      // Do not log bodies, IPs, auth tokens, or database exception parameters.
      console.error('comments_request_failed');
      return json({ error: 'Comments are temporarily unavailable. Please try again later.' }, 503);
    }
  };
}
export function database(env) {
  if (!env.COMMENTS_DB) throw new HttpError(503, 'Comments are not configured yet.');
  // All writes and admission reads go to the primary, including when read replicas exist.
  return env.COMMENTS_DB.withSession ? env.COMMENTS_DB.withSession('first-primary') : env.COMMENTS_DB;
}
export function requireOrigin(request, env) {
  const expected = new URL(env.COMMENTS_ORIGIN || 'https://www.mildlyjournaling.com').origin;
  if (new URL(request.url).origin !== expected || request.headers.get('Origin') !== expected)
    throw new HttpError(403, 'This request must come from the blog.');
}
export async function readJSON(request, limit = 16384) {
  if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json'))
    throw new HttpError(415, 'Send JSON.');
  if (Number(request.headers.get('Content-Length')) > limit) throw new HttpError(413, 'The request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Missing request body.');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new HttpError(413, 'The request is too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new HttpError(400, 'Invalid JSON object.'); }
}
export function text(value, max, fallback = '') {
  if (value === undefined || value === null) value = fallback;
  if (typeof value !== 'string') throw new HttpError(400, 'Invalid text field.');
  value = value.trim().replace(/\r\n?/g, '\n');
  if ([...value].length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value))
    throw new HttpError(400, `Text must be at most ${max} characters with no control characters.`);
  return value;
}
export async function digest(value, secret) {
  const bytes = new TextEncoder().encode(value);
  const hash = secret ? await crypto.subtle.sign('HMAC',
    await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), bytes)
    : await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function manifest(env) {
  if (!env.ASSETS) throw new HttpError(503, 'Post registry is unavailable.');
  const response = await env.ASSETS.fetch('https://assets.invalid/comments-posts.json');
  if (!response.ok) throw new HttpError(503, 'Post registry is unavailable.');
  const data = await response.json();
  if (!Array.isArray(data.posts)) throw new Error('invalid_manifest');
  const ids = new Set();
  for (const post of data.posts) {
    if (!post.id || ids.has(post.id)) throw new Error('duplicate_comment_identity');
    ids.add(post.id);
  }
  return data;
}
export async function findPost(env, id) {
  if (typeof id !== 'string' || id.length > 300) throw new HttpError(400, 'Invalid post.');
  const post = (await manifest(env)).posts.find(p => p.id === id);
  if (!post) throw new HttpError(404, 'Comments are not enabled on this post.');
  const url = new URL(post.url);
  if (url.origin !== new URL(env.COMMENTS_ORIGIN || 'https://www.mildlyjournaling.com').origin) throw new Error('invalid_post_origin');
  return post;
}
export function postUpsert(db, post) {
  return db.prepare(`INSERT INTO comment_posts (id, url, title, aliases) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET url=excluded.url, title=excluded.title,
    aliases=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(comment_posts.aliases)
      UNION SELECT value FROM json_each(excluded.aliases) UNION SELECT comment_posts.url WHERE comment_posts.url != excluded.url))`)
    .bind(post.id, post.url, post.title, JSON.stringify(post.aliases || []));
}
export function ready(env) {
  return env.COMMENTS_ENABLED === 'true' && !!env.TURNSTILE_SITE_KEY && !!env.TURNSTILE_SECRET_KEY
    && !!env.COMMENTS_HASH_SECRET && env.COMMENTS_HASH_SECRET.length >= 32 && !!env.COMMENTS_CONTACT
    && !!env.COMMENTS_ADMIN_EMAIL && !!env.ACCESS_ISSUER && !!env.ACCESS_AUD;
}
export function portableExport(posts, comments) {
  return { format: 'mildly-journaling-comments', version: 1, exported_at: new Date().toISOString(), posts, comments };
}
