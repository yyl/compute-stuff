import { api, json, HttpError, database, requireOrigin, readJSON, text, digest,
  nowSeconds, findPost, postUpsert, ready } from '../../lib/comments/common.js';

export const onRequestGet = api(async ({ request, env }) => {
  const url = new URL(request.url); const post = await findPost(env, url.searchParams.get('post'));
  const db = database(env);
  let cursor = { time: 0, id: '' };
  if (url.searchParams.has('cursor')) {
    try {
      const raw = url.searchParams.get('cursor'); if (raw.length > 300) throw new Error();
      cursor = JSON.parse(atob(raw));
      if (!Number.isSafeInteger(cursor.time) || cursor.time < 0 || typeof cursor.id !== 'string' || cursor.id.length > 100) throw new Error();
    } catch { throw new HttpError(400, 'Invalid comment cursor.'); }
  }
  const { results } = await db.prepare(`SELECT id, author, body, created_at, is_owner FROM comments
    WHERE post_id=? AND status='approved' AND (created_at > ? OR (created_at=? AND id > ?))
    ORDER BY created_at, id LIMIT 51`).bind(post.id, cursor.time, cursor.time, cursor.id).all();
  const settings = await db.prepare('SELECT accepting FROM comment_settings WHERE id=1').first();
  const state = await db.prepare('SELECT accepting FROM comment_posts WHERE id=?').bind(post.id).first();
  const comments = results.slice(0, 50); const last = comments.at(-1);
  return json({ comments, next_cursor: results.length > 50 ? btoa(JSON.stringify({ time: last.created_at, id: last.id })) : null,
    accepting: ready(env) && settings.accepting === 1 && state?.accepting !== 0,
    site_key: env.TURNSTILE_SITE_KEY || null, contact: env.COMMENTS_CONTACT || null });
});

export async function submit({ request, env }, verifyChallenge = fetch) {
  requireOrigin(request, env);
  if (!ready(env)) throw new HttpError(503, 'New comments are currently paused.');
  const body = await readJSON(request);
  if (Object.keys(body).some(k => !['post', 'author', 'body', 'request_id', 'turnstile_token'].includes(k)))
    throw new HttpError(400, 'Unexpected comment fields.');
  const author = text(body.author, 80) || 'Reader'; const content = text(body.body, 4000);
  if (!content) throw new HttpError(400, 'Write a comment first.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.request_id || ''))
    throw new HttpError(400, 'Invalid submission ID.');
  const post = await findPost(env, body.post); const db = database(env); const now = nowSeconds();
  const payloadHash = await digest(JSON.stringify([post.id, author, content]));
  const old = await db.prepare('SELECT payload_hash FROM comment_admissions WHERE request_id=? AND created_at>=?')
    .bind(body.request_id, now - 172800).first();
  if (old) {
    if (old.payload_hash !== payloadHash) throw new HttpError(409, 'That submission ID was already used.');
    return json({ accepted: true }, 202);
  }
  const settings = await db.prepare('SELECT accepting FROM comment_settings WHERE id=1').first();
  if (settings.accepting !== 1) throw new HttpError(503, 'New comments are currently paused.');
  const token = body.turnstile_token;
  if (typeof token !== 'string' || !token || token.length > 2048) throw new HttpError(400, 'Complete the spam check.');
  let challenge;
  try {
    const result = await verifyChallenge('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token }),
    });
    if (!result.ok) throw new Error(); challenge = await result.json();
  } catch { throw new HttpError(503, 'The spam check is temporarily unavailable. Your comment was not saved.'); }
  if (!challenge.success || challenge.hostname !== new URL(env.COMMENTS_ORIGIN).hostname || challenge.action !== 'comment')
    throw new HttpError(400, 'The spam check expired or failed. Please try again.');
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) throw new HttpError(503, 'The comment service could not verify this request.');
  const source = await digest(ip, env.COMMENTS_HASH_SECRET); const id = crypto.randomUUID();
  try {
    await db.batch([
      postUpsert(db, post),
      db.prepare(`INSERT INTO comment_admissions (request_id, comment_id, post_id, source_hash, payload_hash, body_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(body.request_id, id, post.id, source, payloadHash, await digest(content), now),
      db.prepare('INSERT INTO comments (id, post_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(id, post.id, author, content, now),
    ]);
  } catch (error) {
    // A concurrent retry can commit between the receipt lookup and this batch.
    const receipt = await db.prepare('SELECT payload_hash FROM comment_admissions WHERE request_id=? AND created_at>=?')
      .bind(body.request_id, now - 172800).first();
    if (receipt?.payload_hash === payloadHash) return json({ accepted: true }, 202);
    const message = String(error.cause?.message || '') + String(error.message);
    if (/COMMENTS_PAUSED|POST_CLOSED/.test(message)) throw new HttpError(503, 'New comments are currently paused.');
    if (/QUEUE_FULL|DAILY_LIMIT|SOURCE_LIMIT/.test(message)) throw new HttpError(429, 'The comment limit has been reached. Please try again later.', { 'Retry-After': '600' });
    if (/DUPLICATE_COMMENT/.test(message)) throw new HttpError(409, 'This comment was already submitted.');
    if (/UNIQUE constraint/.test(message)) throw new HttpError(409, 'That submission ID was already used.');
    throw error;
  }
  return json({ accepted: true }, 202);
}
export const onRequestPost = api(context => submit(context));
