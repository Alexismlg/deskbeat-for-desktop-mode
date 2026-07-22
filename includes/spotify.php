<?php
/**
 * Desktop Mode — Music Player: Spotify token + Web API layer.
 *
 * Owns everything that touches Spotify credentials or tokens, so no
 * other file in the module has to know how the OAuth tokens are stored
 * or refreshed:
 *
 *   - the app credentials (client id / secret) live in site options,
 *     editable by an administrator from the window's setup screen;
 *   - per-user OAuth tokens live in user meta, written by the OAuth
 *     relay's `on_success` callback (see `bootstrap.php`);
 *   - `desktop_mode_music_player_api()` is the single choke point for
 *     Spotify Web API calls — it injects a valid bearer token,
 *     transparently refreshes an expired one, and never leaks the
 *     refresh token or client secret to the caller.
 *
 * The client secret and refresh token stay server-side. The only value
 * that ever reaches the browser is a short-lived access token, and only
 * via the `/token` REST route the Web Playback SDK requires.
 *
 * @package WPDesktopMode
 * @since   0.9.7
 */

defined( 'ABSPATH' ) || exit;

/**
 * Service slug shared by the OAuth relay registration and the REST
 * layer. Kept in one constant so a rename can't drift the two apart.
 */
const DESKTOP_MODE_MUSIC_PLAYER_SERVICE = 'spotify';

/** Site option holding the Spotify app client id. */
const DESKTOP_MODE_MUSIC_PLAYER_CLIENT_ID_OPTION = 'desktop_mode_music_player_client_id';

/** Site option holding the Spotify app client secret. */
const DESKTOP_MODE_MUSIC_PLAYER_CLIENT_SECRET_OPTION = 'desktop_mode_music_player_client_secret';

/** User meta key holding the per-user OAuth token bundle. */
const DESKTOP_MODE_MUSIC_PLAYER_TOKENS_META = '_desktop_mode_music_player_tokens';

/** Spotify authorize endpoint. */
const DESKTOP_MODE_MUSIC_PLAYER_AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';

/** Spotify token endpoint. */
const DESKTOP_MODE_MUSIC_PLAYER_TOKEN_URL = 'https://accounts.spotify.com/api/token';

/** Spotify Web API base. */
const DESKTOP_MODE_MUSIC_PLAYER_API_BASE = 'https://api.spotify.com/v1';

/**
 * OAuth scopes we request. `streaming` + `user-read-email` +
 * `user-read-private` are what the Web Playback SDK needs (and it also
 * gates on a Premium subscription); the `*-playback-state` /
 * `*-currently-playing` scopes drive the now-playing panel and the
 * transport controls for free accounts controlling other devices.
 */
const DESKTOP_MODE_MUSIC_PLAYER_SCOPE = 'user-read-private user-read-email user-read-playback-state user-modify-playback-state user-read-currently-playing streaming user-library-read user-top-read user-read-recently-played playlist-read-private';

/**
 * Read the configured Spotify app credentials.
 *
 * @since 0.9.7
 *
 * @return array{id:string,secret:string}
 */
function desktop_mode_music_player_get_client() {
	return array(
		'id'     => (string) get_option( DESKTOP_MODE_MUSIC_PLAYER_CLIENT_ID_OPTION, '' ),
		'secret' => (string) get_option( DESKTOP_MODE_MUSIC_PLAYER_CLIENT_SECRET_OPTION, '' ),
	);
}

/**
 * Whether an administrator has entered the Spotify app credentials.
 *
 * @since 0.9.7
 *
 * @return bool
 */
function desktop_mode_music_player_is_configured() {
	$client = desktop_mode_music_player_get_client();
	return '' !== $client['id'] && '' !== $client['secret'];
}

/**
 * Persist (or clear) the Spotify app credentials. Admin-only surface —
 * the capability check lives on the REST route, this is the storage
 * primitive.
 *
 * @since 0.9.7
 *
 * @param string $client_id     Spotify app client id.
 * @param string $client_secret Spotify app client secret.
 * @return void
 */
function desktop_mode_music_player_save_client( $client_id, $client_secret ) {
	update_option( DESKTOP_MODE_MUSIC_PLAYER_CLIENT_ID_OPTION, sanitize_text_field( (string) $client_id ), false );
	update_option( DESKTOP_MODE_MUSIC_PLAYER_CLIENT_SECRET_OPTION, sanitize_text_field( (string) $client_secret ), false );
}

/**
 * Normalize a raw Spotify token response into our stored shape and save
 * it against the user. Called from the OAuth relay's `on_success` and
 * from the refresh path.
 *
 * Spotify only returns a fresh `refresh_token` on the initial exchange;
 * refresh responses often omit it, so we preserve the existing one when
 * the payload doesn't carry a replacement.
 *
 * @since 0.9.7
 *
 * @param int   $user_id User the tokens belong to.
 * @param array $tokens  Raw decoded token endpoint response.
 * @return void
 */
function desktop_mode_music_player_store_tokens( $user_id, array $tokens ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return;
	}

	$existing = desktop_mode_music_player_get_tokens( $user_id );

	$access_token  = isset( $tokens['access_token'] ) ? (string) $tokens['access_token'] : '';
	$refresh_token = isset( $tokens['refresh_token'] ) && '' !== (string) $tokens['refresh_token']
		? (string) $tokens['refresh_token']
		: ( is_array( $existing ) ? (string) ( $existing['refresh_token'] ?? '' ) : '' );
	$expires_in    = isset( $tokens['expires_in'] ) ? (int) $tokens['expires_in'] : 3600;

	$stored = array(
		'access_token'  => $access_token,
		'refresh_token' => $refresh_token,
		'scope'         => isset( $tokens['scope'] ) ? (string) $tokens['scope'] : DESKTOP_MODE_MUSIC_PLAYER_SCOPE,
		'token_type'    => isset( $tokens['token_type'] ) ? (string) $tokens['token_type'] : 'Bearer',
		// Refresh a minute early so we never hand out a token that
		// expires mid-request.
		'expires_at'    => time() + max( 0, $expires_in - 60 ),
	);

	update_user_meta( $user_id, DESKTOP_MODE_MUSIC_PLAYER_TOKENS_META, $stored );
}

/**
 * Read the stored token bundle for a user.
 *
 * @since 0.9.7
 *
 * @param int $user_id User id.
 * @return array|null Token bundle, or null when the user hasn't connected.
 */
function desktop_mode_music_player_get_tokens( $user_id ) {
	$tokens = get_user_meta( (int) $user_id, DESKTOP_MODE_MUSIC_PLAYER_TOKENS_META, true );
	if ( ! is_array( $tokens ) || empty( $tokens['access_token'] ) ) {
		return null;
	}
	return $tokens;
}

/**
 * Forget a user's Spotify connection.
 *
 * @since 0.9.7
 *
 * @param int $user_id User id.
 * @return void
 */
function desktop_mode_music_player_clear_tokens( $user_id ) {
	delete_user_meta( (int) $user_id, DESKTOP_MODE_MUSIC_PLAYER_TOKENS_META );
}

/**
 * Whether the user currently has a Spotify connection on file.
 *
 * @since 0.9.7
 *
 * @param int $user_id User id.
 * @return bool
 */
function desktop_mode_music_player_is_connected( $user_id ) {
	return null !== desktop_mode_music_player_get_tokens( $user_id );
}

/**
 * Exchange the stored refresh token for a new access token.
 *
 * @since 0.9.7
 *
 * @param int $user_id User id.
 * @return true|WP_Error True on success, WP_Error on any failure.
 */
function desktop_mode_music_player_refresh_tokens( $user_id ) {
	$tokens = desktop_mode_music_player_get_tokens( $user_id );
	if ( null === $tokens || '' === (string) ( $tokens['refresh_token'] ?? '' ) ) {
		return new WP_Error(
			'desktop_mode_music_player_no_refresh_token',
			__( 'No Spotify refresh token on file — reconnect the account.', 'music-player-for-desktop-mode' )
		);
	}

	$client = desktop_mode_music_player_get_client();
	if ( '' === $client['id'] || '' === $client['secret'] ) {
		return new WP_Error(
			'desktop_mode_music_player_not_configured',
			__( 'Spotify app credentials are not configured.', 'music-player-for-desktop-mode' )
		);
	}

	$response = wp_remote_post(
		DESKTOP_MODE_MUSIC_PLAYER_TOKEN_URL,
		array(
			'timeout' => 15,
			'headers' => array(
				// Spotify accepts credentials in the body, but the Basic
				// header is the documented form for the refresh grant.
				'Authorization' => 'Basic ' . base64_encode( $client['id'] . ':' . $client['secret'] ),
				'Content-Type'  => 'application/x-www-form-urlencoded',
				'Accept'        => 'application/json',
			),
			'body'    => array(
				'grant_type'    => 'refresh_token',
				'refresh_token' => (string) $tokens['refresh_token'],
			),
		)
	);
	if ( is_wp_error( $response ) ) {
		return $response;
	}

	$status = (int) wp_remote_retrieve_response_code( $response );
	$body   = json_decode( wp_remote_retrieve_body( $response ), true );
	if ( $status < 200 || $status >= 300 || ! is_array( $body ) ) {
		return new WP_Error(
			'desktop_mode_music_player_refresh_failed',
			sprintf(
				/* translators: %d: HTTP status code. */
				__( 'Spotify token refresh failed with HTTP %d.', 'music-player-for-desktop-mode' ),
				$status
			),
			array( 'status' => $status )
		);
	}

	desktop_mode_music_player_store_tokens( $user_id, $body );
	return true;
}

/**
 * Return a currently-valid access token for the user, refreshing it
 * first if it has expired.
 *
 * @since 0.9.7
 *
 * @param int $user_id User id.
 * @return string|WP_Error Access token, or WP_Error when unavailable.
 */
function desktop_mode_music_player_valid_access_token( $user_id ) {
	$tokens = desktop_mode_music_player_get_tokens( $user_id );
	if ( null === $tokens ) {
		return new WP_Error(
			'desktop_mode_music_player_not_connected',
			__( 'This account is not connected to Spotify.', 'music-player-for-desktop-mode' ),
			array( 'status' => 409 )
		);
	}

	if ( time() >= (int) ( $tokens['expires_at'] ?? 0 ) ) {
		$refreshed = desktop_mode_music_player_refresh_tokens( $user_id );
		if ( is_wp_error( $refreshed ) ) {
			return $refreshed;
		}
		$tokens = desktop_mode_music_player_get_tokens( $user_id );
		if ( null === $tokens ) {
			return new WP_Error(
				'desktop_mode_music_player_not_connected',
				__( 'This account is not connected to Spotify.', 'music-player-for-desktop-mode' ),
				array( 'status' => 409 )
			);
		}
	}

	return (string) $tokens['access_token'];
}

/**
 * Make an authenticated Spotify Web API request on behalf of a user.
 *
 * Handles the bearer token, one transparent retry after a 401 (in case
 * the token was revoked or expired between the freshness check and the
 * call), and JSON encode/decode. Returns a normalized envelope so the
 * REST layer can pass Spotify's own status codes straight through.
 *
 * @since 0.9.7
 *
 * @param int    $user_id User id.
 * @param string $method  HTTP method (GET, PUT, POST…).
 * @param string $path    API path beginning with a slash, e.g. `/me`.
 * @param array  $args {
 *     Optional request extras.
 *
 *     @type array $query Query args appended to the URL.
 *     @type array $body  Body serialized as JSON for write requests.
 * }
 * @param bool   $is_retry Internal — prevents infinite refresh loops.
 * @return array{status:int,body:mixed}|WP_Error
 */
function desktop_mode_music_player_api( $user_id, $method, $path, array $args = array(), $is_retry = false ) {
	$token = desktop_mode_music_player_valid_access_token( $user_id );
	if ( is_wp_error( $token ) ) {
		return $token;
	}

	$url = DESKTOP_MODE_MUSIC_PLAYER_API_BASE . $path;
	if ( ! empty( $args['query'] ) && is_array( $args['query'] ) ) {
		// WordPress's `add_query_arg` does NOT URL-encode values, so
		// pre-encode each one (spaces, commas in `type=track,artist`,
		// etc.) — otherwise a raw space corrupts the query string.
		$url = add_query_arg( rawurlencode_deep( $args['query'] ), $url );
	}

	$request = array(
		'method'  => strtoupper( (string) $method ),
		'timeout' => 15,
		'headers' => array(
			'Authorization' => 'Bearer ' . $token,
			'Accept'        => 'application/json',
		),
	);
	if ( isset( $args['body'] ) ) {
		$request['headers']['Content-Type'] = 'application/json';
		$request['body']                    = wp_json_encode( $args['body'] );
	} elseif ( 'GET' !== $request['method'] ) {
		// Spotify's PUT endpoints (play / pause) reject a body-less
		// request with HTTP 411 Length Required. Send an explicit empty
		// body + zero Content-Length so every write call carries the
		// header, even when there is nothing to send.
		$request['body']                      = '';
		$request['headers']['Content-Length'] = '0';
	}

	$response = wp_remote_request( $url, $request );
	if ( is_wp_error( $response ) ) {
		return $response;
	}

	$status = (int) wp_remote_retrieve_response_code( $response );

	// A 401 after our freshness check means the token was invalidated
	// server-side. Refresh once and retry the exact same call.
	if ( 401 === $status && ! $is_retry ) {
		$refreshed = desktop_mode_music_player_refresh_tokens( $user_id );
		if ( ! is_wp_error( $refreshed ) ) {
			return desktop_mode_music_player_api( $user_id, $method, $path, $args, true );
		}
	}

	$raw  = wp_remote_retrieve_body( $response );
	$body = '' === $raw ? null : json_decode( $raw, true );

	return array(
		'status' => $status,
		'body'   => $body,
	);
}
