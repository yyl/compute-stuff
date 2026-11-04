import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError, requireOrigin } from './common.js';
const keySets = new Map();
export async function verifyAdmin(request, env, testKeySet) {
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER || '')
    || !env.ACCESS_AUD || !env.COMMENTS_ADMIN_EMAIL) throw new HttpError(503, 'Moderation is not configured.');
  const token = request.headers.get('Cf-Access-Jwt-Assertion') ||
    (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith('CF_Authorization='))?.slice(17);
  if (!token) throw new HttpError(403, 'Sign in through Cloudflare Access.');
  let keys = testKeySet || keySets.get(env.ACCESS_ISSUER);
  if (!keys) { keys = createRemoteJWKSet(new URL(`${env.ACCESS_ISSUER}/cdn-cgi/access/certs`)); keySets.set(env.ACCESS_ISSUER, keys); }
  let payload;
  try { ({ payload } = await jwtVerify(token, keys, { issuer: env.ACCESS_ISSUER, audience: env.ACCESS_AUD,
    algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'email', 'sub'] })); }
  catch { throw new HttpError(403, 'Your moderation session is invalid or expired.'); }
  const allowed = env.COMMENTS_ADMIN_EMAIL.toLowerCase().split(',').map(x => x.trim());
  if (typeof payload.email !== 'string' || !allowed.includes(payload.email.toLowerCase())) throw new HttpError(403, 'Owner access required.');
  return payload.email.toLowerCase();
}
export function requireAdminMutation(request, env) {
  requireOrigin(request, env);
  if (request.headers.get('X-Comments-Admin') !== '1') throw new HttpError(403, 'Missing moderation request header.');
}
