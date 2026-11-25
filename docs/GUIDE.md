Hugo site using the [Paper](https://github.com/nanxiaobei/hugo-paper) theme.  
**URL:** https://www.mildlyjournaling.com/

Custom comments: [deployment and operations](OPERATIONS.md), with [design rationale](COMMENTS-DESIGN.md). Production requires account configuration; submissions default to disabled.

---

## Directory Layout

```
blog/
├── .github/
│   └── workflows/
│       └── sync-activity.yml  # Daily sync of recent Activity entries
│
├── archetypes/        # Templates for new content
│   └── default.md     # Default front matter for `hugo new`
│
├── content/           # All site content (Markdown)
│   ├── about.md       # /about/ page
│   ├── activity.md    # /activity/ page (uses custom layout)
│   └── posts/         # Blog posts → /posts/<slug>/
│       └── *.md       # Individual posts (67 files)
│
├── data/              # Structured data files (accessible via .Site.Data)
│   └── activity/      # YAML data powering the Activity page charts
│
├── layouts/           # Custom templates (override theme defaults)
│   ├── _default/      # Default layout overrides
│   │   ├── list.html         # Post list template (with reaction counts)
│   │   ├── single.html      # Single post template
│   │   ├── taxonomy.html    # Taxonomy list page
│   │   ├── term.html        # Taxonomy term page
│   │   └── section.rss.xml  # Custom RSS feed
│   ├── page/
│   │   └── activity.html    # Custom layout for /activity/
│   └── partials/
│       ├── header.html      # Site header partial
│       └── footer.html      # Site footer partial
│
├── scripts/           # Automation scripts
│   ├── fetch-hardcover.js       # Fetch the most recently updated current book
│   └── fetch-latest-activity.py # Fetch the latest archived Readwise article
│
├── functions/         # Cloudflare Pages Functions (serverless API)
│   └── api/
│       ├── reactions.js  # Like/dislike reaction counts endpoint
│       └── img_upload.js # Token-gated image upload → commits WebP to repo
│
├── static/            # Static assets (copied as-is to /public/)
│   ├── img_upload/    # Upload form page → /img_upload/
│   └── staging/       # Upload landing folder → /staging/<image>.webp
│
├── themes/
│   └── paper/         # Paper theme (git submodule)
│
├── public/            # Generated site output (do not edit)
│
├── hugo.toml          # Site configuration
├── wrangler.toml      # Cloudflare Pages config (KV bindings)
└── prompt/            # Misc prompts / notes
```

---

## Key Concepts

### Content → Layout Mapping

| Content file          | Layout used                          | URL            |
|-----------------------|--------------------------------------|----------------|
| `content/about.md`    | Theme default (`single.html`)        | `/about/`      |
| `content/activity.md` | `layouts/page/activity.html`         | `/activity/`   |
| `content/posts/*.md`  | `layouts/_default/single.html`       | `/posts/<slug>/` |

The `activity.md` page uses `layout: activity` in its front matter, which tells Hugo to use `layouts/page/activity.html`.

### Data Files

The Activity page loads monthly chart data from `data/activity/`. The homepage uses the same directory for its latest activity snapshots.

Monthly chart data uses this YAML format:

```yaml
- month: "2025-01"
  field_1: 42
  field_2: 100
```

**Data sources → charts:**

| YAML file | Section | Chart(s) | Type |
|-----------|---------|----------|------|
| `reading.yaml` | 📚 Reading | Articles Read (words bar + minutes line) | Combo (dual y-axis) |
| `books.yaml` | 📚 Reading | Books Finished | Bar |
| `travel.yaml` | 🗺️ Travel | Check-ins & Unique Places (bars + line markers) | Combo (single y-axis) |
| `movies.yaml` | 🎬 Movies | Movies Watched & Rating (bar + line) | Combo (dual y-axis) |
| `podcasts.yaml` | 🎧 Podcasts | Episodes Played; Feed Changes (added/removed) | Bar; Dual bar |
| `workouts.yaml` | 🏋️ Workout | Workouts & Minutes (bar + line) | Combo (dual y-axis) |
| `surfing.yaml` | 🏄 Surfing | Surfilog sessions (left) and waves (right) | Combo (dual y-axis) |
| `bouldering.yaml` | 🧗 Bouldering | Kaya sends by grade | Stacked bar |
| `weightlifting.yaml` | 🏋️ Weightlifting | Strong workouts | Bar |
| `code.yaml` | 💻 Coding | Monthly Commits | Bar |

**Chart rendering details (in `activity.html`):**

- Monthly charts and the Hours spent summary use the six most recent completed calendar months.
- **`fillMonthGaps(data, fields)`** — utility that fills missing months with zeros so charts display a continuous timeline
- **Combo charts** use Chart.js mixed types (bar + line datasets) with `order` to draw lines in front of bars
- **Travel chart** uses a transparent bar with a top-border-only style to render Unique Places as disconnected horizontal line markers overlapping the Check-ins bars
- **Tooltips** on all combo charts use `interaction: { mode: 'index', intersect: false }` so hovering shows all data points for that month

### Navigation

Defined in `hugo.toml` under `[menu]`:

| Menu item   | URL          |
|-------------|--------------|
| About       | `/about/`    |
| My Activity | `/activity/` |

### Post Reactions (Like / Dislike)

Each blog post has 👍/👎 buttons that let visitors react. Counts are shared across all visitors and also displayed on the post list page.

**Architecture:**

- **Backend:** Cloudflare Pages Function at `functions/api/reactions.js`
- **Storage:** Cloudflare KV namespace bound as `REACTIONS`
- **Single post page:** Inline JS in `layouts/_default/single.html` — interactive buttons, uses `localStorage` to track visitor's choice
- **List page:** Inline JS in `layouts/_default/list.html` — read-only counts (↑/↓) next to each post date, batch-fetched in a single API call

**API:**

| Method | URL | Purpose |
|--------|-----|--------|
| `GET` | `/api/reactions?slug=<slug>` | Fetch counts for a single post |
| `GET` | `/api/reactions?slugs=a,b,c` | Batch fetch counts for multiple posts |
| `POST` | `/api/reactions` | Submit or undo a reaction |

POST body: `{ slug, type: "like"|"dislike", undo?: true }`

KV key format: `reactions:<slug>` → `{ likes: N, dislikes: N }`

**Frontend behavior (single post):**

- On page load, fetches counts via GET and restores active state from `localStorage`
- Clicking a button sends a POST, updates the count, and saves the choice to `localStorage`
- Clicking the same button again toggles it off (undo)
- Switching from like→dislike (or vice versa) undoes the old reaction first

**Frontend behavior (list page):**

- On page load, collects all post slugs from `data-slug` attributes and batch-fetches counts via `?slugs=`
- Displays read-only ↑/↓ counts next to each post's date

**Cloudflare KV setup:**

1. Create a KV namespace named `REACTIONS` in the Cloudflare dashboard
2. Bind it to the Pages project: Settings → Functions → KV namespace bindings → Variable name `REACTIONS`
3. For local dev, the namespace ID goes in `wrangler.toml`; run `npx wrangler pages dev ./public`

### Image Upload (phone → blog)

Upload photos from a phone browser; they are converted to WebP and committed to the repo, then published on the next Cloudflare Pages rebuild. Private: the endpoint requires a bearer token.

**Pipeline:**

1. Phone opens `https://www.mildlyjournaling.com/img_upload/` (`static/img_upload/index.html`)
2. **Browser-side conversion** (mirrors `prepare_images.py` in `utilities/`): HEIC/HEIF → JPEG via `heic2any` (WASM), EXIF orientation applied by `createImageBitmap`, stepwise downscale to ≤ 2400 px longest side, sRGB canvas, `toBlob('image/webp', 0.85)` — no metadata
3. `POST /api/img_upload` → `functions/api/img_upload.js` validates the token, sanitizes names, and commits via the GitHub Contents API
4. Commit → Cloudflare Pages rebuild → image is live

**Target rules:**

| Body | Repo path | Served at |
|------|-----------|-----------|
| no `post` | `static/staging/<name>.webp` | `/staging/<name>.webp` |
| `post: "my-slug"` | `content/posts/my-slug/<name>.webp` | `/posts/my-slug/<name>.webp` |

Name collisions auto-rename: `IMG_0790.webp` → `IMG_0790_2.webp`, …

**API:**

| Method | URL | Purpose |
|--------|-----|---------|
| `GET`  | `/api/img_upload` | Config/usage check (returns 200 only with valid token) |
| `POST` | `/api/img_upload` | Upload; body `{ "post": "<slug>"?, "files": [{ "name", "data": "<base64 webp>" }] }`, 1–10 files, 15 MB each max |

Auth: `Authorization: Bearer <UPLOAD_TOKEN>` (or `?token=` fallback).

**Setup (one-time):**

1. Create a fine-grained GitHub PAT: repo `yyl/blog` only, permission *Contents: read & write*
2. Cloudflare dashboard → Pages project → Settings → Functions → **Variables and secrets** (Session: Production):
   - `UPLOAD_TOKEN` — any long random string (kept secret)
   - `GITHUB_TOKEN` — the PAT from step 1
   - optional: `GITHUB_REPO` (`yyl/blog`), `GITHUB_BRANCH` (`main`)
3. For local dev (`npx wrangler pages dev`), put the same values in `.dev.vars` (git-ignored)

**Usage:** open `/img_upload/` on the phone, paste the token (remembered in `localStorage`), optionally enter a post slug, pick photos, upload. Staged images can be moved into a post bundle when the post is written (page-bundle images get the responsive srcset treatment from `layouts/_default/_markup/render-image.html`).

### What’s going on right now

The homepage shows five entries above the post feed. **See more activities** opens the Activity page for the monthly charts. Entry dates are shown relative to today in UTC and switch to months at 30 days. Hover over a date to see the exact day.

- **latest book** shows the Hardcover book with the newest update among books marked Currently Reading. The sync compares the library entry's update timestamp and its latest reading progress or start event. The original book list uses the newest start date until the first daily run.
- **latest reading** shows the Reader archive item in the `article` category with the newest `last_moved_at`. The sync checks all result pages and links to the article's source when available.
- **latest writing** comes from Hugo's `posts` section at build time and uses the post's publish date.
- **latest podcast** shows the Overcast episode marked played with the newest `userUpdatedDate`. Overcast's export reports the episode's last user update as a proxy for when it was played.
- **latest workout** shows the latest Apple Health workout other than a walk, with its activity type, duration, and UTC start date.

`.github/workflows/sync-activity.yml` fetches Hardcover and Readwise daily at 08:00 UTC and can also run manually. D3's [Overcast workflow](https://github.com/yyl/digital-data-dump/actions/workflows/overcast-activity.yml) refreshes `data/activity/latest_podcast.json` on a separate daily schedule using the existing D3 Overcast settings and saved vault data. D3's [Apple Health workflow](https://github.com/yyl/digital-data-dump/actions/workflows/apple-health-activity.yml) imports uploaded workouts from the vault daily at 08:45 UTC and refreshes `data/activity/latest_workout.json`. Changed snapshots trigger a Cloudflare Pages rebuild. A failed fetch leaves its existing snapshot in place. The monthly D3 pipeline continues to supply chart data.

Configure the GitHub Actions repository secrets in `yyl/compute-stuff`.

- `HARDCOVER_API_KEY` is the [Hardcover API key](https://hardcover.app/account/api) from the existing integration.
- `READWISE_ACCESS_TOKEN` is the [Readwise access token](https://readwise.io/access_token).

With the corresponding secret exported in your shell, run a source locally:

```bash
node scripts/fetch-hardcover.js
python3 scripts/fetch-latest-activity.py readwise
```

### Theme

**Paper** – installed as a git submodule in `themes/paper/`. Custom layouts in `layouts/` override theme templates when filenames match.
