/**
 * Desktop Mode — Music Player: Spotify Web Playback SDK glue.
 *
 * Loads the Spotify Web Playback SDK on demand and creates an
 * in-browser playback device. This is the one path that needs a
 * Spotify access token client-side — the SDK's `getOAuthToken`
 * callback pulls a fresh, short-lived token from our `/token` REST
 * route (the refresh token + client secret stay server-side).
 *
 * Playback through this device requires a Spotify Premium subscription;
 * for free accounts the SDK never becomes `ready` and callers fall back
 * to the now-playing + remote-transport experience.
 *
 * @since 0.9.7
 */

import { fetchToken } from './api';

const SDK_SRC = 'https://sdk.scdn.co/spotify-player.js';

interface SpotifyPlayerState {
	paused: boolean;
	position: number;
	duration: number;
	track_window?: {
		current_track?: {
			name?: string;
			duration_ms?: number;
			artists?: Array< { name?: string } >;
			album?: { name?: string; images?: Array< { url?: string } > };
		};
	};
}

interface SpotifyPlayer {
	connect(): Promise< boolean >;
	disconnect(): void;
	addListener( event: string, cb: ( payload: never ) => void ): boolean;
	togglePlay(): Promise< void >;
	pause(): Promise< void >;
	nextTrack(): Promise< void >;
	previousTrack(): Promise< void >;
	// Satisfies browser autoplay policy — must run inside a user gesture
	// on some browsers. Best-effort; not present on very old SDK builds.
	activateElement?: () => Promise< void >;
}

interface SpotifyPlayerCtorArgs {
	name: string;
	getOAuthToken: ( cb: ( token: string ) => void ) => void;
	volume?: number;
}

declare global {
	interface Window {
		onSpotifyWebPlaybackSDKReady?: () => void;
		Spotify?: {
			Player: new ( args: SpotifyPlayerCtorArgs ) => SpotifyPlayer;
		};
	}
}

let sdkPromise: Promise< void > | null = null;

/**
 * Inject the SDK `<script>` once and resolve when the global
 * `Spotify` object is ready. Idempotent — repeated calls share one
 * load.
 */
function loadSdk(): Promise< void > {
	if ( sdkPromise ) {
		return sdkPromise;
	}
	sdkPromise = new Promise< void >( ( resolve, reject ) => {
		if ( window.Spotify ) {
			resolve();
			return;
		}
		window.onSpotifyWebPlaybackSDKReady = () => resolve();

		const existing = document.querySelector< HTMLScriptElement >(
			`script[src="${ SDK_SRC }"]`,
		);
		if ( existing ) {
			return;
		}
		const script = document.createElement( 'script' );
		script.src = SDK_SRC;
		script.async = true;
		script.addEventListener( 'error', () =>
			reject( new Error( 'Failed to load the Spotify Web Playback SDK.' ) ),
		);
		document.head.appendChild( script );
	} );
	return sdkPromise;
}

export interface PlaybackDevice {
	player: SpotifyPlayer;
	deviceId: string;
}

export interface PlaybackHandlers {
	onStateChange?: ( state: SpotifyPlayerState | null ) => void;
	onError?: ( message: string ) => void;
}

/**
 * Create and connect an in-browser Spotify playback device.
 *
 * Resolves with the SDK player + its device id once the device is
 * registered with Spotify Connect. Rejects if the SDK fails to load,
 * authentication fails, or the account is not Premium (the SDK reports
 * an `account_error` in that case).
 *
 * @param deviceName Label shown in the user's Spotify Connect device list.
 * @param handlers   Optional state-change / error callbacks.
 */
export async function createPlaybackDevice(
	deviceName: string,
	handlers: PlaybackHandlers = {},
): Promise< PlaybackDevice > {
	await loadSdk();

	const Spotify = window.Spotify;
	if ( ! Spotify ) {
		throw new Error( 'Spotify Web Playback SDK is unavailable.' );
	}

	return new Promise< PlaybackDevice >( ( resolve, reject ) => {
		let settled = false;

		const player = new Spotify.Player( {
			name: deviceName,
			volume: 0.8,
			getOAuthToken: ( cb ) => {
				fetchToken()
					.then( ( { accessToken } ) => cb( accessToken ) )
					.catch( () => {
						if ( ! settled ) {
							settled = true;
							reject( new Error( 'Could not obtain a Spotify access token.' ) );
						}
					} );
			},
		} );

		player.addListener( 'ready', ( payload ) => {
			const { device_id: deviceId } = payload as unknown as {
				device_id: string;
			};
			// Satisfy the browser autoplay policy so the device can
			// actually produce sound. Best-effort — ignore if unsupported.
			try {
				void player.activateElement?.();
			} catch {
				// Older SDK / unsupported — the device still registers.
			}
			if ( ! settled ) {
				settled = true;
				resolve( { player, deviceId } );
			}
		} );

		player.addListener( 'player_state_changed', ( payload ) => {
			handlers.onStateChange?.(
				( payload as unknown as SpotifyPlayerState | null ) ?? null,
			);
		} );

		for ( const errorEvent of [
			'initialization_error',
			'authentication_error',
			'account_error',
			'playback_error',
		] ) {
			player.addListener( errorEvent, ( payload ) => {
				const { message } = payload as unknown as { message: string };
				handlers.onError?.( message );
				if ( ! settled && errorEvent !== 'playback_error' ) {
					settled = true;
					reject( new Error( message ) );
				}
			} );
		}

		player.connect().catch( () => {
			if ( ! settled ) {
				settled = true;
				reject( new Error( 'The Spotify player failed to connect.' ) );
			}
		} );
	} );
}
