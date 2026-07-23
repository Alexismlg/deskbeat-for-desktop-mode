=== Deskbeat for Desktop Mode ===
Contributors: alexismp
Tags: desktop-mode, spotify, music, player, widget
Requires at least: 6.5
Tested up to: 7.0
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

A now-playing widget for Desktop Mode that connects your Spotify account — playback controls, volume, and a browsable library on the desktop.

== Description ==

Deskbeat adds a compact music widget to the [Desktop Mode](https://wordpress.org/plugins/desktop-mode/) desktop. Once a site administrator connects a Spotify Developer app, each user links their own Spotify account with a single click and gets:

* **Now playing** — album art, track, and artist, updating live.
* **Transport controls** — play/pause, next, previous, shuffle, repeat, seek, and volume.
* **In-browser playback** — for Spotify Premium accounts, via the Spotify Web Playback SDK. Free accounts can see and control playback on their other devices.
* **Browse your library** — Queue, Liked Songs, Top tracks, Recently played, and Playlists, plus a search — all inside the widget, with infinite scroll.

This plugin requires the **Desktop Mode** plugin and works as a widget you add from the Desktop Mode widget picker.

= Not affiliated with Spotify =

This plugin is not affiliated with, endorsed by, or sponsored by Spotify. "Spotify" is a trademark of Spotify AB. It works with Spotify through the official Spotify Web API and Web Playback SDK, using credentials you provide.

= Credentials stay yours =

No Spotify credentials ship with this plugin. Each site connects using its **own** Spotify Developer app: an administrator creates a free app and enters its Client ID and Secret once. Tokens are stored server-side per user; the Client Secret and refresh tokens never reach the browser.

== External services ==

This plugin connects to **Spotify** so you can view and control your own Spotify playback from the Desktop Mode desktop. It relies on the following Spotify services:

1. **Spotify Web API** (`https://accounts.spotify.com`, `https://api.spotify.com`)
   - What it is: Spotify's official API for account authorization and playback control.
   - What is sent and when: after you click "Connect Spotify", the server exchanges an OAuth authorization code for access/refresh tokens; while the widget is open, it sends playback commands (play, pause, next, previous, seek, shuffle, repeat, volume, transfer) and reads your now-playing state, library, and search queries you type. Requests are made server-side on your behalf; your Client Secret and refresh token are never exposed to the browser.
   - No data is sent until you connect your account.

2. **Spotify Web Playback SDK** (`https://sdk.scdn.co/spotify-player.js`)
   - What it is: Spotify's official in-browser player library, loaded via a script tag (it must be served from Spotify's own domain; there is no self-hosted version).
   - What is sent and when: for Spotify Premium accounts, when you start in-browser playback it registers a playback device with Spotify and streams audio using a short-lived access token.

Use of Spotify is subject to Spotify's terms and privacy policy:
- Terms of Use: https://www.spotify.com/legal/end-user-agreement/
- Privacy Policy: https://www.spotify.com/legal/privacy-policy/
- Developer Terms (for the app credentials the administrator provides): https://developer.spotify.com/terms/

This plugin is not affiliated with, endorsed by, or sponsored by Spotify. No Spotify credentials are bundled — each site uses its own Spotify Developer app.

== Installation ==

1. Install and activate the **Desktop Mode** plugin.
2. Install and activate **Music Player for Desktop Mode**.
3. Create a free app at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
4. In the app's settings, add the Redirect URI shown in the widget's setup screen (it is your site's REST callback), and enable **Web API** and **Web Playback SDK**.
5. In Desktop Mode, add the **Music** widget from the widget picker. As an administrator, paste the app's Client ID and Client Secret in the setup screen.
6. Click **Connect Spotify** to link your account.

== Frequently Asked Questions ==

= Do end users need the Client ID/Secret? =

No. Only an administrator enters them once, per site. Everyone else just clicks "Connect Spotify".

= Why do I need to create a Spotify app? =

Spotify requires every integration to be a registered app with its own redirect URI. For security and to respect Spotify's rate limits, no shared credentials are bundled — each site uses its own app.

= Does in-browser playback work without Spotify Premium? =

No. The Spotify Web Playback SDK requires Premium. Free accounts can still view and control playback happening on their other devices.

== Screenshots ==

1. The Music widget: now playing with transport controls, shuffle/repeat, seek, and volume.
2. Browse your library — Queue, Liked Songs, Top tracks, Recently played, and Playlists, with infinite scroll.
3. Search songs and artists, and play with one click.
4. One-click "Connect Spotify" — end users never touch credentials.
5. Admin setup: enter the site's Spotify app Client ID and Secret once.

== Changelog ==

= 1.0.0 =
* Initial release: now-playing widget with controls, volume, library browsing, and search for Desktop Mode.
