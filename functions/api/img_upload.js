// Token-gated image upload endpoint.
//
// Accepts pre-converted WebP images (base64) from the /img_upload/ page and
// commits them to the repo via the GitHub Contents API, so the next Cloudflare
// Pages build serves them.
//
// Required environment variables (Cloudflare Pages -> Settings -> Functions):
//   UPLOAD_TOKEN   Bearer token required on every request
//   GITHUB_TOKEN   Fine-grained PAT with contents:read+write on the blog repo
//   GITHUB_REPO    "owner/repo" (defaults to yyl/blog)
//   GITHUB_BRANCH  Default branch (defaults to main)
//
// Request (POST /api/img_upload):
//   Authorization: Bearer <UPLOAD_TOKEN>
//   { "post": "my-post-slug" (optional),
//     "files": [{ "name": "IMG_0790", "data": "<base64 webp>" }] }
//
// Target:
//   with "post"  -> content/posts/<post>/<name>.webp
//   without      -> static/staging/<name>.webp
//
// Name collisions are auto-renamed: IMG_0790.webp -> IMG_0790_2.webp, ...

const DEFAULT_REPO = 'yyl/blog';
const DEFAULT_BRANCH = 'main';
const SITE_BASE = 'https://www.mildlyjournaling.com';
const STAGING_DIR = 'static/staging';
const MAX_FILES = 10;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_RENAME_SUFFIX = 99;

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function timingSafeEquals(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

function isValidSlug(slug) {
    if (!slug || typeof slug !== 'string') return false;
    if (slug.length > 100) return false;
    return /^[a-z0-9-]+$/i.test(slug) && !slug.startsWith('-');
}

// Reduce any user-supplied name to a safe .webp filename (no path components).
function sanitizeFilename(name) {
    let base = String(name || '').split(/[\\/]/).pop();
    base = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/\.{2,}/g, '.');
    base = base.replace(/^_+|_+$/g, '');
    if (!base || base === '.') return null;
    const lower = base.toLowerCase();
    if (lower.endsWith('.webp')) return base;
    const ext = base.match(/\.(jpe?g|png|heic|heif|webp)$/i);
    if (ext) return base.slice(0, ext.index) + '.webp';
    return base + '.webp';
}

function isValidBase64(s) {
    if (typeof s !== 'string' || s.length === 0) return false;
    if (s.length % 4 !== 0) return false;
    return /^[A-Za-z0-9+/]+={0,2}$/.test(s);
}

function siteUrl(repoPath) {
    if (repoPath.startsWith('static/')) {
        return SITE_BASE + '/' + repoPath.slice('static/'.length);
    }
    if (repoPath.startsWith('content/posts/')) {
        return SITE_BASE + '/posts/' + repoPath.slice('content/posts/'.length);
    }
    return null;
}

async function listDirNames(env, dir, branch, token) {
    const res = await fetch(
        `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${dir}?ref=${branch}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
    );
    if (res.status === 404) return new Set();
    if (!res.ok) throw new Error(`GitHub dir listing failed: HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) return new Set();
    return new Set(data.map((f) => f.name));
}

async function createFile(env, path, base64, branch, token, message) {
    const res = await fetch(
        `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message, content: base64, branch }),
        }
    );
    if (res.status === 409) return 'conflict';
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub commit failed: HTTP ${res.status} ${text.slice(0, 300)}`);
    }
    return 'created';
}

function pickName(name, taken) {
    const stem = name.slice(0, name.length - '.webp'.length);
    if (!taken.has(name)) return name;
    for (let i = 2; i <= MAX_RENAME_SUFFIX; i++) {
        const candidate = `${stem}_${i}.webp`;
        if (!taken.has(candidate)) return candidate;
    }
    return null;
}

async function onRequestGet(context) {
    const { request, env } = context;
    const secret = env.UPLOAD_TOKEN;
    if (!secret) return json({ error: 'Endpoint not configured (UPLOAD_TOKEN missing)' }, 503);
    const header = request.headers.get('authorization') || '';
    const url = new URL(request.url);
    const presented =
        header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token') || '';
    if (!timingSafeEquals(presented, secret)) return json({ error: 'Unauthorized' }, 401);
    return json({
        ok: true,
        usage: 'POST { "post": "<slug>" (optional), "files": [{ "name", "data": "<base64 webp>" }] }',
        default_target: `${STAGING_DIR}/<name>.webp`,
    });
}

async function onRequestPost(context) {
    const { request, env } = context;

    const secret = env.UPLOAD_TOKEN;
    if (!secret) return json({ error: 'Endpoint not configured (UPLOAD_TOKEN missing)' }, 503);
    const header = request.headers.get('authorization') || '';
    const url = new URL(request.url);
    const presented =
        header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token') || '';
    if (!timingSafeEquals(presented, secret)) return json({ error: 'Unauthorized' }, 401);

    if (!env.GITHUB_TOKEN) {
        return json({ error: 'Endpoint not configured (GITHUB_TOKEN missing)' }, 503);
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Invalid JSON body' }, 400);
    }

    const files = Array.isArray(body.files) ? body.files : [];
    if (files.length === 0 || files.length > MAX_FILES) {
        return json({ error: `Provide 1-${MAX_FILES} files` }, 400);
    }

    let targetDir = STAGING_DIR;
    let post = null;
    if (body.post !== undefined && body.post !== null && body.post !== '') {
        if (!isValidSlug(body.post)) {
            return json({ error: 'Invalid post slug (alphanumeric and hyphens only)' }, 400);
        }
        post = body.post.toLowerCase();
        targetDir = `content/posts/${post}`;
    }

    for (const f of files) {
        if (typeof f !== 'object' || f === null || !isValidBase64(f.data)) {
            return json({ error: 'Each file needs "data" as a base64 string' }, 400);
        }
        if (Math.floor(f.data.length * 3 / 4) > MAX_FILE_BYTES) {
            return json({ error: 'File too large (15 MB max per image)' }, 400);
        }
        if (!sanitizeFilename(f.name)) {
            return json({ error: 'Invalid file name' }, 400);
        }
    }

    const branch = env.GITHUB_BRANCH || DEFAULT_BRANCH;
    const token = env.GITHUB_TOKEN;

    let taken;
    try {
        taken = await listDirNames(env, targetDir, branch, token);
    } catch (exc) {
        return json({ error: String(exc.message || exc) }, 502);
    }

    const results = [];
    for (const f of files) {
        const base = sanitizeFilename(f.name);
        const name = pickName(base, taken);
        if (!name) {
            results.push({ name: base, error: 'Too many name collisions' });
            continue;
        }
        const path = `${targetDir}/${name}`;
        try {
            await createFile(env, path, f.data, branch, token, `Add ${name} via /img_upload`);
        } catch (exc) {
            results.push({ name: base, error: String(exc.message || exc) });
            continue;
        }
        taken.add(name);
        results.push({ name, path, url: siteUrl(path) });
    }

    const okCount = results.filter((r) => r.url).length;
    return json(
        { target: targetDir, files: results, committed: okCount },
        okCount > 0 ? 201 : 422
    );
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { onRequestGet, onRequestPost };
}

export { onRequestGet, onRequestPost };
