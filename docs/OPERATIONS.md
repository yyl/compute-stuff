# Blog operations

This runbook covers the custom comments system. The implementation is in this repository; Cloudflare resources, addresses, credentials, and monitoring must be configured before production use. Addresses are intentionally blank. Submissions are disabled both by the deployment switch and by the initial database state.

Architecture and rationale: [COMMENTS-DESIGN.md](COMMENTS-DESIGN.md). Comments use Pages Functions and a dedicated D1 database. A separate hourly Worker performs cleanup and daily private SQL backups to R2. Reading a static post does not invoke the comments database. Existing reactions and image uploads retain their existing bindings/secrets.

## Local build and verification

Use Node 24 or later and Hugo extended (tested with Hugo 0.141). Install locked dependencies and build:

```sh
npm ci
npm run build
npm test
npm --prefix tests ci
npm run test:existing
```

`npm run build` generates ignored `build/`, with a workspace-local Hugo cache. Plain `hugo` also writes to `build/`, matching the Pages output directory. Do not edit or commit generated files under the repository's legacy tracked `public/` folder. The production and preview build variables in `wrangler.toml` select Hugo 0.141.0 and Node 24.

The integration tests use real local D1 through Miniflare, with injected challenge responses and signed test Access tokens. They exercise concurrent admission, publication/privacy, authentication/CSRF, retention, backups and export conversion. These test substitutes are not runtime authentication bypasses.

For browser checks, use installed Chrome on macOS or install Playwright Chromium elsewhere:

```sh
npx playwright install chromium
npm run test:browser
```

An existing Chrome installation is used automatically on macOS; otherwise `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select a browser. The browser test serves a disposable database and substitutes Turnstile/JWKS in the test harness only. Screenshots are under ignored `test-results/`.

### Interactive comments demo

To manually try submitting, approving, publishing and pausing comments without Cloudflare credentials:

```sh
npm run dev:comments
```

Open **http://127.0.0.1:8789/posts/hello-world/** and submit a comment. Follow **Open moderation** in the local banner (or visit **http://127.0.0.1:8789/__local/comments-login**), approve it, then reload the post. This serves the same generated Hugo blog and the actual comment handlers, with a disposable local D1 database. Guest submission starts enabled in this demo. Login and Turnstile are simulated only by this separate local test server; it does not verify real Cloudflare Access or bot protection. Other Cloudflare APIs, including image uploads and reactions, are not implemented by this comments demo.

The server binds only to `127.0.0.1`. Press Ctrl+C to stop; comments reset when it restarts. `COMMENTS_DEMO_PORT` can select another port if 8789 is occupied. The real submission limits still apply (initially three comments per ten minutes from the local source); restarting resets the disposable counters. No production settings, keys, addresses or databases are used. The demo code lives outside the deployable Functions and static assets. `npm run test:browser` exercises this same demo automatically.

### Cloudflare local preview

The regular Wrangler preview serves both the static Hugo output and all Pages Functions on one local origin. It emulates the Cloudflare deployment; Hugo itself only generates the files and does not run as a second server. A plain `hugo server` is still available for content work, but does not run the comment API.

For read-only local development, copy `.dev.vars.example` to `.dev.vars`, initialize the local database, and start Pages:

```sh
if [ ! -f .dev.vars ]; then cp .dev.vars.example .dev.vars; fi
npx wrangler d1 migrations apply COMMENTS_DB --local --persist-to .cache/comments-dev
npx wrangler pages dev build --persist-to .cache/comments-dev
```

Local admin remains closed without real Access configuration. In this Wrangler preview, “New comments are currently paused” is expected: `COMMENTS_ENABLED` defaults to false, required credentials/contact settings are blank, and the database starts with `accepting=0`. Use the interactive demo above for manual comment testing. Changing only the database flag will not enable a preview with missing configuration. Never use local test JWT keys, dummy Turnstile responses, or test harnesses in production.

## First deployment

### 1. Select the existing account and Pages project

```sh
npx wrangler login
npx wrangler whoami
npx wrangler pages project list
```

Use the existing blog project; do not create a replacement or use a temporary preview account. Set the root `wrangler.toml` `name` to that actual project name if it differs from the current label. Keep its current domain and existing `REACTIONS`, `UPLOAD_TOKEN`, and `GITHUB_TOKEN` settings. Check the dashboard's production branch and build configuration before changing it. This runbook uses build command `npm ci && npm run build`, output directory `build`, and a Node 24+ build environment.

If the Pages project automatically deploys `main`, finish the resource and policy setup before pushing these changes. Even if deployed early, the default-off switches must remain off. The repository configuration sets the comment UI on blog posts; with missing runtime settings it shows a paused/unavailable state.

### 2. Create isolated production and preview databases

```sh
npx wrangler d1 create mildly-journaling-comments
npx wrangler d1 create mildly-journaling-comments-preview
```

The root `wrangler.toml` omits comments databases and preview reactions until their resources exist. Add `[[d1_databases]]` and `[[env.preview.d1_databases]]` entries with binding `COMMENTS_DB`, the corresponding database name and ID, and `migrations_dir = "migrations"`. Copy the production ID into the `maintenance/wrangler.toml` D1 binding and its `COMMENTS_DATABASE_ID` variable. Set `CF_ACCOUNT_ID` in the maintenance configuration. Create a separate KV namespace for preview reactions (`wrangler kv namespace create REACTIONS_PREVIEW`) and add it as `[[env.preview.kv_namespaces]]` with binding `REACTIONS` and its ID. Preview uses a different database, no production Access audience, and submissions disabled by default. Never bind preview code to production D1 or R2.

Apply migrations before the application begins using the database:

```sh
npx wrangler d1 migrations apply COMMENTS_DB --remote
npx wrangler d1 migrations apply COMMENTS_DB --remote --env preview
```

Review the target account/database printed by Wrangler. The all-zero IDs in the checked-in configuration are placeholders, not resources. `npm run check:deploy` deliberately fails until static production configuration is filled in.

### 3. Configure Turnstile and owner Access

Create a Managed Turnstile widget for `www.mildlyjournaling.com`. Put its public site key in production `TURNSTILE_SITE_KEY`. The handler requires the returned hostname to equal `COMMENTS_ORIGIN` and the action to equal `comment`; incorrect hostnames, expired/reused tokens, and provider outages reject submissions.

Create a Cloudflare Access self-hosted application protecting both `/admin/comments` (and descendants) and `/api/admin/comments` (and descendants). Set an allow policy for the owner's chosen email only. Copy the Access team issuer (for example `https://TEAM.cloudflareaccess.com` with no trailing slash) and application audience into `ACCESS_ISSUER` and `ACCESS_AUD`. Put the allowed email in `COMMENTS_ADMIN_EMAIL`; multiple owner addresses may be comma-separated. Keep both paths on the same Access application/audience, or create compatible policies under that audience.

The application independently verifies JWT signatures, issuer, audience, expiry and owner email on both the admin assets and API. Check that `pages.dev`, preview domains, exact paths and trailing-slash paths do not provide anonymous access. Prefer blocking the production `pages.dev` hostname in Access as an additional layer; JWT verification must remain in the application regardless.

Set `COMMENTS_CONTACT` to the public removal-request email and optionally `COMMENTS_OWNER_NAME`. These values and the owner login remain blank until the owner supplies them. Public contact and owner login can differ. Review Cloudflare's request logging and retention; application code does not log comment bodies, raw IPs or tokens.

Root `wrangler.toml` is the source of truth for non-secret production variables; edit those values there rather than assuming dashboard values override them. Runtime secrets belong in the existing Pages project's production environment:

| Secret | Purpose |
| --- | --- |
| `TURNSTILE_SECRET_KEY` | Turnstile server-side validation |
| `COMMENTS_HASH_SECRET` | Random secret of at least 32 characters for keyed source hashes |

Use the Pages dashboard's Variables and Secrets interface, or `wrangler pages secret put NAME --project-name YOUR_EXISTING_PROJECT`. Generate the hash secret in a password manager or with `openssl rand -hex 32`; do not paste it into a tracked file or a command argument. Restrict production secrets to production. Add test/development secrets only to isolated environments.

### 4. Create private backups and maintenance

```sh
npx wrangler r2 bucket create mildly-journaling-comments-backups
```

Keep the bucket private: no public `r2.dev` endpoint or custom public domain. Configure a 30-day object lifecycle expiration for the `comments/` prefix in the R2 dashboard. R2 can require billing activation even when expected usage fits included allowances; review account pricing before enabling it.

Create a dedicated token with the minimum available D1 export permission; validate that permission with the first backup rather than using a global API key. Cloudflare token scope may cover the account rather than just one database; review that scope and keep the token only in the maintenance Worker. Its D1 binding handles cleanup; its R2 binding handles uploads. The public API gets no R2 binding and no export token.

```sh
npx wrangler secret put D1_EXPORT_TOKEN --config maintenance/wrangler.toml
npm run check:deploy
npx wrangler deploy --config maintenance/wrangler.toml --dry-run
npm run maintenance:deploy
```

The Worker has no public HTTP endpoint. Cron runs at minute 17 of every hour. Cleanup runs hourly; backup runs when the latest success is at least 24 hours old. Failed backups are retried on the next scheduled run. A complete SQL export is saved to private R2 with a SHA-256 checksum in object metadata; the database success marker is updated after upload. Temporary source hashes/receipts are excluded from SQL exports. D1's own Time Travel retention still applies to the entire database. The current backup job buffers at most 20 MiB; if the durable dataset approaches that size, move to a streaming/Workflow backup implementation before raising this bound. Check scheduled-job CPU requirements against the account plan as the data grows.

Observe the first successful run in the Worker logs and moderation dashboard; do not wait until an incident to discover a missing permission. A new setup's `/api/comments/health` intentionally returns 503 until cleanup and backup have succeeded. To trigger maintenance immediately, use the Worker dashboard's scheduled-event test if available, or use `wrangler dev --test-scheduled` with explicitly chosen remote bindings in a controlled maintenance session; otherwise wait for the next hourly run.

### 5. Deploy closed, verify, then open

```sh
npm run build
npx wrangler pages deploy build --project-name YOUR_EXISTING_PROJECT --branch main
```

Alternatively let the existing Git-integrated Pages project build the reviewed commit with the build settings above. Do not create a second deployment pipeline unintentionally. Deploy preview first with its isolated database. Keep production `COMMENTS_ENABLED = "false"` through initial verification.

Configure an independent HTTP monitor for `https://www.mildlyjournaling.com/api/comments/health` with failure alerts to the owner. It returns only `{ "ok": true/false }`: cleanup must be less than 2 hours old, backup less than 36 hours old. Configure several consecutive failures before alerting. This detects a stopped scheduler as well as database/API errors. Alert delivery is external configuration; the code does not send email or silently create a monitor.

Verify the static blog loads during a simulated comment failure, admin/API deny unauthenticated requests on every hostname, backups are private and restorable, and available Cloudflare usage notifications have a recipient. Use a real production Turnstile challenge for the final smoke test; local mocks cannot prove the production widget/policy setup.

To open after verification, set production `COMMENTS_ENABLED = "true"`, redeploy, then sign in at `/admin/comments/` and click **Open submissions**. Both switches are required. Pilot on one post if desired: set other posts' `comments = false` during the pilot or close them in the admin controls. Submit a guest comment, approve it, confirm it appears publicly, then remove the smoke-test comment.

## Routine moderation

Open `/admin/comments/` through Access. The default view is pending. Select comments and approve, reject, or mark as spam. Up to 50 comments can be processed at once; use the status selector and next-page button for more. **Delete selected permanently** removes live content and requires confirmation. Rejection/spam status is reversible until automatic cleanup removes the record. Approval never changes the reader's words.

Use **Post settings and author comments** to close a single post or publish an owner comment. Names submitted publicly are unverified; the Author badge is set only by the authenticated owner action. There are no reader accounts, self-editing, attachments, email collection or reply notifications.

The public API currently uses `Cache-Control: no-store`: new approvals/removals appear on the next fetch without an edge-cache purge. An already open tab updates on reload. This deliberately simplifies correctness for low traffic; add bounded caching only after measuring read volume.

Comment identity defaults to the post's original relative permalink. Before changing a post's slug/path, add `comments_id` in its front matter with the **old** relative permalink (for example `comments_id = '/posts/old-name/'`), and keep it permanently. Add the old path to Hugo `aliases` for redirects. The build rejects duplicate keys; the export resolves current canonical URLs from the build manifest even if nobody has commented since the rename.

Review pending comments weekly. The dashboard shows counts/oldest timestamps, daily accepted submissions, deployment switch and last maintenance successes. Readers should not expect immediate publication. Follow up on removal requests at `COMMENTS_CONTACT`; for guests, assess the request rather than assuming display names prove ownership.

## Spam and outage response

Starting limits are 3 accepted submissions per source per rolling 10 minutes, 10 per source per UTC day, 100 globally per UTC day, and 200 pending. Accepted counts remain in the short-lived admission table after deleting spam, so deletion does not immediately replenish an attacker's allowance. Hashes are keyed and private; no raw source address is stored. Hourly cleanup makes physical retention approximately 48–49 hours. Fixed per-source identifiers do not prove identity, and distributed sources can bypass per-source limits.

1. If the queue is overwhelmed, click **Pause submissions**. Approved comments remain readable. Mark/delete confirmed spam in batches; do not increase limits merely to accommodate an attack.
2. If moderation/D1 is unavailable, set `COMMENTS_ENABLED = "false"` in production and redeploy. That rejects submissions before database access. For a read flood, temporarily disable the comments endpoint at Cloudflare's edge as well; the write switch alone does not stop reads or invocation costs.
3. Inspect aggregate Cloudflare traffic, D1 usage and errors. Apply available edge rate limiting/WAF controls to the comment API; capabilities depend on the account plan. Avoid logging submitted text or full addresses while investigating.
4. Reopen cautiously after the cause is understood. Increase database limits only for demonstrated legitimate traffic. Settings live in the singleton `comment_settings` row; allowed numeric ranges are enforced by the schema. Take a backup before manually changing operational SQL.

If Turnstile is down, new comments fail closed and the form preserves text while open. If D1 is down or its allowance is exhausted, comments may be unavailable but static posts remain readable. Other dynamic blog features can share account-level quotas. Submission caps bound stored spam, not all attempted requests or paid usage. Configure usage notifications and review any paid overages; no automatic dollar-budget cutoff is implemented.

For suspected credential compromise, pause submissions, revoke the affected Access/session/API token, review moderation events and public comments, and rotate the specific secret. Rotating the hash secret resets per-source tracking; global limits remain. No third-party moderation messages or emails are sent automatically.

## Maintenance schedule

| Cadence | Work | Owner |
| --- | --- | --- |
| Hourly | Retention cleanup, maintenance timestamp, retry overdue backup | Scheduled Worker |
| Daily | Private durable-table SQL backup when due; health/staleness checks | Worker and external monitor |
| Weekly | Moderate queue; check backup age, failures and unusual usage | Blog owner, roughly 10–20 minutes at low traffic |
| Monthly | Review dependencies/advisories, errors and billing; save an encrypted backup outside Cloudflare | Owner/developer, roughly 30–60 minutes |
| Quarterly | Restore into an isolated database; check Access/token scope; repeat Remark42 compatibility rehearsal | Owner/developer, roughly one hour |
| Before release | Tests/build, backup before schema changes, preview and production smoke test | Developer |

These are planning estimates, not unattended support or a 24/7 response commitment. Code maintenance and recovery require someone to act. Cloudflare operates the platform; we own application correctness, moderation, settings, retention and recovery. Reassess the custom system if it regularly needs more than an hour per week or readers need subscriptions/accounts/threading.

Retention: approved comments remain until removed; pending expires after 90 days; rejected/spam after 7 days from moderation; event metadata after 90 days; transient admission data after 48 hours plus the next hourly cleanup. Backups may retain deleted material for 30 days. Expire encrypted off-account copies within 90 days and disclose that policy. No comment content should enter public Git history, public CI artifacts or application logs.

Review `npm outdated` and `npm audit` monthly; apply changes in a reviewed branch and run the checks above. Miniflare 4 is pinned for its stable D1 test API, with patched `sharp`/`undici` overrides; review these overrides when upgrading the runtime. Keep the lockfile and compatibility dates reviewed together. Prefer additive migrations so rolling back code remains possible; code rollback does not undo a database migration.

## Backup download and restore

The admin export contains approved comments in portable JSON; it is for migration, not full disaster recovery. Full SQL snapshots include durable tables and moderation metadata, excluding source hashes/receipts. The R2 object key is shown as `backup_key` in the admin API settings response; private bucket listing is also available to the owner. Download without enabling public access:

```sh
mkdir -p backups
npx wrangler r2 object get BUCKET/comments/TIMESTAMP.sql --file backups/comments.sql --remote
```

Use the actual bucket/key. Compare a SHA-256 hash of the file with the object's `sha256` custom metadata in R2. Keep backups directory private on the owner's machine and encrypt off-account copies before moving them. Do not place unencrypted snapshots in shared folders. Same-account R2 does not protect against loss of the Cloudflare account; the monthly off-account copy does.

D1 Time Travel currently supports recent recovery within 7 days on Free and 30 days on Paid. Check a bookmark before destructive work:

```sh
npx wrangler d1 time-travel info COMMENTS_DB
```

For a SQL restore, pause submissions and preserve the current state first. Create a **new** D1 database; never overwrite the only surviving copy:

```sh
npx wrangler d1 create mildly-journaling-comments-recovery
npx wrangler d1 execute mildly-journaling-comments-recovery --remote --file backups/comments.sql
```

The snapshot includes durable schema and migration history but excludes transient tables. After import, recreate the transient table/index/trigger statements using `migrations/0001_comments.sql` as the reference; `scripts/recovery-transient.sql` contains exactly those statements. Then force the restored settings closed:

```sh
npx wrangler d1 execute mildly-journaling-comments-recovery --remote --file scripts/recovery-transient.sql
npx wrangler d1 execute mildly-journaling-comments-recovery --remote --command "UPDATE comment_settings SET accepting=0,last_backup=NULL,last_cleanup=NULL,backup_key=NULL WHERE id=1"
```

Check approved counts, bodies/Unicode/timestamps, URLs and moderation states. Reconcile recent removals against the pre-restore events/records before exposing restored content, because backups can resurrect deleted comments. Update the production and maintenance database IDs together, deploy with the write switch off, run cleanup/backup, and smoke-test before reopening. Keep the old database read-only briefly for rollback, then retire it deliberately.

A daily backup targets at most 24 hours of data loss under normal job operation; Time Travel may recover more recent data. Aim for recovery within four hours after someone starts work, not four hours after an unattended failure. An account-loss recovery using monthly off-account copies may lose up to a month. Test the actual restore procedure quarterly.

## Moving to Remark42

Download **Export approved comments** from the moderation page, then convert:

```sh
npm run comments:export -- backups/comments-export.json backups/remark42.jsonl YOUR_REMARK42_SITE_ID
```

The converter refuses to overwrite an existing file, writes mode 0600, preserves IDs/names/body/timestamps/post URLs, escapes rendered HTML, and gives each unverified guest comment a distinct imported identity. It never assigns future account ownership or admin privileges based on a name. Pending/rejected/spam comments are excluded.

At cutover, pause submissions, take final exports/backups, import into a new Remark42 site, compare records, then switch the Hugo widget and turn off the custom one (`commentsEnabled = false`). Remark42 restore/import replaces destination comments: never point a rehearsal at a live populated site. Keep source data read-only temporarily for rollback and then follow the retention policy.

Repeat compatibility testing against the chosen Remark42 release. The converter targets native JSON-lines format version 1. Remark42 v1.18.0 was verified during implementation using its official macOS ARM64 release binary after checksum verification: IDs, names, Unicode, line breaks, timestamps and canonical URLs survived a real import; pending comments stayed excluded and rendered HTML stayed escaped. The restore CLI returns when an asynchronous import is accepted, so wait for the expected records before declaring success.

Repeat the local rehearsals without touching production:

```sh
node test/restore-rehearsal.mjs
node test/remark42-rehearsal.mjs /path/to/checksum-verified/remark42
```

The scripts create disposable stores; the SQL script keeps scratch output under ignored `.cache/` for diagnosis. The Remark42 script stops its server and deletes its temporary data when finished. The migration tool is not a guarantee about all future Remark42 releases. CI runs the regular tests, browser flow, existing regressions and SQL recovery rehearsal; the binary-based Remark42 check is an explicit periodic rehearsal.

## Reference documentation

- [Pages Function routing](https://developers.cloudflare.com/pages/functions/routing/)
- [Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [D1 export/import](https://developers.cloudflare.com/d1/best-practices/import-export-data/) and [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [D1 export API and accepted token permissions](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/)
- [Remark42 import/restore](https://remark42.com/docs/backup/migration/)
