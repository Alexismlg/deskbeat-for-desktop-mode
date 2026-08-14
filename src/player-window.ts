/**
 * Deskbeat — full-player native window.
 *
 * The "big screen" companion to the dock widget: a native OpenStation
 * window (`desktop-mode-music-player`) with large artwork, the full
 * transport (shuffle · prev · play/pause · next · repeat), a seek bar
 * with time read-outs, an always-visible volume slider, and the Browse /
 * Search list inline. Reuses the widget's data layer (`./api`,
 * `./device`) and browse view (`./browse`) — only the layout is new.
 *
 * Registered on `window.openStationNativeWindows[ WINDOW_ID ]`; the host
 * invokes the callback with the window body on every open. Config is
 * shipped by `openstation_register_window()`'s `config` arg and read via
 * `wp.os.getWindowConfig()` / `window.openStationWindowConfig`.
 *
 * @since 1.2.0
 */

import { __ } from './i18n';
import {
	fetchNowPlaying,
	fetchState,
	next,
	pause,
	play,
	playUri,
	previous,
	seek,
	setRepeat,
	setShuffle,
	setVolume,
	type BrowseItem,
	type MusicPlayerConfig,
	type NowPlaying,
	type RepeatState,
} from './api';
import { ensureSharedDevice, transferToSharedDevice } from './device';
import { renderWidgetBrowse } from './browse';
import './player-window.css';

const WINDOW_ID = 'desktop-mode-music-player';

type RenderCallback = ( body: HTMLElement ) => void;

interface OsFacade {
	getWindowConfig?: < T >( id: string ) => T | undefined;
	showToast?: ( opts: { message: string; type?: string } ) => void;
	startOAuth?: ( service: string ) => Promise< { ok: boolean; service: string } >;
	confirm?: ( opts: {
		title?: string;
		message: string;
		confirmLabel?: string;
		danger?: boolean;
	} ) => Promise< boolean >;
}

function os(): OsFacade | undefined {
	return ( window as unknown as { wp?: { os?: OsFacade } } ).wp?.os;
}

function toast( message: string, type: 'success' | 'error' = 'success' ): void {
	os()?.showToast?.( { message, type } );
}

/**
 * The window bundle carries its own config (shipped via the window's
 * `config` arg). Mirror it onto the global `./api` reads so the shared
 * data layer works unchanged inside the window.
 */
function bootstrapConfig(): void {
	const w = window as unknown as {
		desktopModeMusicPlayerConfig?: MusicPlayerConfig;
		openStationWindowConfig?: Record< string, MusicPlayerConfig >;
	};
	if ( w.desktopModeMusicPlayerConfig ) {
		return;
	}
	const fromGetter = os()?.getWindowConfig?.< MusicPlayerConfig >( WINDOW_ID );
	const cfg = fromGetter ?? w.openStationWindowConfig?.[ WINDOW_ID ];
	if ( cfg ) {
		w.desktopModeMusicPlayerConfig = cfg;
	}
}

function el< K extends keyof HTMLElementTagNameMap >(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[ K ] {
	const node = document.createElement( tag );
	if ( className ) {
		node.className = className;
	}
	if ( text !== undefined ) {
		node.textContent = text;
	}
	return node;
}

function iconButton( dashicon: string, label: string ): HTMLButtonElement {
	const button = document.createElement( 'button' );
	button.type = 'button';
	button.className = 'deskbeat-player__btn';
	button.title = label;
	button.setAttribute( 'aria-label', label );
	const icon = el( 'span', `dashicons ${ dashicon }` );
	button.appendChild( icon );
	return button;
}

function isNoDeviceError( err: Error ): boolean {
	return /no active device|device not found/i.test( err.message );
}

function handleControlError( err: Error ): void {
	if ( isNoDeviceError( err ) ) {
		toast(
			__( 'Nothing is playing — press play to start.', 'deskbeat-for-desktop-mode' ),
			'error',
		);
		return;
	}
	toast( err.message, 'error' );
}

/** ms → `m:ss`. */
function formatTime( ms: number ): string {
	const total = Math.max( 0, Math.round( ms / 1000 ) );
	const minutes = Math.floor( total / 60 );
	const seconds = total % 60;
	return `${ minutes }:${ String( seconds ).padStart( 2, '0' ) }`;
}

const POLL_MS = 5000;

function renderPlayer( body: HTMLElement ): void {
	bootstrapConfig();
	body.replaceChildren();
	body.classList.add( 'deskbeat-player' );

	let pollTimer: ReturnType< typeof setInterval > | null = null;
	let tickTimer: ReturnType< typeof setInterval > | null = null;
	let destroyed = false;

	// Playback state, mirrored from /now-playing.
	let isPremium = false;
	let accountId = '';
	let currentDeviceId = '';
	let isPlaying = false;
	let hasTrack = false;
	let shuffleOn = false;
	let repeatMode: RepeatState = 'off';
	let durationMs = 0;
	let progressMs = 0;
	let progressAt = 0;
	let suppressVolumeUntil = 0;

	const stopPolling = (): void => {
		if ( pollTimer !== null ) {
			clearInterval( pollTimer );
			pollTimer = null;
		}
	};

	// Elements assigned in buildPlayer(), updated in paint().
	let artImg: HTMLImageElement;
	let artBox: HTMLElement;
	let trackEl: HTMLElement;
	let artistEl: HTMLElement;
	let playIcon: HTMLElement;
	let shuffleBtn: HTMLElement;
	let repeatBtn: HTMLElement;
	let seekFill: HTMLElement;
	let timeCurEl: HTMLElement;
	let timeDurEl: HTMLElement;
	let volumeInput: HTMLInputElement;

	function paintProgress(): void {
		const effective =
			isPlaying && durationMs > 0
				? Math.min( durationMs, progressMs + ( Date.now() - progressAt ) )
				: progressMs;
		const pct = durationMs > 0 ? Math.min( 100, ( effective / durationMs ) * 100 ) : 0;
		seekFill.style.width = `${ pct }%`;
		timeCurEl.textContent = formatTime( effective );
		timeDurEl.textContent = durationMs > 0 ? formatTime( durationMs ) : '0:00';
	}

	async function playItem( item: BrowseItem ): Promise< void > {
		if ( isPremium ) {
			const dev = await ensureSharedDevice( accountId, ( m ) => toast( m, 'error' ) );
			await playUri( item, dev.deviceId );
		} else {
			await playUri( item );
		}
		toast( __( 'Playing…', 'deskbeat-for-desktop-mode' ) );
		quickRefresh();
	}

	function refresh(): Promise< void > {
		return fetchNowPlaying()
			.then( ( np ) => {
				if ( ! destroyed ) {
					paint( np );
				}
			} )
			.catch( () => {
				// Ignore transient poll errors (e.g. no active device).
			} );
	}

	function quickRefresh(): void {
		void refresh();
		for ( const ms of [ 250, 800, 1600 ] ) {
			setTimeout( () => {
				if ( ! destroyed ) {
					void refresh();
				}
			}, ms );
		}
	}

	const run = ( fn: () => Promise< unknown > ) => (): void => {
		fn()
			.then( () => quickRefresh() )
			.catch( handleControlError );
	};

	function buildPlayer(): void {
		body.replaceChildren();
		const inner = el( 'div', 'deskbeat-player__inner' );

		const stage = el( 'div', 'deskbeat-player__stage' );
		artBox = el( 'div', 'deskbeat-player__art' );
		artImg = el( 'img' );
		artImg.alt = '';
		artBox.appendChild( artImg );
		stage.appendChild( artBox );

		const meta = el( 'div', 'deskbeat-player__meta' );
		trackEl = el(
			'div',
			'deskbeat-player__track',
			__( 'Nothing playing', 'deskbeat-for-desktop-mode' ),
		);
		artistEl = el( 'div', 'deskbeat-player__artist' );
		meta.append( trackEl, artistEl );
		stage.appendChild( meta );
		inner.appendChild( stage );

		// Seek row: current time · bar · duration.
		const seekRow = el( 'div', 'deskbeat-player__seek-row' );
		timeCurEl = el( 'span', 'deskbeat-player__time', '0:00' );
		timeDurEl = el( 'span', 'deskbeat-player__time', '0:00' );
		const seekBar = el( 'div', 'deskbeat-player__seek' );
		seekBar.setAttribute( 'role', 'slider' );
		seekBar.setAttribute( 'aria-label', __( 'Seek', 'deskbeat-for-desktop-mode' ) );
		seekFill = el( 'div', 'deskbeat-player__seek-fill' );
		seekBar.appendChild( seekFill );
		seekBar.addEventListener( 'click', ( e ) => {
			if ( durationMs <= 0 ) {
				return;
			}
			const rect = seekBar.getBoundingClientRect();
			const pct = Math.min( 1, Math.max( 0, ( e.clientX - rect.left ) / rect.width ) );
			const positionMs = Math.round( pct * durationMs );
			progressMs = positionMs;
			progressAt = Date.now();
			paintProgress();
			seek( positionMs, currentDeviceId || undefined )
				.then( () => quickRefresh() )
				.catch( handleControlError );
		} );
		seekRow.append( timeCurEl, seekBar, timeDurEl );
		inner.appendChild( seekRow );

		// Transport row.
		const controls = el( 'div', 'deskbeat-player__controls' );
		shuffleBtn = iconButton(
			'dashicons-randomize',
			__( 'Shuffle', 'deskbeat-for-desktop-mode' ),
		);
		const prevBtn = iconButton(
			'dashicons-controls-back',
			__( 'Previous', 'deskbeat-for-desktop-mode' ),
		);
		const playBtn = iconButton(
			'dashicons-controls-play',
			__( 'Play/Pause', 'deskbeat-for-desktop-mode' ),
		);
		playBtn.classList.add( 'is-primary' );
		playIcon = playBtn.querySelector( '.dashicons' ) as HTMLElement;
		const nextBtn = iconButton(
			'dashicons-controls-forward',
			__( 'Next', 'deskbeat-for-desktop-mode' ),
		);
		repeatBtn = iconButton(
			'dashicons-controls-repeat',
			__( 'Repeat', 'deskbeat-for-desktop-mode' ),
		);

		shuffleBtn.addEventListener(
			'click',
			run( () => setShuffle( ! shuffleOn, currentDeviceId || undefined ) ),
		);
		repeatBtn.addEventListener(
			'click',
			run( () => {
				const nextMode: RepeatState =
					repeatMode === 'off'
						? 'context'
						: repeatMode === 'context'
							? 'track'
							: 'off';
				return setRepeat( nextMode, currentDeviceId || undefined );
			} ),
		);
		prevBtn.addEventListener( 'click', run( () => previous() ) );
		nextBtn.addEventListener( 'click', run( () => next() ) );
		playBtn.addEventListener( 'click', () => {
			if ( isPlaying ) {
				pause().then( () => quickRefresh() ).catch( handleControlError );
				return;
			}
			if ( hasTrack ) {
				play().then( () => quickRefresh() ).catch( handleControlError );
				return;
			}
			if ( isPremium ) {
				ensureSharedDevice( accountId, ( m ) => toast( m, 'error' ) )
					.then( ( dev ) => transferToSharedDevice( dev.deviceId ) )
					.then( () => quickRefresh() )
					.catch( handleControlError );
				return;
			}
			toast(
				__(
					'Start playback in the Spotify app first — a free account can’t play in the browser.',
					'deskbeat-for-desktop-mode',
				),
				'error',
			);
		} );

		controls.append( shuffleBtn, prevBtn, playBtn, nextBtn, repeatBtn );
		inner.appendChild( controls );

		// Volume — always-visible slider with a speaker glyph.
		const volumeRow = el( 'div', 'deskbeat-player__volume-row' );
		volumeRow.appendChild( el( 'span', 'dashicons dashicons-controls-volumeon' ) );
		volumeInput = document.createElement( 'input' );
		volumeInput.type = 'range';
		volumeInput.min = '0';
		volumeInput.max = '100';
		volumeInput.step = '1';
		volumeInput.value = '100';
		volumeInput.className = 'deskbeat-player__volume';
		let volumeTimer: ReturnType< typeof setTimeout > | null = null;
		volumeInput.addEventListener( 'input', () => {
			const value = Number( volumeInput.value );
			suppressVolumeUntil = Date.now() + 2000;
			if ( volumeTimer !== null ) {
				clearTimeout( volumeTimer );
			}
			volumeTimer = setTimeout( () => {
				setVolume( value, currentDeviceId || undefined ).catch( ( err: Error ) =>
					toast( err.message, 'error' ),
				);
			}, 250 );
		} );
		volumeRow.appendChild( volumeInput );
		inner.appendChild( volumeRow );

		// Browse / search inline — reuse the widget's browse view.
		const browse = el( 'div', 'deskbeat-player__browse' );
		inner.appendChild( browse );
		renderWidgetBrowse( browse, { playItem, toast, queueAfterPlay: true } );

		body.appendChild( inner );
	}

	function paint( np: NowPlaying ): void {
		currentDeviceId = np.device?.id ?? '';

		shuffleOn = Boolean( np.shuffle_state );
		shuffleBtn.classList.toggle( 'is-active', shuffleOn );

		repeatMode = np.repeat_state ?? 'off';
		repeatBtn.classList.toggle( 'is-active', repeatMode !== 'off' );
		repeatBtn.classList.toggle( 'is-one', repeatMode === 'track' );
		const repeatLabel =
			repeatMode === 'track'
				? __( 'Repeat one', 'deskbeat-for-desktop-mode' )
				: repeatMode === 'context'
					? __( 'Repeat all', 'deskbeat-for-desktop-mode' )
					: __( 'Repeat', 'deskbeat-for-desktop-mode' );
		repeatBtn.title = repeatLabel;
		repeatBtn.setAttribute( 'aria-label', repeatLabel );

		const dev = np.device;
		if (
			dev &&
			typeof dev.volume_percent === 'number' &&
			dev.supports_volume !== false &&
			Date.now() >= suppressVolumeUntil
		) {
			volumeInput.value = String( dev.volume_percent );
		}

		const item = np.item ?? null;
		if ( ! item ) {
			trackEl.textContent = __( 'Nothing playing', 'deskbeat-for-desktop-mode' );
			artistEl.textContent = '';
			artImg.removeAttribute( 'src' );
			artBox.classList.add( 'is-empty' );
			isPlaying = false;
			hasTrack = false;
			playIcon.className = 'dashicons dashicons-controls-play';
			durationMs = 0;
			progressMs = 0;
			paintProgress();
			return;
		}
		hasTrack = true;
		trackEl.textContent = item.name;
		artistEl.textContent = ( item.artists ?? [] )
			.map( ( a ) => a.name )
			.filter( Boolean )
			.join( ', ' );
		const image = item.album?.images?.[ 0 ]?.url;
		if ( image ) {
			artImg.src = image;
			artBox.classList.remove( 'is-empty' );
		} else {
			artImg.removeAttribute( 'src' );
			artBox.classList.add( 'is-empty' );
		}
		isPlaying = Boolean( np.is_playing );
		playIcon.className = isPlaying
			? 'dashicons dashicons-controls-pause'
			: 'dashicons dashicons-controls-play';
		durationMs = item.duration_ms || 0;
		progressMs = np.progress_ms ?? 0;
		progressAt = Date.now();
		paintProgress();
	}

	function renderDisconnected( canConfigure: boolean, configured: boolean ): void {
		body.replaceChildren();
		const wrap = el( 'div', 'deskbeat-player__gate' );
		if ( ! configured ) {
			wrap.appendChild(
				el(
					'p',
					'deskbeat-player__hint',
					canConfigure
						? __(
								'Add your Spotify app credentials in the Music widget to get started.',
								'deskbeat-for-desktop-mode',
							)
						: __(
								'The music player is not set up yet. Ask an administrator.',
								'deskbeat-for-desktop-mode',
							),
				),
			);
			body.appendChild( wrap );
			return;
		}
		wrap.appendChild(
			el(
				'p',
				'deskbeat-player__hint',
				__( 'Connect Spotify to control playback here.', 'deskbeat-for-desktop-mode' ),
			),
		);
		const connectBtn = el(
			'button',
			'deskbeat-player__btn deskbeat-player__btn--text is-primary',
			__( 'Connect Spotify', 'deskbeat-for-desktop-mode' ),
		);
		connectBtn.type = 'button';
		connectBtn.addEventListener( 'click', () => {
			const start = os()?.startOAuth;
			const cfg = ( window as unknown as { desktopModeMusicPlayerConfig?: MusicPlayerConfig } )
				.desktopModeMusicPlayerConfig;
			if ( ! start || ! cfg ) {
				toast( __( 'OAuth is unavailable here.', 'deskbeat-for-desktop-mode' ), 'error' );
				return;
			}
			start( cfg.service )
				.then( () => init() )
				.catch( ( err: Error ) => toast( err.message, 'error' ) );
		} );
		wrap.appendChild( connectBtn );
		body.appendChild( wrap );
	}

	function init(): void {
		stopPolling();
		fetchState()
			.then( ( state ) => {
				if ( destroyed ) {
					return;
				}
				if ( ! state.connected ) {
					renderDisconnected( state.canConfigure, state.configured );
					return;
				}
				isPremium = state.profile?.isPremium ?? false;
				accountId = state.profile?.id ?? '';
				buildPlayer();
				void refresh();
				pollTimer = setInterval( () => void refresh(), POLL_MS );
			} )
			.catch( () => {
				if ( ! destroyed ) {
					renderDisconnected( false, true );
				}
			} );
	}

	// Advance the seek bar smoothly between polls.
	tickTimer = setInterval( () => {
		if ( ! destroyed && hasTrack ) {
			paintProgress();
		}
	}, 1000 );

	init();

	// Native windows render once per instance; the host tears the DOM
	// down on close. Clean up our timers when the body is removed.
	const observer = new MutationObserver( () => {
		if ( ! body.isConnected ) {
			destroyed = true;
			stopPolling();
			if ( tickTimer !== null ) {
				clearInterval( tickTimer );
				tickTimer = null;
			}
			observer.disconnect();
		}
	} );
	if ( body.parentNode ) {
		observer.observe( body.parentNode, { childList: true } );
	}
}

const win = window as unknown as {
	openStationNativeWindows?: Record< string, RenderCallback | undefined >;
};
const registry = ( win.openStationNativeWindows ??= {} );
registry[ WINDOW_ID ] = renderPlayer;
