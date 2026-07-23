<?php
/**
 * Desktop Mode — Music Player: REST API.
 *
 * Namespace `desktop-mode-music-player/v1`. Everything the window bundle
 * needs, gated so tokens never leak:
 *
 *   GET  /state        connection + profile snapshot for the current user
 *   POST /settings     save the Spotify app credentials (admin only)
 *   POST /disconnect   forget the current user's Spotify connection
 *   GET  /token        short-lived access token for the Web Playback SDK
 *   GET  /now-playing  current playback state (proxied Spotify Web API)
 *   POST /play|pause|next|previous|transfer   transport controls
 *
 * The transport + now-playing routes are thin proxies over
 * {@see desktop_mode_music_player_api()} so Spotify's own status codes
 * and error bodies pass straight through to the client.
 *
 * @package WPDesktopMode
 * @since   0.9.7
 */

defined( 'ABSPATH' ) || exit;

const DESKTOP_MODE_MUSIC_PLAYER_REST_NAMESPACE = 'desktop-mode-music-player/v1';

/**
 * Permission gate for the per-user routes — any logged-in user.
 *
 * @since 0.9.7
 *
 * @return true|WP_Error
 */
function desktop_mode_music_player_rest_can_use() {
	if ( ! is_user_logged_in() ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'You must be logged in to use the music player.', 'deskbeat-for-desktop-mode' ),
			array( 'status' => 401 )
		);
	}
	return true;
}

/**
 * Permission gate for the credentials route — administrators only.
 *
 * @since 0.9.7
 *
 * @return true|WP_Error
 */
function desktop_mode_music_player_rest_can_configure() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'You need to manage options to configure the music player.', 'deskbeat-for-desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	return true;
}

/**
 * Register the module's REST routes.
 *
 * @since 0.9.7
 *
 * @return void
 */
function desktop_mode_music_player_register_rest_routes() {
	$ns = DESKTOP_MODE_MUSIC_PLAYER_REST_NAMESPACE;

	register_rest_route(
		$ns,
		'/state',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'desktop_mode_music_player_rest_state',
			'permission_callback' => 'desktop_mode_music_player_rest_can_use',
		)
	);

	register_rest_route(
		$ns,
		'/settings',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'desktop_mode_music_player_rest_save_settings',
			'permission_callback' => 'desktop_mode_music_player_rest_can_configure',
			'args'                => array(
				'clientId'     => array( 'type' => 'string', 'required' => true ),
				'clientSecret' => array( 'type' => 'string', 'required' => true ),
			),
		)
	);

	register_rest_route(
		$ns,
		'/disconnect',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'desktop_mode_music_player_rest_disconnect',
			'permission_callback' => 'desktop_mode_music_player_rest_can_use',
		)
	);

	register_rest_route(
		$ns,
		'/token',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'desktop_mode_music_player_rest_token',
			'permission_callback' => 'desktop_mode_music_player_rest_can_use',
		)
	);

	register_rest_route(
		$ns,
		'/now-playing',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'desktop_mode_music_player_rest_now_playing',
			'permission_callback' => 'desktop_mode_music_player_rest_can_use',
		)
	);

	$controls = array(
		'play'     => 'desktop_mode_music_player_rest_play',
		'pause'    => 'desktop_mode_music_player_rest_pause',
		'next'     => 'desktop_mode_music_player_rest_next',
		'previous' => 'desktop_mode_music_player_rest_previous',
		'transfer' => 'desktop_mode_music_player_rest_transfer',
		'shuffle'  => 'desktop_mode_music_player_rest_shuffle',
		'repeat'   => 'desktop_mode_music_player_rest_repeat',
		'seek'     => 'desktop_mode_music_player_rest_seek',
		'volume'   => 'desktop_mode_music_player_rest_volume',
	);
	foreach ( $controls as $route => $callback ) {
		register_rest_route(
			$ns,
			'/' . $route,
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => $callback,
				'permission_callback' => 'desktop_mode_music_player_rest_can_use',
			)
		);
	}

	// Browse lists — each returns a uniform `{ items: [...] }` payload
	// (see desktop_mode_music_player_normalize_list).
	$browse = array(
		'queue'           => 'desktop_mode_music_player_rest_browse_queue',
		'library'         => 'desktop_mode_music_player_rest_browse_library',
		'top'             => 'desktop_mode_music_player_rest_browse_top',
		'recently-played' => 'desktop_mode_music_player_rest_browse_recent',
		'playlists'       => 'desktop_mode_music_player_rest_browse_playlists',
		'search'          => 'desktop_mode_music_player_rest_search',
	);
	foreach ( $browse as $route => $callback ) {
		register_rest_route(
			$ns,
			'/' . $route,
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => $callback,
				'permission_callback' => 'desktop_mode_music_player_rest_can_use',
			)
		);
	}
}
add_action( 'rest_api_init', 'desktop_mode_music_player_register_rest_routes' );

/**
 * Turn the {@see desktop_mode_music_player_api()} envelope into a REST
 * response, passing Spotify's status code through. A 204 (common for
 * transport controls and an idle player) becomes an empty 200 so the
 * client always gets JSON it can read.
 *
 * @since 0.9.7
 *
 * @param array|WP_Error $result Envelope from the API helper.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_music_player_proxy_response( $result ) {
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	$status = (int) $result['status'];
	if ( $status < 200 || $status >= 300 ) {
		$message = sprintf(
			/* translators: %d: HTTP status code returned by Spotify. */
			__( 'Spotify request failed (HTTP %d).', 'deskbeat-for-desktop-mode' ),
			$status
		);
		if ( is_array( $result['body'] ) && isset( $result['body']['error']['message'] ) ) {
			$message = (string) $result['body']['error']['message'];
		}
		return new WP_Error(
			'desktop_mode_music_player_spotify_error',
			$message,
			array( 'status' => 200 === $status ? 502 : $status )
		);
	}
	return new WP_REST_Response(
		null === $result['body'] ? array( 'ok' => true ) : $result['body'],
		200
	);
}

/**
 * GET /state — connection + profile snapshot.
 *
 * @since 0.9.7
 *
 * @return WP_REST_Response
 */
function desktop_mode_music_player_rest_state() {
	$user_id = get_current_user_id();

	$state = array(
		'service'      => DESKTOP_MODE_MUSIC_PLAYER_SERVICE,
		'configured'   => desktop_mode_music_player_is_configured(),
		'canConfigure' => current_user_can( 'manage_options' ),
		'connected'    => desktop_mode_music_player_is_connected( $user_id ),
		'profile'      => null,
	);

	if ( $state['connected'] ) {
		$me = desktop_mode_music_player_api( $user_id, 'GET', '/me' );
		if ( ! is_wp_error( $me ) && 200 === (int) $me['status'] && is_array( $me['body'] ) ) {
			$images  = isset( $me['body']['images'] ) && is_array( $me['body']['images'] ) ? $me['body']['images'] : array();
			$image   = isset( $images[0]['url'] ) ? (string) $images[0]['url'] : '';
			$product = isset( $me['body']['product'] ) ? (string) $me['body']['product'] : '';

			$state['profile'] = array(
				'id'          => isset( $me['body']['id'] ) ? (string) $me['body']['id'] : '',
				'displayName' => isset( $me['body']['display_name'] ) ? (string) $me['body']['display_name'] : '',
				'product'     => $product,
				'isPremium'   => 'premium' === $product,
				'image'       => $image,
			);
		}
	}

	return new WP_REST_Response( $state, 200 );
}

/**
 * POST /settings — persist the Spotify app credentials (admin only).
 *
 * @since 0.9.7
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response
 */
function desktop_mode_music_player_rest_save_settings( WP_REST_Request $request ) {
	desktop_mode_music_player_save_client(
		(string) $request->get_param( 'clientId' ),
		(string) $request->get_param( 'clientSecret' )
	);
	return new WP_REST_Response(
		array( 'configured' => desktop_mode_music_player_is_configured() ),
		200
	);
}

/**
 * POST /disconnect — forget the current user's Spotify connection.
 *
 * @since 0.9.7
 *
 * @return WP_REST_Response
 */
function desktop_mode_music_player_rest_disconnect() {
	desktop_mode_music_player_clear_tokens( get_current_user_id() );
	return new WP_REST_Response( array( 'connected' => false ), 200 );
}

/**
 * GET /token — hand the Web Playback SDK a fresh access token.
 *
 * This is the one route that returns a Spotify token to the browser;
 * the SDK's `getOAuthToken` callback cannot run without it. The token
 * is short-lived and the refresh token / client secret never leave the
 * server.
 *
 * @since 0.9.7
 *
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_music_player_rest_token() {
	$token = desktop_mode_music_player_valid_access_token( get_current_user_id() );
	if ( is_wp_error( $token ) ) {
		return $token;
	}
	return new WP_REST_Response( array( 'accessToken' => $token ), 200 );
}

/**
 * GET /now-playing — current playback state.
 *
 * @since 0.9.7
 *
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_music_player_rest_now_playing() {
	return desktop_mode_music_player_proxy_response(
		desktop_mode_music_player_api(
			get_current_user_id(),
			'GET',
			'/me/player',
			array( 'query' => array( 'additional_types' => 'track,episode' ) )
		)
	);
}

/**
 * Build the optional `{ device_id }` query for transport controls, so
 * the caller can target the in-browser SDK device explicitly.
 *
 * @since 0.9.7
 *
 * @param WP_REST_Request $request Request.
 * @return array
 */
function desktop_mode_music_player_device_query( WP_REST_Request $request ) {
	$device_id = sanitize_text_field( (string) $request->get_param( 'deviceId' ) );
	return '' === $device_id ? array() : array( 'query' => array( 'device_id' => $device_id ) );
}

/**
 * POST /play — resume (or start) playback.
 *
 * @since 0.9.7
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_music_player_rest_play( WP_REST_Request $request ) {
	$args = desktop_mode_music_player_device_query( $request );

	// Optional: start a specific context/track. Absent → resume.
	$uris = $request->get_param( 'uris' );
	if ( is_array( $uris ) && ! empty( $uris ) ) {
		$args['body'] = array( 'uris' => array_map( 'sanitize_text_field', $uris ) );
	}
	$context = sanitize_text_field( (string) $request->get_param( 'contextUri' ) );
	if ( '' !== $context ) {
		$args['body'] = array( 'context_uri' => $context );
	}

	return desktop_mode_music_player_proxy_response(
		desktop_mode_music_player_api( get_current_user_id(), 'PUT', '/me/player/play', $args )
	);
}

/**
 * POST /pause — pause playback.
 *
 * @since 0.9.7
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_music_player_rest_pause( WP_REST_Request $request ) {
	return desktop_mode_music_player_proxy_response(
		desktop_mode_music_player_api(
			get_current_user_id(),
			'PUT',
			'/me/player/pause',
			desktop_mode_music_player_device_query( $request )
		)
	);
}

/**
 * POST /next — skip to the next track.
 *
 * @since 0.9.7
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_music_player_rest_next( WP_REST_Request $request ) {
	return desktop_mode_music_player_proxy_response(
		desktop_mode_music_player_api(
			get_current_user_id(),
			'POST',
			'/me/player/next',
			desktop_mode_music_player_device_query( $request )
		)
	);
}

/**
 * POST /previous — skip to the previous track.
 *
 * @since 0.9.7
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_music_player_rest_previous( WP_REST_Request $request ) {
	return desktop_mode_music_player_proxy_response(
		desktop_mode_music_player_api(
			get_current_user_id(),
			'POST',
			'/me/player/previous',
			desktop_mode_music_player_device_query( $request )
		)
	);
}

/**
 * POST /shuffle — toggle shuffle. Body: `{ state: bool, deviceId? }`.
 *
 * @since 0.9.7
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_music_player_rest_shuffle( WP_REST_Request $request ) {
	$query     = array( 'state' => $request->get_param( 'state' ) ? 'true' : 'false' );
	$device_id = sanitize_text_field( (string) $request->get_param( 'deviceId' ) );
	if ( '' !== $device_id ) {
		$query['device_id'] = $device_id;
	}
	return desktop_mode_music_player_proxy_response(
		desktop_mode_music_player_api(
			get_current_user_id(),
			'PUT',
			'/me/player/shuffle',
			array( 'query' => $query )
		)
	);
}

/**
 * POST /repeat — set repeat mode. Body: `{ state: off|track|context, deviceId? }`.
 *
 * @since 0.9.7
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_music_player_rest_repeat( WP_REST_Request $request ) {
	$state = (string) $request->get_param( 'state' );
	if ( ! in_array( $state, array( 'off', 'track', 'context' ), true ) ) {
		$state = 'off';
	}
	$query     = array( 'state' => $state );
	$device_id = sanitize_text_field( (string) $request->get_param( 'deviceId' ) );
	if ( '' !== $device_id ) {
		$query['device_id'] = $device_id;
	}
	return desktop_mode_music_player_proxy_response(
		desktop_mode_music_player_api(
			get_current_user_id(),
			'PUT',
			'/me/player/repeat',
			array( 'query' => $query )
		)
	);
}

/**
 * POST /seek — jump to a position in the current track. Body:
 * `{ positionMs: int, deviceId? }`.
 *
 * @since 0.9.7
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_music_player_rest_seek( WP_REST_Request $request ) {
	$position = (int) $request->get_param( 'positionMs' );
	if ( $position < 0 ) {
		$position = 0;
	}
	$query     = array( 'position_ms' => $position );
	$device_id = sanitize_text_field( (string) $request->get_param( 'deviceId' ) );
	if ( '' !== $device_id ) {
		$query['device_id'] = $device_id;
	}
	return desktop_mode_music_player_proxy_response(
		desktop_mode_music_player_api(
			get_current_user_id(),
			'PUT',
			'/me/player/seek',
			array( 'query' => $query )
		)
	);
}

/**
 * POST /volume — set the active device's volume. Body:
 * `{ volumePercent: 0-100, deviceId? }`.
 *
 * @since 0.9.7
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_music_player_rest_volume( WP_REST_Request $request ) {
	$volume = (int) $request->get_param( 'volumePercent' );
	$volume = max( 0, min( 100, $volume ) );
	$query  = array( 'volume_percent' => $volume );

	$device_id = sanitize_text_field( (string) $request->get_param( 'deviceId' ) );
	if ( '' !== $device_id ) {
		$query['device_id'] = $device_id;
	}
	return desktop_mode_music_player_proxy_response(
		desktop_mode_music_player_api(
			get_current_user_id(),
			'PUT',
			'/me/player/volume',
			array( 'query' => $query )
		)
	);
}

/**
 * POST /transfer — move playback onto a device (the in-browser SDK).
 *
 * @since 0.9.7
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_music_player_rest_transfer( WP_REST_Request $request ) {
	$device_id = sanitize_text_field( (string) $request->get_param( 'deviceId' ) );
	if ( '' === $device_id ) {
		return new WP_Error(
			'desktop_mode_music_player_missing_device',
			__( 'A device id is required to transfer playback.', 'deskbeat-for-desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	return desktop_mode_music_player_proxy_response(
		desktop_mode_music_player_api(
			get_current_user_id(),
			'PUT',
			'/me/player',
			array(
				'body' => array(
					'device_ids' => array( $device_id ),
					'play'       => (bool) $request->get_param( 'play' ),
				),
			)
		)
	);
}

/**
 * Normalize a Spotify track object into the uniform browse-list item
 * shape the client renders: `{ uri, name, subtitle, image, isContext }`.
 *
 * @since 0.9.7
 *
 * @param mixed $track Spotify track object.
 * @return array|null Normalized item, or null when the input isn't a track.
 */
function desktop_mode_music_player_normalize_track( $track ) {
	if ( ! is_array( $track ) || ! isset( $track['uri'] ) ) {
		return null;
	}
	$artists = array();
	if ( isset( $track['artists'] ) && is_array( $track['artists'] ) ) {
		foreach ( $track['artists'] as $artist ) {
			if ( isset( $artist['name'] ) ) {
				$artists[] = (string) $artist['name'];
			}
		}
	}
	$images = isset( $track['album']['images'] ) && is_array( $track['album']['images'] )
		? $track['album']['images']
		: array();
	$image = '';
	if ( ! empty( $images ) ) {
		$smallest = end( $images );
		$image    = isset( $smallest['url'] ) ? (string) $smallest['url'] : '';
	}
	return array(
		'uri'       => (string) $track['uri'],
		'name'      => isset( $track['name'] ) ? (string) $track['name'] : '',
		'subtitle'  => implode( ', ', $artists ),
		'image'     => $image,
		'isContext' => false,
	);
}

/**
 * Normalize a Spotify playlist object into a browse-list item. Playlists
 * play via `context_uri`, so `isContext` is true.
 *
 * @since 0.9.7
 *
 * @param array $playlist Spotify playlist object.
 * @return array Normalized item.
 */
function desktop_mode_music_player_normalize_playlist( array $playlist ) {
	$images = isset( $playlist['images'] ) && is_array( $playlist['images'] ) ? $playlist['images'] : array();
	$image  = isset( $images[0]['url'] ) ? (string) $images[0]['url'] : '';

	// Spotify nulls the `tracks` object for editorial / third-party
	// playlists under the metadata limits for newly-created apps, so a
	// missing count falls back to a plain "Playlist" label rather than
	// a misleading "0 tracks".
	$has_count = isset( $playlist['tracks']['total'] ) && is_numeric( $playlist['tracks']['total'] );
	$count     = $has_count ? (int) $playlist['tracks']['total'] : 0;
	$subtitle  = $has_count
		/* translators: %d: number of tracks in a playlist. */
		? sprintf( _n( '%d track', '%d tracks', $count, 'deskbeat-for-desktop-mode' ), $count )
		: __( 'Playlist', 'deskbeat-for-desktop-mode' );

	return array(
		'uri'       => isset( $playlist['uri'] ) ? (string) $playlist['uri'] : '',
		'name'      => isset( $playlist['name'] ) ? (string) $playlist['name'] : '',
		'subtitle'  => $subtitle,
		'image'     => $image,
		'isContext' => true,
	);
}

/**
 * Map a Spotify list response to `{ items: [...] }` given the source
 * type — each endpoint nests its tracks differently.
 *
 * @since 0.9.7
 *
 * @param string $type Source type: queue|top|saved|recent|playlists.
 * @param array  $body Decoded Spotify response body.
 * @return array{items:array}
 */
function desktop_mode_music_player_normalize_list( $type, $body ) {
	$items = array();
	if ( ! is_array( $body ) ) {
		return array( 'items' => $items );
	}

	switch ( $type ) {
		case 'queue':
			$tracks = array();
			if ( isset( $body['currently_playing'] ) ) {
				$tracks[] = $body['currently_playing'];
			}
			if ( isset( $body['queue'] ) && is_array( $body['queue'] ) ) {
				$tracks = array_merge( $tracks, $body['queue'] );
			}
			// Spotify pads the queue with the current track repeated when
			// playback was started from a single URI (no album/playlist
			// context), so de-dupe by URI — otherwise the queue shows the
			// same song many times.
			$seen = array();
			foreach ( $tracks as $track ) {
				$item = desktop_mode_music_player_normalize_track( $track );
				if ( $item && '' !== $item['uri'] && ! isset( $seen[ $item['uri'] ] ) ) {
					$seen[ $item['uri'] ] = true;
					$items[]              = $item;
				}
			}
			break;

		case 'top':
			foreach ( (array) ( $body['items'] ?? array() ) as $track ) {
				$item = desktop_mode_music_player_normalize_track( $track );
				if ( $item ) {
					$items[] = $item;
				}
			}
			break;

		case 'saved':
		case 'recent':
			foreach ( (array) ( $body['items'] ?? array() ) as $row ) {
				$track = isset( $row['track'] ) ? $row['track'] : null;
				$item  = $track ? desktop_mode_music_player_normalize_track( $track ) : null;
				if ( $item ) {
					$items[] = $item;
				}
			}
			break;

		case 'playlists':
			foreach ( (array) ( $body['items'] ?? array() ) as $playlist ) {
				if ( is_array( $playlist ) ) {
					$items[] = desktop_mode_music_player_normalize_playlist( $playlist );
				}
			}
			break;
	}

	return array( 'items' => $items );
}

/**
 * Compute the opaque `next` cursor the client echoes back to page. Null
 * when there are no more results (or the source doesn't paginate).
 *
 * Spotify's own `next` field (a URL) is the authoritative "more exists"
 * signal; offset sources advance by the page size, the cursor-based
 * recently-played source returns its `cursors.before` timestamp.
 *
 * @since 0.9.7
 *
 * @param string $type  Normalization type.
 * @param mixed  $body  Decoded Spotify response.
 * @param array  $query Query that produced this page.
 * @return string|null
 */
function desktop_mode_music_player_next_cursor( $type, $body, array $query ) {
	if ( 'queue' === $type || ! is_array( $body ) || empty( $body['next'] ) ) {
		return null;
	}
	if ( 'recent' === $type ) {
		return isset( $body['cursors']['before'] ) ? (string) $body['cursors']['before'] : null;
	}
	$offset = isset( $query['offset'] ) ? (int) $query['offset'] : 0;
	$limit  = isset( $query['limit'] ) ? (int) $query['limit'] : 50;
	return (string) ( $offset + $limit );
}

/**
 * Shared handler for the browse-list routes: proxy a GET (with the right
 * pagination arg for the source), pass Spotify errors through, and
 * normalize a 2xx body into `{ items: [...], next: cursor|null }`.
 *
 * The `cursor` request param is opaque to the client: for offset-based
 * sources (saved / top / playlists) it is the numeric offset; for the
 * cursor-based recently-played source it is the `before` timestamp; the
 * queue never paginates.
 *
 * @since 0.9.7
 *
 * @param string          $type    Normalization type.
 * @param string          $path    Spotify API path.
 * @param WP_REST_Request $request Request (for the `cursor` param).
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_music_player_browse_response( $type, $path, WP_REST_Request $request ) {
	$cursor = $request->get_param( 'cursor' );
	$cursor = ( null === $cursor ) ? '' : (string) $cursor;

	$query = array();
	if ( 'queue' !== $type ) {
		$query['limit'] = 50;
		if ( 'recent' === $type ) {
			if ( '' !== $cursor ) {
				$query['before'] = $cursor;
			}
		} else {
			$query['offset'] = '' === $cursor ? 0 : (int) $cursor;
		}
	}

	$result = desktop_mode_music_player_api(
		get_current_user_id(),
		'GET',
		$path,
		empty( $query ) ? array() : array( 'query' => $query )
	);
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	$status = (int) $result['status'];
	if ( $status < 200 || $status >= 300 ) {
		$message = sprintf(
			/* translators: %d: HTTP status code returned by Spotify. */
			__( 'Spotify request failed (HTTP %d).', 'deskbeat-for-desktop-mode' ),
			$status
		);
		if ( is_array( $result['body'] ) && isset( $result['body']['error']['message'] ) ) {
			$message = (string) $result['body']['error']['message'];
		}
		return new WP_Error(
			'desktop_mode_music_player_spotify_error',
			$message,
			array( 'status' => 200 === $status ? 502 : $status )
		);
	}
	if ( 204 === $status || null === $result['body'] ) {
		return new WP_REST_Response( array( 'items' => array(), 'next' => null ), 200 );
	}

	$payload         = desktop_mode_music_player_normalize_list( $type, $result['body'] );
	$payload['next'] = desktop_mode_music_player_next_cursor( $type, $result['body'], $query );
	return new WP_REST_Response( $payload, 200 );
}

/** GET /queue — the up-next queue (unpaginated). */
function desktop_mode_music_player_rest_browse_queue( WP_REST_Request $request ) {
	return desktop_mode_music_player_browse_response( 'queue', '/me/player/queue', $request );
}

/** GET /library — saved ("liked") tracks. */
function desktop_mode_music_player_rest_browse_library( WP_REST_Request $request ) {
	return desktop_mode_music_player_browse_response( 'saved', '/me/tracks', $request );
}

/** GET /top — the user's most-played tracks. */
function desktop_mode_music_player_rest_browse_top( WP_REST_Request $request ) {
	return desktop_mode_music_player_browse_response( 'top', '/me/top/tracks', $request );
}

/** GET /recently-played — recent listening history. */
function desktop_mode_music_player_rest_browse_recent( WP_REST_Request $request ) {
	return desktop_mode_music_player_browse_response( 'recent', '/me/player/recently-played', $request );
}

/** GET /playlists — the user's playlists. */
function desktop_mode_music_player_rest_browse_playlists( WP_REST_Request $request ) {
	return desktop_mode_music_player_browse_response( 'playlists', '/me/playlists', $request );
}

/**
 * Normalize a Spotify artist object into a browse-list item. Artists
 * play via `context_uri` (Spotify starts the artist's top tracks), so
 * `isContext` is true.
 *
 * @since 0.9.7
 *
 * @param array $artist Spotify artist object.
 * @return array Normalized item.
 */
function desktop_mode_music_player_normalize_artist( array $artist ) {
	$images = isset( $artist['images'] ) && is_array( $artist['images'] ) ? $artist['images'] : array();
	$image  = '';
	if ( ! empty( $images ) ) {
		$smallest = end( $images );
		$image    = isset( $smallest['url'] ) ? (string) $smallest['url'] : '';
	}
	return array(
		'uri'       => isset( $artist['uri'] ) ? (string) $artist['uri'] : '',
		'name'      => isset( $artist['name'] ) ? (string) $artist['name'] : '',
		'subtitle'  => __( 'Artist', 'deskbeat-for-desktop-mode' ),
		'image'     => $image,
		'isContext' => true,
	);
}

/**
 * GET /search — search tracks + artists. Query param `q`. Returns the
 * uniform `{ items, next }` shape (tracks first, then artists); search
 * is single-page (refine the query for different results).
 *
 * @since 0.9.7
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_music_player_rest_search( WP_REST_Request $request ) {
	$query = trim( (string) $request->get_param( 'q' ) );
	if ( '' === $query ) {
		return new WP_REST_Response( array( 'items' => array(), 'next' => null ), 200 );
	}

	$cursor = $request->get_param( 'cursor' );
	$offset = ( null === $cursor || '' === (string) $cursor ) ? 0 : (int) $cursor;

	// NB: no `limit` — Spotify rejects it on /search for newly-created
	// apps ("Invalid limit"), returning a small default page instead.
	// It DOES honour `offset`, so we page through by offset.
	$search_query = array(
		'q'    => $query,
		'type' => 'track,artist',
	);
	if ( $offset > 0 ) {
		$search_query['offset'] = $offset;
	}
	$result = desktop_mode_music_player_api(
		get_current_user_id(),
		'GET',
		'/search',
		array( 'query' => $search_query )
	);
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	$status = (int) $result['status'];
	if ( $status < 200 || $status >= 300 ) {
		$message = sprintf(
			/* translators: %d: HTTP status code returned by Spotify. */
			__( 'Spotify request failed (HTTP %d).', 'deskbeat-for-desktop-mode' ),
			$status
		);
		if ( is_array( $result['body'] ) && isset( $result['body']['error']['message'] ) ) {
			$message = (string) $result['body']['error']['message'];
		}
		return new WP_Error(
			'desktop_mode_music_player_spotify_error',
			$message,
			array( 'status' => 200 === $status ? 502 : $status )
		);
	}

	$body         = is_array( $result['body'] ) ? $result['body'] : array();
	$track_items  = (array) ( $body['tracks']['items'] ?? array() );
	$artist_items = (array) ( $body['artists']['items'] ?? array() );

	$items = array();
	foreach ( $track_items as $track ) {
		$item = desktop_mode_music_player_normalize_track( $track );
		if ( $item ) {
			$items[] = $item;
		}
	}
	foreach ( $artist_items as $artist ) {
		if ( is_array( $artist ) ) {
			$items[] = desktop_mode_music_player_normalize_artist( $artist );
		}
	}

	// Advance the offset by this page's size so infinite scroll can pull
	// the next batch. Both result sets share the offset; step by the
	// larger of the two. A page with nothing left ends the scroll.
	$step = max( count( $track_items ), count( $artist_items ) );
	$next = $step > 0 ? (string) ( $offset + $step ) : null;

	return new WP_REST_Response( array( 'items' => $items, 'next' => $next ), 200 );
}
