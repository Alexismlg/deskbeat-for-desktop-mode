/**
 * Music Player for Desktop Mode — client-side REST helpers.
 *
 * Thin typed wrappers over the `desktop-mode-music-player/v1` routes.
 * Requests route through Desktop Mode's `wp.desktop.fetch` (so they feed
 * the activity bus) and carry the REST nonce from the localized config
 * blob. Falls back to the native `fetch` if the host helper is missing.
 *
 * @since 1.0.0
 */

interface DesktopFetchOpts {
	source?: string;
	windowId?: string;
	silent?: boolean;
}

/** Route through `wp.desktop.fetch` when Desktop Mode is present. */
function trackedFetch(
	input: RequestInfo,
	init?: RequestInit,
	opts?: DesktopFetchOpts,
): Promise< Response > {
	const helper = (
		window as unknown as {
			wp?: {
				desktop?: {
					fetch?: (
						i: RequestInfo,
						ini?: RequestInit,
						o?: DesktopFetchOpts,
					) => Promise< Response >;
				};
			};
		}
	 ).wp?.desktop?.fetch;
	if ( helper ) {
		return helper( input, init, opts );
	}
	return window.fetch( input, init );
}

export interface MusicPlayerConfig {
	restNonce: string;
	restBase: string;
	service: string;
	redirectUri: string;
	dashboardUrl: string;
	// Native-window id the widget opens for the full player.
	windowId: string;
}

declare global {
	interface Window {
		desktopModeMusicPlayerConfig?: MusicPlayerConfig;
	}
}

export interface MusicPlayerProfile {
	id: string;
	displayName: string;
	product: string;
	isPremium: boolean;
	image: string;
}

export interface MusicPlayerState {
	service: string;
	configured: boolean;
	canConfigure: boolean;
	connected: boolean;
	profile: MusicPlayerProfile | null;
}

export interface NowPlayingArtist {
	name: string;
}

export interface NowPlayingImage {
	url: string;
	width?: number;
	height?: number;
}

export interface NowPlayingItem {
	name: string;
	duration_ms: number;
	artists?: NowPlayingArtist[];
	album?: { name?: string; images?: NowPlayingImage[] };
}

export type RepeatState = 'off' | 'track' | 'context';

export interface NowPlaying {
	is_playing?: boolean;
	progress_ms?: number;
	item?: NowPlayingItem | null;
	device?: {
		id?: string;
		name?: string;
		volume_percent?: number;
		supports_volume?: boolean;
	} | null;
	shuffle_state?: boolean;
	repeat_state?: RepeatState;
	// Present (as `{ ok: true }`) when Spotify returned 204 — nothing
	// is playing on any device.
	ok?: boolean;
}

const SOURCE = 'desktop-mode/music-player';

/**
 * Read the localized config, throwing the framework's canonical
 * "config blob did not reach the page" error when it is missing.
 */
export function config(): MusicPlayerConfig {
	const cfg = window.desktopModeMusicPlayerConfig;
	if ( ! cfg ) {
		throw new Error(
			'desktopModeMusicPlayerConfig is missing — config blob did not reach the page. ' +
				'See docs/examples/window-with-config.md.',
		);
	}
	return cfg;
}

async function request< T >( path: string, init: RequestInit = {} ): Promise< T > {
	const cfg = config();
	const response = await trackedFetch(
		`${ cfg.restBase }${ path }`,
		{
			...init,
			credentials: 'same-origin',
			headers: {
				'X-WP-Nonce': cfg.restNonce,
				Accept: 'application/json',
				...( init.body ? { 'Content-Type': 'application/json' } : {} ),
				...( init.headers ?? {} ),
			},
		},
		{ source: SOURCE, windowId: 'desktop-mode-music-player' },
	);

	if ( ! response.ok ) {
		let message = `${ response.status } ${ response.statusText }`;
		try {
			const json = ( await response.json() ) as { message?: string };
			if ( json && typeof json.message === 'string' ) {
				message = json.message;
			}
		} catch {
			// Non-JSON body — keep the status line.
		}
		throw new Error( message );
	}

	return ( await response.json() ) as T;
}

/** GET /state — connection + profile snapshot. */
export function fetchState(): Promise< MusicPlayerState > {
	return request< MusicPlayerState >( '/state' );
}

/** POST /settings — save the Spotify app credentials (admin only). */
export function saveSettings(
	clientId: string,
	clientSecret: string,
): Promise< { configured: boolean } > {
	return request< { configured: boolean } >( '/settings', {
		method: 'POST',
		body: JSON.stringify( { clientId, clientSecret } ),
	} );
}

/** POST /disconnect — forget this user's Spotify connection. */
export function disconnect(): Promise< { connected: boolean } > {
	return request< { connected: boolean } >( '/disconnect', { method: 'POST' } );
}

/** GET /token — fresh access token for the Web Playback SDK. */
export function fetchToken(): Promise< { accessToken: string } > {
	return request< { accessToken: string } >( '/token' );
}

/** GET /now-playing — current playback state. */
export function fetchNowPlaying(): Promise< NowPlaying > {
	return request< NowPlaying >( '/now-playing' );
}

/** Transport controls. All optionally target a specific device. */
export function play( deviceId?: string ): Promise< unknown > {
	return request( '/play', {
		method: 'POST',
		body: JSON.stringify( deviceId ? { deviceId } : {} ),
	} );
}

export function pause( deviceId?: string ): Promise< unknown > {
	return request( '/pause', {
		method: 'POST',
		body: JSON.stringify( deviceId ? { deviceId } : {} ),
	} );
}

export function next( deviceId?: string ): Promise< unknown > {
	return request( '/next', {
		method: 'POST',
		body: JSON.stringify( deviceId ? { deviceId } : {} ),
	} );
}

export function previous( deviceId?: string ): Promise< unknown > {
	return request( '/previous', {
		method: 'POST',
		body: JSON.stringify( deviceId ? { deviceId } : {} ),
	} );
}

/** POST /transfer — move playback onto the in-browser SDK device. */
export function transfer( deviceId: string, playNow: boolean ): Promise< unknown > {
	return request( '/transfer', {
		method: 'POST',
		body: JSON.stringify( { deviceId, play: playNow } ),
	} );
}

/** POST /shuffle — toggle shuffle on the active device. */
export function setShuffle( state: boolean, deviceId?: string ): Promise< unknown > {
	return request( '/shuffle', {
		method: 'POST',
		body: JSON.stringify( { state, ...( deviceId ? { deviceId } : {} ) } ),
	} );
}

/** POST /repeat — set repeat mode (off | track | context). */
export function setRepeat(
	state: RepeatState,
	deviceId?: string,
): Promise< unknown > {
	return request( '/repeat', {
		method: 'POST',
		body: JSON.stringify( { state, ...( deviceId ? { deviceId } : {} ) } ),
	} );
}

/** POST /seek — jump to `positionMs` in the current track. */
export function seek( positionMs: number, deviceId?: string ): Promise< unknown > {
	return request( '/seek', {
		method: 'POST',
		body: JSON.stringify( {
			positionMs: Math.max( 0, Math.round( positionMs ) ),
			...( deviceId ? { deviceId } : {} ),
		} ),
	} );
}

/** POST /volume — set the active device's volume (0-100). */
export function setVolume(
	volumePercent: number,
	deviceId?: string,
): Promise< unknown > {
	return request( '/volume', {
		method: 'POST',
		body: JSON.stringify( {
			volumePercent: Math.max( 0, Math.min( 100, Math.round( volumePercent ) ) ),
			...( deviceId ? { deviceId } : {} ),
		} ),
	} );
}

/** A uniform browse-list row (tracks and playlists share this shape). */
export interface BrowseItem {
	uri: string;
	name: string;
	subtitle: string;
	image: string;
	// Playlists play via `context_uri`; tracks via `uris`.
	isContext: boolean;
}

export type BrowseSection =
	| 'queue'
	| 'library'
	| 'top'
	| 'recently-played'
	| 'playlists'
	| 'search';

export interface BrowsePage {
	items: BrowseItem[];
	// Opaque cursor for the next page, or null when there are no more
	// results. The client echoes it back verbatim; only the server knows
	// whether it's an offset or a timestamp.
	next: string | null;
}

/** GET a browse list by section, optionally continuing from a cursor. */
export function fetchBrowse(
	section: BrowseSection,
	cursor?: string,
): Promise< BrowsePage > {
	const path = cursor
		? `/${ section }?cursor=${ encodeURIComponent( cursor ) }`
		: `/${ section }`;
	return request< BrowsePage >( path );
}

/** GET /search — tracks + artists matching `query`, offset-paginated. */
export function fetchSearch(
	query: string,
	cursor?: string,
): Promise< BrowsePage > {
	const c = cursor ? `&cursor=${ encodeURIComponent( cursor ) }` : '';
	return request< BrowsePage >(
		`/search?q=${ encodeURIComponent( query ) }${ c }`,
	);
}

/** Play a single track (or a context like a playlist) by URI. */
export function playUri( item: BrowseItem, deviceId?: string ): Promise< unknown > {
	const body: Record< string, unknown > = deviceId ? { deviceId } : {};
	if ( item.isContext ) {
		body.contextUri = item.uri;
	} else {
		body.uris = [ item.uri ];
	}
	return request( '/play', { method: 'POST', body: JSON.stringify( body ) } );
}
