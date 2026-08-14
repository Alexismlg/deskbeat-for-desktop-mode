<?php
/**
 * Deskbeat — full-player native window.
 *
 * Registers the `desktop-mode-music-player` native OpenStation window
 * (the "big screen" player) plus its script + style. The renderer lives
 * in JS (`src/player-window.ts` → `assets/js/music-player-window[.min].js`),
 * which registers a callback on `window.openStationNativeWindows`. Uses
 * only OpenStation's public API (`openstation_register_window`), so it
 * degrades silently when the host isn't present.
 *
 * @package MusicPlayerForDesktopMode
 * @since   1.2.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the full-player window's script + style handles.
 *
 * @since 1.2.0
 *
 * @return void
 */
function desktop_mode_music_player_register_window_assets() {
	$suffix  = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '' : '.min';
	$version = MUSIC_PLAYER_FOR_DESKTOP_MODE_VERSION;
	$dir     = MUSIC_PLAYER_FOR_DESKTOP_MODE_DIR;
	$url     = MUSIC_PLAYER_FOR_DESKTOP_MODE_URL;

	$js_path  = $dir . 'assets/js/music-player-window' . $suffix . '.js';
	$css_path = $dir . 'assets/js/music-player-window' . $suffix . '.css';

	wp_register_style(
		'deskbeat-player-window',
		$url . 'assets/js/music-player-window' . $suffix . '.css',
		array(),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	wp_register_script(
		'deskbeat-player-window',
		$url . 'assets/js/music-player-window' . $suffix . '.js',
		// `openstation` so `wp.os.*` is on the global before the window
		// renders; `wp-i18n` for translations.
		array( 'wp-i18n', 'openstation' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
	wp_set_script_translations(
		'deskbeat-player-window',
		'deskbeat-for-desktop-mode',
		$dir . 'languages'
	);
}
add_action( 'init', 'desktop_mode_music_player_register_window_assets', 5 );

/**
 * Register the full-player native window with OpenStation.
 *
 * The window id matches the one the widget opens via
 * `wp.os.openNativeWindow( 'desktop-mode-music-player' )`.
 *
 * @since 1.2.0
 *
 * @return void
 */
function desktop_mode_music_player_register_window() {
	if ( ! function_exists( 'openstation_register_window' ) ) {
		return;
	}

	openstation_register_window(
		'desktop-mode-music-player',
		array(
			'title'      => __( 'Music', 'deskbeat-for-desktop-mode' ),
			'icon'       => 'dashicons-format-audio',
			'script'     => 'deskbeat-player-window',
			'width'      => 420,
			'height'     => 600,
			'min_width'  => 320,
			'min_height' => 420,
			// Shipped to the JS bundle; read via `wp.os.getWindowConfig()`.
			'config'     => desktop_mode_music_player_js_config(),
			'template'   => 'desktop_mode_music_player_window_template',
		)
	);
}
add_action( 'init', 'desktop_mode_music_player_register_window', 20 );

/**
 * Server-rendered placeholder body. The JS renderer replaces it on open;
 * this is what shows for the brief moment before the bundle mounts.
 *
 * @since 1.2.0
 *
 * @return void
 */
function desktop_mode_music_player_window_template() {
	echo '<div class="deskbeat-player__gate"><p class="deskbeat-player__hint">'
		. esc_html__( 'Loading the player…', 'deskbeat-for-desktop-mode' )
		. '</p></div>';
}

/**
 * Eagerly enqueue the window's CSS on OpenStation shell pages, so the
 * player is styled the instant it opens (the bundled CSS is a separate
 * file, not injected by the JS). Mirrors the widget's style enqueue.
 *
 * @since 1.2.0
 *
 * @return void
 */
function desktop_mode_music_player_enqueue_window_styles() {
	if ( function_exists( 'openstation_is_enabled' ) && ! openstation_is_enabled() ) {
		return;
	}
	if ( function_exists( 'openstation_is_chromeless_request' ) && openstation_is_chromeless_request() ) {
		return;
	}
	wp_enqueue_style( 'deskbeat-player-window' );
}
add_action( 'admin_enqueue_scripts', 'desktop_mode_music_player_enqueue_window_styles', 20 );
