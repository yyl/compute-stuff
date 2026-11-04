import { database, digest, nowSeconds } from '../lib/comments/common.js';

export const durableTables = ['comment_settings', 'comment_posts', 'comments', 'comment_events', 'd1_migrations'];

export async function cleanup(env, now = nowSeconds()) {
  const db = database(env);
  await db.batch([
    db.prepare('DELETE FROM comment_admissions WHERE created_at<?').bind(now - 172800),
    db.prepare("DELETE FROM comments WHERE status IN ('spam','rejected') AND COALESCE(moderated_at,created_at)<?").bind(now - 604800),
    db.prepare("DELETE FROM comments WHERE status='pending' AND created_at<?").bind(now - 7776000),
    db.prepare('DELETE FROM comment_events WHERE created_at<?').bind(now - 7776000),
    db.prepare('UPDATE comment_settings SET last_cleanup=? WHERE id=1').bind(now),
  ]);
}

export async function backup(env, now = nowSeconds(), fetcher = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  if (!env.COMMENTS_BACKUPS || !env.CF_ACCOUNT_ID || !env.COMMENTS_DATABASE_ID || !env.D1_EXPORT_TOKEN)
    throw new Error('backup_configuration_missing');
  if (!/^[a-f0-9]{32}$/i.test(env.CF_ACCOUNT_ID) || !/^[a-f0-9-]{36}$/i.test(env.COMMENTS_DATABASE_ID)) throw new Error('backup_configuration_invalid');
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database/${env.COMMENTS_DATABASE_ID}/export`;
  let bookmark; let result;
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await fetcher(endpoint, { method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${env.D1_EXPORT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ output_format: 'polling', ...(bookmark ? { current_bookmark: bookmark } : { dump_options: { tables: durableTables } }) }),
    });
    if (!response.ok) throw new Error('backup_export_http_error');
    const data = await response.json();
    if (!data.success || !data.result || data.result.error) throw new Error('backup_export_failed');
    result = data.result;
    if (result.status === 'complete') break;
    bookmark = result.at_bookmark;
    if (!bookmark) throw new Error('backup_export_bookmark_missing');
    await wait(1000);
  }
  if (result?.status !== 'complete' || !result.result?.signed_url) throw new Error('backup_export_timeout');
  const download = new URL(result.result.signed_url);
  if (download.protocol !== 'https:') throw new Error('backup_download_invalid');
  const response = await fetcher(download, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('backup_download_failed');
  // Bound buffering before decoding; do not log the temporary URL or SQL text.
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 20 * 1024 * 1024) { await reader.cancel(); throw new Error('backup_too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const sql = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!sql.includes('CREATE TABLE') || !sql.includes('comments'))
    throw new Error('backup_content_invalid_or_too_large');
  const sha256 = await digest(sql);
  const key = `comments/${new Date(now * 1000).toISOString().replaceAll(':', '-')}.sql`;
  const object = await env.COMMENTS_BACKUPS.put(key, sql, {
    httpMetadata: { contentType: 'application/sql' }, customMetadata: { sha256, schema_version: '1', bookmark: String(result.at_bookmark || '') },
  });
  if (!object) throw new Error('backup_upload_failed');
  // Success state is updated only after the complete object is persisted.
  await database(env).prepare('UPDATE comment_settings SET last_backup=?, backup_key=? WHERE id=1').bind(now, key).run();
  return { key, sha256 };
}

export async function maintenance(env) {
  const now = nowSeconds(); await cleanup(env, now);
  const settings = await database(env).prepare('SELECT last_backup FROM comment_settings WHERE id=1').first();
  // Hourly cron retries a missed daily backup on the next run.
  if (!settings.last_backup || now - settings.last_backup >= 86400) await backup(env, now);
}
export default {
  async scheduled(event, env, context) {
    context.waitUntil(maintenance(env).catch(error => {
      console.error('comments_maintenance_failed'); throw new Error('comments_maintenance_failed');
    }));
  },
  fetch() { return new Response('Not found', { status: 404 }); },
};
