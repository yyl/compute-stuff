# /// script
# requires-python = ">=3.10"
# dependencies = ["lxml>=5,<7"]
# ///
"""Create a Buttondown draft from one published monthly wrap-up."""

import argparse
import json
import os
import sys
import xml.etree.ElementTree as ET
from html import escape
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from lxml import html


def draft_payload(posts_dir, slug):
    posts = json.loads((posts_dir / "index.json").read_text())
    post = next((post for post in posts if post["slug"] == slug), None)
    if not post or post["draft"] or not {"monthly", "wrap-up"}.issubset(post["tags"]):
        raise SystemExit("Choose a published post tagged both monthly and wrap-up.")

    url = post["permalink"]
    items = ET.parse(posts_dir / "index.xml").iter("item")
    item = next((item for item in items if item.findtext("link") == url), None)
    if item is None or not item.findtext("description"):
        raise SystemExit("The post body is missing. Rebuild the site with hugo.")

    article = html.fragment_fromstring(item.findtext("description"), create_parent="div")
    article.make_links_absolute(url)
    for image in article.iter("img"):
        image.attrib.pop("srcset", None)  # Use the absolute src in email clients.
    body = html.tostring(article, encoding="unicode")
    return {
        "status": "draft",
        "subject": post["title"],
        "slug": slug,
        "canonical_url": url,
        "body": body + f'<p><a href="{escape(url, quote=True)}">Read on Mildly Journaling</a></p>',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("slug", help="Post slug, for example wrap-up-09-2026")
    parser.add_argument("--preview", action="store_true", help="Print the draft HTML locally")
    args = parser.parse_args()
    posts_dir = Path(__file__).resolve().parents[1] / "build/newsletter/posts"
    if not (posts_dir / "index.json").exists():
        parser.exit(1, "Build first with: hugo --destination build/newsletter\n")
    payload = draft_payload(posts_dir, args.slug)
    if args.preview:
        print(payload["body"])
        return
    key = os.environ.get("BUTTONDOWN_API_KEY")
    if not key:
        parser.exit(1, "Set BUTTONDOWN_API_KEY before creating a draft.\n")
    request = Request(
        "https://api.buttondown.com/v1/emails",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Token {key}", "Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=30) as response:
            print("Created Buttondown draft:", json.load(response)["id"])
    except HTTPError as exc:
        sys.exit(f"Buttondown returned {exc.code}: {exc.read().decode()}")


if __name__ == "__main__":
    main()
