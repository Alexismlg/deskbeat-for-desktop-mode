<?php
/**
 * Music Player for Desktop Mode — widget registration, assets, OAuth
 * relay, and JS config.
 *
 * Registers an OpenStation widget (`desktop-mode/music-player`) that
 * shows now-playing, transport controls, volume, and a Browse/Search
 * library — all driven by the site's own Spotify app credentials. Uses
 * only OpenStation's public APIs (`openstation_register_widget`, the
 * OAuth relay, and the REST layer), so it stays a clean add-on.
 *
 * @package MusicPlayerForDesktopMode
 * @since   1.0.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * The JS config blob the widget reads
 * (`window.desktopModeMusicPlayerConfig`).
 *
 * @since 1.0.0
 *
 * @return array
 */
function desktop_mode_music_player_js_config() {
	return array(
		'restNonce'    => wp_create_nonce( 'wp_rest' ),
		'restBase'     => esc_url_raw( rest_url( DESKTOP_MODE_MUSIC_PLAYER_REST_NAMESPACE ) ),
		'service'      => DESKTOP_MODE_MUSIC_PLAYER_SERVICE,
		'redirectUri'  => function_exists( 'openstation_oauth_redirect_uri' )
			? esc_url_raw( openstation_oauth_redirect_uri() )
			: '',
		'dashboardUrl' => 'https://developer.spotify.com/dashboard',
	);
}

/**
 * Register the Spotify OAuth relay once app credentials are configured.
 * Skipped (silently) when OpenStation isn't active or no credentials
 * are set yet — the widget's setup screen collects them.
 *
 * @since 1.0.0
 *
 * @return void
 */
function music_player_for_desktop_mode_register_relay() {
	if (
		! function_exists( 'openstation_register_oauth_relay' )
		|| ! desktop_mode_music_player_is_configured()
	) {
		return;
	}

	$client = desktop_mode_music_player_get_client();

	openstation_register_oauth_relay(
		DESKTOP_MODE_MUSIC_PLAYER_SERVICE,
		array(
			'authorize_url' => DESKTOP_MODE_MUSIC_PLAYER_AUTHORIZE_URL,
			'token_url'     => DESKTOP_MODE_MUSIC_PLAYER_TOKEN_URL,
			'client_id'     => $client['id'],
			'client_secret' => $client['secret'],
			'scope'         => DESKTOP_MODE_MUSIC_PLAYER_SCOPE,
			'on_success'    => 'desktop_mode_music_player_store_tokens',
		)
	);
}
add_action( 'init', 'music_player_for_desktop_mode_register_relay', 5 );

/**
 * Register the widget's script + style handles.
 *
 * @since 1.0.0
 *
 * @return void
 */
function music_player_for_desktop_mode_register_assets() {
	$suffix  = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '' : '.min';
	$version = MUSIC_PLAYER_FOR_DESKTOP_MODE_VERSION;
	$dir     = MUSIC_PLAYER_FOR_DESKTOP_MODE_DIR;
	$url     = MUSIC_PLAYER_FOR_DESKTOP_MODE_URL;

	$js_path  = $dir . 'assets/js/music-player-widget' . $suffix . '.js';
	$css_path = $dir . 'assets/js/music-player-widget' . $suffix . '.css';

	wp_register_style(
		'deskbeat-for-desktop-mode',
		$url . 'assets/js/music-player-widget' . $suffix . '.css',
		array(),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	wp_register_script(
		'deskbeat-for-desktop-mode',
		$url . 'assets/js/music-player-widget' . $suffix . '.js',
		// `openstation` so `wp.os.*` is on the global before the
		// widget mounts.
		array( 'wp-i18n', 'openstation' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
	wp_set_script_translations(
		'deskbeat-for-desktop-mode',
		'deskbeat-for-desktop-mode',
		$dir . 'languages'
	);

	wp_localize_script(
		'deskbeat-for-desktop-mode',
		'desktopModeMusicPlayerConfig',
		desktop_mode_music_player_js_config()
	);
}
add_action( 'init', 'music_player_for_desktop_mode_register_assets', 5 );

/**
 * Eagerly enqueue the widget CSS on OpenStation shell pages (avoids a
 * flash of unstyled content before the lazy JS mounts).
 *
 * @since 1.0.0
 *
 * @return void
 */
function music_player_for_desktop_mode_enqueue_styles() {
	if ( function_exists( 'openstation_is_enabled' ) && ! openstation_is_enabled() ) {
		return;
	}
	if ( function_exists( 'openstation_is_chromeless_request' ) && openstation_is_chromeless_request() ) {
		return;
	}
	wp_enqueue_style( 'deskbeat-for-desktop-mode' );
}
add_action( 'admin_enqueue_scripts', 'music_player_for_desktop_mode_enqueue_styles', 20 );

/**
 * Announce the widget to OpenStation so it appears in the picker.
 *
 * @since 1.0.0
 *
 * @return void
 */
function music_player_for_desktop_mode_register_widget() {
	if ( ! function_exists( 'openstation_register_widget' ) ) {
		return;
	}

	openstation_register_widget(
		'desktop-mode/music-player',
		array(
			'label'          => __( 'Music', 'deskbeat-for-desktop-mode' ),
			'description'    => __( 'Now playing on Spotify, with controls, volume, and your library.', 'deskbeat-for-desktop-mode' ),
			'icon'           => 'dashicons-format-audio',
			'script'         => 'deskbeat-for-desktop-mode',
			'movable'        => true,
			'resizable'      => true,
			'min_width'      => 240,
			'min_height'     => 160,
			'default_width'  => 320,
			'default_height' => 220,
		)
	);
}
add_action( 'init', 'music_player_for_desktop_mode_register_widget', 6 );
