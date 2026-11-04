import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const escapeHTML = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
export function toRemark42(data, siteID) {
  if (data.format !== 'mildly-journaling-comments' || data.version !== 1 || !Array.isArray(data.posts) || !Array.isArray(data.comments))
    throw new Error('Expected a version 1 private comments export.');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(siteID || '')) throw new Error('Provide a valid Remark42 site ID.');
  const posts = new Map(data.posts.map(post => [post.id, post]));
  const approved = data.comments.filter(comment => comment.status === 'approved');
  const ids = new Set(approved.map(comment => comment.id));
  if (ids.size !== approved.length) throw new Error('Duplicate comment IDs.');
  const metadata = { version: 1, users: [], posts: data.posts.map(post => ({ url: post.url, read_only: post.accepting === 0 })) };
  const lines = [JSON.stringify(metadata)];
  for (const comment of approved) {
    const post = posts.get(comment.post_id);
    if (!post || !/^https?:$/.test(new URL(post.url).protocol) || typeof comment.body !== 'string' || typeof comment.author !== 'string'
      || !Number.isSafeInteger(comment.created_at) || (comment.parent_id && !ids.has(comment.parent_id))) throw new Error('Invalid comment or post mapping.');
    // Each unverified guest gets a distinct imported identity. Matching display
    // names do not prove authorship, so never merge those identities.
    const userID = createHash('sha1').update(`mildly-journaling-import:${comment.id}`).digest('hex');
    lines.push(JSON.stringify({ id: comment.id, pid: comment.parent_id || '',
      text: `<p>${escapeHTML(comment.body).replaceAll('\n', '<br>')}</p>`, orig: comment.body,
      user: { name: comment.author, id: userID, picture: '', admin: false, verified: false },
      locator: { site: siteID, url: post.url }, score: 0, votes: {},
      time: new Date(comment.created_at * 1000).toISOString(), imported: true, title: post.title,
    }));
  }
  return lines.join('\n') + '\n';
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output, siteID] = process.argv.slice(2);
  if (!input || !output || !siteID) throw new Error('Usage: npm run comments:export -- input.json output.jsonl remark42-site-id');
  const data = JSON.parse(await readFile(input, 'utf8'));
  await writeFile(output, toRemark42(data, siteID), { mode: 0o600, flag: 'wx' });
  console.log(`Wrote ${data.comments.filter(c => c.status === 'approved').length} approved comments. Verify in a new Remark42 site before switching.`);
}
