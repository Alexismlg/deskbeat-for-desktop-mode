# WordPress.org listing assets

These files are **not** shipped inside the plugin zip. They map to the
plugin's SVN **`assets/`** folder and power the wordpress.org listing
page (icon, header banner, screenshots). Drop the PNGs here with the
exact names below.

## Icon (required)
- `icon-128x128.png` — 128×128
- `icon-256x256.png` — 256×256 (retina)
- *(or)* `icon.svg` — scalable, preferred if you have vector art

## Banner (recommended)
- `banner-772x250.png` — 772×250
- `banner-1544x500.png` — 1544×500 (retina)

## Screenshots
PNG (or JPG), named `screenshot-1.png`, `screenshot-2.png`, … in order.
Each number maps to the matching caption in `readme.txt`'s
`== Screenshots ==` section:

1. `screenshot-1.png` — Now playing (controls, shuffle/repeat, seek, volume)
2. `screenshot-2.png` — Browse library (Queue / Liked / Top / Recent / Playlists)
3. `screenshot-3.png` — Search songs and artists
4. `screenshot-4.png` — One-click "Connect Spotify"
5. `screenshot-5.png` — Admin setup (Client ID / Secret)

Tips: capture the widget on the desktop at a comfortable size; PNG,
reasonable width (~1200px is plenty), keep files lean. Keep the order
in sync with the readme captions — if you add/remove one, update both.

## How these reach wordpress.org
On SVN publish, the contents of this folder go to the repo's
`assets/` directory (sibling of `trunk/`), which is what the listing
page reads. If you use a GitHub Action to deploy (e.g.
`10up/action-wordpress-plugin-deploy`), point its `ASSETS_DIR` at
`.wordpress-org`.
