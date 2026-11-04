import { readFile } from 'node:fs/promises';
const pages = await readFile('wrangler.toml', 'utf8');
const maintenance = await readFile('maintenance/wrangler.toml', 'utf8');
const failures = [];
for (const [name, content] of [['Pages', pages], ['Maintenance', maintenance]]) {
  if (content.includes('00000000-0000-0000-0000-000000000000')) failures.push(`${name}: replace the placeholder database ID`);
}
for (const key of ['COMMENTS_CONTACT', 'COMMENTS_ADMIN_EMAIL', 'ACCESS_ISSUER', 'ACCESS_AUD', 'TURNSTILE_SITE_KEY']) {
  if (new RegExp(`^${key} = ""`, 'm').test(pages)) failures.push(`Pages: fill ${key}`);
}
for (const key of ['CF_ACCOUNT_ID', 'COMMENTS_DATABASE_ID']) {
  if (new RegExp(`^${key} = ""`, 'm').test(maintenance)) failures.push(`Maintenance: fill ${key}`);
}
if (failures.length) {
  console.error(`Deployment configuration is incomplete:\n- ${failures.join('\n- ')}\nSee docs/OPERATIONS.md. Runtime secrets, Access policies, backup retention and alert delivery also require setup.`);
  process.exitCode = 1;
} else console.log('Static configuration is filled in. Complete the runtime and launch checks in docs/OPERATIONS.md before opening submissions.');
