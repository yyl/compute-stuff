import { HttpError, database, readJSON, text, findPost, postUpsert, json, nowSeconds, manifest, portableExport } from './common.js';
import { verifyAdmin, requireAdminMutation } from './auth.js';

export async function adminGet({ request, env }) {
  await verifyAdmin(request, env);
  const db = database(env); const url = new URL(request.url);
  if (url.searchParams.get('export') === '1') {
    const [posts, comments] = await db.batch([
      db.prepare('SELECT * FROM comment_posts ORDER BY id'),
      db.prepare("SELECT * FROM comments WHERE status='approved' ORDER BY created_at, id"),
    ]);
    const current = new Map((await manifest(env)).posts.map(post => [post.id, post]));
    const canonicalPosts = posts.results.map(post => {
      const latest = current.get(post.id); if (!latest) return post;
      return { ...post, url: latest.url, title: latest.title,
        aliases: JSON.stringify([...new Set([...JSON.parse(post.aliases), ...(latest.aliases || []), ...(post.url !== latest.url ? [post.url] : [])])]) };
    });
    return json(portableExport(canonicalPosts, comments.results), 200, { 'Content-Disposition': 'attachment; filename="comments-export.json"' });
  }
  const state = url.searchParams.get('status') || 'pending';
  if (!['pending', 'approved', 'spam', 'rejected'].includes(state)) throw new HttpError(400, 'Invalid status.');
  const before = Number(url.searchParams.get('before') || 0);
  if (!Number.isSafeInteger(before) || before < 0) throw new HttpError(400, 'Invalid page.');
  const result = await db.prepare(`SELECT c.*, p.title, p.url FROM comments c JOIN comment_posts p ON p.id=c.post_id
    WHERE c.status=? ORDER BY c.created_at, c.id LIMIT 50 OFFSET ?`).bind(state, before).all();
  const counts = await db.prepare('SELECT status, count(*) AS count, min(created_at) AS oldest FROM comments GROUP BY status').all();
  const settings = await db.prepare('SELECT * FROM comment_settings WHERE id=1').first();
  const today = await db.prepare('SELECT count(*) AS count FROM comment_admissions WHERE created_at>=?')
    .bind(nowSeconds() - (nowSeconds() % 86400)).first();
  const posts = (await manifest(env)).posts;
  const stored = await db.prepare('SELECT id, accepting FROM comment_posts').all();
  const states = new Map(stored.results.map(p => [p.id, p.accepting]));
  return json({ comments: result.results, counts: counts.results, settings, admitted_today: today.count,
    posts: posts.map(p => ({ ...p, accepting: states.get(p.id) !== 0 })),
    next_before: result.results.length === 50 ? before + 50 : null,
    deployment_enabled: env.COMMENTS_ENABLED === 'true' });
}

export async function adminPost({ request, env }) {
  const actor = await verifyAdmin(request, env); requireAdminMutation(request, env);
  const data = await readJSON(request); const db = database(env); const now = nowSeconds();
  const audit = (id, action) => db.prepare('INSERT INTO comment_events (comment_id, actor, action, created_at) VALUES (?, ?, ?, ?)').bind(id, actor, action, now);
  if (data.action === 'settings') {
    if (typeof data.accepting !== 'boolean') throw new HttpError(400, 'Invalid setting.');
    await db.batch([db.prepare('UPDATE comment_settings SET accepting=? WHERE id=1').bind(Number(data.accepting)), audit(null, data.accepting ? 'open' : 'pause')]);
  } else if (data.action === 'post') {
    if (typeof data.accepting !== 'boolean') throw new HttpError(400, 'Invalid setting.');
    const post = await findPost(env, data.post);
    await db.batch([postUpsert(db, post), db.prepare('UPDATE comment_posts SET accepting=? WHERE id=?').bind(Number(data.accepting), post.id), audit(null, `${data.accepting ? 'open' : 'close'}:${post.id}`)]);
  } else if (data.action === 'owner') {
    const post = await findPost(env, data.post); const content = text(data.body, 4000);
    if (!content) throw new HttpError(400, 'Write a comment first.');
    const author = text(env.COMMENTS_OWNER_NAME, 80) || 'Author'; const id = crypto.randomUUID();
    await db.batch([postUpsert(db, post), db.prepare(`INSERT INTO comments (id,post_id,author,body,created_at,published_at,moderated_at,status,is_owner)
      VALUES (?,?,?,?,?,?,?,'approved',1)`).bind(id, post.id, author, content, now, now, now), audit(id, 'owner')]);
  } else if (['approve', 'reject', 'spam', 'delete'].includes(data.action)) {
    if (!Array.isArray(data.ids) || data.ids.length < 1 || data.ids.length > 50 || data.ids.some(id => typeof id !== 'string' || id.length > 100))
      throw new HttpError(400, 'Choose between 1 and 50 comments.');
    const statements = [];
    for (const id of new Set(data.ids)) {
      if (data.action === 'delete') statements.push(db.prepare('DELETE FROM comments WHERE id=?').bind(id));
      else {
        const status = { approve: 'approved', reject: 'rejected', spam: 'spam' }[data.action];
        statements.push(db.prepare(`UPDATE comments SET status=?, moderated_at=?, published_at=CASE WHEN ?='approved' THEN COALESCE(published_at,?) ELSE NULL END WHERE id=?`)
          .bind(status, now, status, now, id));
      }
      statements.push(audit(id, data.action));
    }
    await db.batch(statements);
  } else throw new HttpError(400, 'Unknown moderation action.');
  return json({ ok: true });
}
