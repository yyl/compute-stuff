# compute-stuff

## Setup

This repo uses a git submodule for the theme. After cloning, run:

```sh
git submodule update --init --recursive
```

## Local preview

From the repository root, run:

```sh
hugo server -D --renderToMemory
```

Open the URL printed by Hugo (normally `http://localhost:1313/`). The server
uses local URLs automatically; keep the production `baseURL` in `hugo.toml`.
Rendering to memory avoids serving stale files from `public/` and leaves that
generated directory untouched.

`-D` includes posts with `draft = true`. Add `-F` to preview future-dated posts
as well. A post with `draft = false` is eligible for production builds once
its publication date is reached.

If pages are missing or links lead to the deployed site, check that
`themes/paper/` is populated using the setup command above, restart the server,
and open its printed URL instead of an HTML file in `public/`.
