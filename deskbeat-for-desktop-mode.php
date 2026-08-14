<?php
/**
 * Plugin Name:       Deskbeat for Desktop Mode
 * Description:       A now-playing widget for OpenStation (formerly Desktop Mode) that connects your Spotify account — playback controls, volume, and a browsable library, right on the desktop.
 * Version:           1.2.1
 * Requires at least: 6.5
 * Requires PHP:      7.4
 * Requires Plugins:  desktop-mode
 * Author:            Alexis Mora
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       deskbeat-for-desktop-mode
 * Domain Path:       /languages
 *
 * Not affiliated with or endorsed by Spotify. "Spotify" is a trademark
 * of Spotify AB. Each site connects using its own Spotify Developer app
 * credentials, entered by an administrator; no credentials ship with
 * this plugin.
 *
 * @package MusicPlayerForDesktopMode
 */

defined( 'ABSPATH' ) || exit;

define( 'MUSIC_PLAYER_FOR_DESKTOP_MODE_FILE', __FILE__ );
define( 'MUSIC_PLAYER_FOR_DESKTOP_MODE_DIR', plugin_dir_path( __FILE__ ) );
define( 'MUSIC_PLAYER_FOR_DESKTOP_MODE_URL', plugin_dir_url( __FILE__ ) );
define( 'MUSIC_PLAYER_FOR_DESKTOP_MODE_VERSION', '1.2.1' );

require_once MUSIC_PLAYER_FOR_DESKTOP_MODE_DIR . 'includes/spotify.php';
require_once MUSIC_PLAYER_FOR_DESKTOP_MODE_DIR . 'includes/rest.php';
require_once MUSIC_PLAYER_FOR_DESKTOP_MODE_DIR . 'includes/widget.php';
require_once MUSIC_PLAYER_FOR_DESKTOP_MODE_DIR . 'includes/player-window.php';
