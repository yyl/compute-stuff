import { api, database, json, nowSeconds } from '../../../lib/comments/common.js';
export const onRequestGet = api(async ({ env }) => {
  const row = await database(env).prepare('SELECT last_cleanup, last_backup FROM comment_settings WHERE id=1').first();
  const now = nowSeconds();
  const healthy = !!row.last_cleanup && !!row.last_backup && now - row.last_cleanup < 7200 && now - row.last_backup < 129600;
  return json({ ok: healthy }, healthy ? 200 : 503);
});
