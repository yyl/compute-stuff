Hugo site using the [Paper](https://github.com/nanxiaobei/hugo-paper) theme.  
**URL:** https://www.mildlyjournaling.com/

---

## Directory Layout

```
blog/
├── .github/
│   └── workflows/
│       └── sync-hardcover.yml  # Daily sync of currently-reading books
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
│   └── fetch-hardcover.js  # Fetch currently-reading books from Hardcover API
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

Files in `data/activity/` are YAML arrays of monthly records. They are loaded into templates via `{{ .Site.Data.activity.<name> }}` and rendered as Chart.js charts on the Activity page.

Each YAML file follows the same pattern:

```yaml
- month: "2025-01"
  field_1: 42
  field_2: 100
```

**Data sources → charts:**

| YAML file | Section | Chart(s) | Type |
|-----------|---------|----------|------|
| `currently_reading.yaml` | 📚 Reading | Currently Reading book cards | Card list (auto-generated) |
| `reading.yaml` | 📚 Reading | Articles Read (words bar + minutes line) | Combo (dual y-axis) |
| `books.yaml` | 📚 Reading | Books Finished | Bar |
| `travel.yaml` | 🗺️ Travel | Check-ins & Unique Places (bars + line markers) | Combo (single y-axis) |
| `movies.yaml` | 🎬 Movies | Movies Watched & Rating (bar + line) | Combo (dual y-axis) |
| `podcasts.yaml` | 🎧 Podcasts | Episodes Played; Feed Changes (added/removed) | Bar; Dual bar |
| `workouts.yaml` | 🏋️ Workout | Workouts & Minutes (bar + line) | Combo (dual y-axis) |
| `code.yaml` | 💻 Code | Monthly Commits; Lines Changed | Bar; Dual bar |

**Chart rendering details (in `activity.html`):**

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

### Hardcover Integration (Currently Reading)

The Activity page shows currently-reading books pulled from [Hardcover](https://hardcover.app) via their GraphQL API, displayed as a compact list inside the Reading section.

**Pipeline:**

1. `.github/workflows/sync-hardcover.yml` runs daily at 8 AM UTC (also manually triggerable)
2. Calls `scripts/fetch-hardcover.js` which queries `status_id: 2` (currently reading) from Hardcover's GraphQL endpoint
3. Writes results to `data/activity/currently_reading.yaml`
4. Commits & pushes if data changed → triggers Cloudflare Pages rebuild

**Data format** (`currently_reading.yaml`):

```yaml
- title: "Book Title"
  author: "Author Name"
  hardcover_url: "https://hardcover.app/books/slug"
  started_at: "2026-01-15"        # from first_started_reading_date or date_added
  last_updated: "2026-03-07"      # only on first entry, displayed as footer
```

**Rendering** (in `activity.html`):

- Sorted alphabetically by title using Hugo's `{{ range sort . "title" }}`
- "started Xd ago" computed at build time: `{{ div (sub now.Unix (time .).Unix) 86400 }}`
- Wrapped in a `chart-container` for visual consistency with charts
- "Last updated" date shown at the bottom, read from the first entry's `last_updated` field

**GraphQL fields used:** `user_books.first_started_reading_date`, `date_added`, `book.title`, `book.slug`, `book.cached_contributors`

**Setup:**

1. Get API key from [hardcover.app/account/api](https://hardcover.app/account/api)
2. Add as GitHub repo secret: `HARDCOVER_API_KEY`

**Local testing:**

```bash
HARDCOVER_API_KEY=your_key node scripts/fetch-hardcover.js
```

### Theme

**Paper** – installed as a git submodule in `themes/paper/`. Custom layouts in `layouts/` override theme templates when filenames match.
