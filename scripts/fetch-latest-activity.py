"""Write one display record from Readwise Reader or Overcast."""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import time
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree


def fetch(url, header, credential):
    request = Request(url)
    request.add_unredirected_header(header, credential)
    for attempt in range(3):
        try:
            with urlopen(request, timeout=30) as response:
                return response.read()
        except HTTPError as error:
            if error.code != 429 or attempt == 2:
                raise
            delay = error.headers.get("Retry-After", "")
            time.sleep(int(delay) if delay.isdigit() else 60)


def readwise_articles(token):
    params = {"location": "archive", "category": "article"}
    while True:
        url = "https://readwise.io/api/v3/list/?" + urlencode(params)
        page = json.loads(fetch(url, "Authorization", f"Token {token}"))
        for article in page["results"]:
            title, moved_at = article.get("title"), article.get("last_moved_at")
            if title and moved_at:
                url = article.get("source_url") or ""
                parsed = urlsplit(url)
                if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username is not None:
                    url = ""
                yield moved_at, {"title": title, "url": url, "detail": article.get("site_name") or article.get("author")}
        cursor = page["nextPageCursor"]
        if not cursor:
            return
        params["pageCursor"] = cursor


def overcast_episodes(export):
    root = ElementTree.fromstring(export)
    feeds = root.find("./body/outline[@text='feeds']")
    if root.tag != "opml" or feeds is None:
        raise ValueError("Overcast did not return an extended OPML export. Check OVERCAST_COOKIE.")
    for feed in feeds.findall("./outline[@type='rss']"):
        for episode in feed.findall("./outline[@type='podcast-episode'][@played='1']"):
            title, updated_at = episode.get("title"), episode.get("userUpdatedDate")
            if not title or not updated_at:
                continue
            url = episode.get("overcastUrl", "")
            if not re.fullmatch(r"https://overcast\.fm/\+[A-Za-z0-9_-]+", url):
                url = ""
            yield updated_at, {"title": title, "url": url, "detail": feed.get("title")}


def latest(records):
    dated = ((datetime.fromisoformat(date), record) for date, record in records)
    result = max(dated, key=lambda entry: (entry[0], entry[1]["title"], entry[1]["url"]), default=None)
    if result:
        date, record = result
        return {**record, "date": date.astimezone(timezone.utc).isoformat()}
    return {}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", choices=("readwise", "overcast"))
    args = parser.parse_args()
    if args.source == "readwise":
        token = os.getenv("READWISE_ACCESS_TOKEN")
        if not token:
            parser.error("READWISE_ACCESS_TOKEN is required")
        snapshot = latest(readwise_articles(token))
        filename = "latest_article.json"
    else:
        cookie = os.getenv("OVERCAST_COOKIE")
        if not cookie:
            parser.error("OVERCAST_COOKIE is required")
        export = fetch("https://overcast.fm/account/export_opml/extended", "Cookie", f"o={cookie}; qr=-")
        snapshot = latest(overcast_episodes(export))
        filename = "latest_podcast.json"

    output = Path(__file__).resolve().parents[1] / "data" / "activity" / filename
    output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
