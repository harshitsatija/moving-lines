"""Write the X share page for the moving portrait.

    python3 tools/share.py https://your-host.example

Posting https://your-host.example/x/portrait/ on X shows a Player Card: on desktop the
piece itself (embed.html) runs inside the post, in a 480x480 iframe. Apps that don't
play cards show x/portrait/card.jpg and open the page, which forwards to the piece.
X needs absolute https URLs in these tags, and it caches cards: after changing them,
re-post or wait for the cache to refresh. The host must allow framing by x.com (no
X-Frame-Options: DENY, no frame-ancestors that exclude it).
"""
import html
import sys
from pathlib import Path

base = sys.argv[1].rstrip("/")
if not base.startswith("https://"):
    sys.exit("X only plays cards from https URLs")
e = lambda s: html.escape(s, quote=True)
title = "Moving Lines — a scribble portrait that boils under your cursor"
desc = "Pen lines and watercolour, redrawn four times a second. Move over the painting to make it scribble."
page = f"""<!doctype html>
<!-- Share page for X: written by tools/share.py, see there. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">

<meta name="twitter:card" content="player">
<meta name="twitter:title" content="{e(title)}">
<meta name="twitter:description" content="{e(desc)}">
<meta name="twitter:image" content="{base}/x/portrait/card.jpg">
<meta name="twitter:image:alt" content="A pen-and-watercolour portrait whose lines scribble and boil">
<meta name="twitter:player" content="{base}/embed.html">
<meta name="twitter:player:width" content="480">
<meta name="twitter:player:height" content="480">

<meta property="og:type" content="website">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:image" content="{base}/x/portrait/card.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="1200">
<meta property="og:url" content="{base}/x/portrait/">
<link rel="canonical" href="{base}/x/portrait/">
<meta http-equiv="refresh" content="0; url={base}/embed.html">
</head>
<body style="margin:0;background:#e6e5e2">
<!-- Crawlers read the tags above; people are sent on to the piece. -->
<a href="{base}/embed.html">Open the painting</a>
</body>
</html>
"""
out = Path(__file__).resolve().parent.parent / "x" / "portrait" / "index.html"
out.write_text(page)
print(f"wrote {out}\npost this link on X: {base}/x/portrait/")
