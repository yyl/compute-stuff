import { api, HttpError } from '../../../lib/comments/common.js';
import { verifyAdmin } from '../../../lib/comments/auth.js';
export const onRequest = api(async ({ request, env }) => {
  await verifyAdmin(request, env);
  if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, 'Method not allowed.');
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, { status: response.status, headers });
});
