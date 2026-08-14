/**
 * Desktop Mode — Music Player widget.
 *
 * The glanceable half of the music player: a compact now-playing card
 * (art + title + artist) with prev / play-pause / next, plus a button
 * that opens the full player window for the library, search, volume,
 * and the rest. Opt-in like every widget — the user adds it from the
 * widget picker.
 *
 * It shares the window's REST client (`../../music-player/api`) and its
 * `window.desktopModeMusicPlayerConfig` blob (localized by
 * `includes/widgets/widget-music-player.php`), so transport controls act
 * on whatever device is currently active.
 *
 * @public
 * @since 0.9.7
 */

import { __ } from './i18n';
import {
	config,
	disconnect,
	fetchNowPlaying,
	fetchState,
	next,
	pause,
	play,
	playUri,
	previous,
	saveSettings,
	seek,
	setRepeat,
	setShuffle,
	setVolume,
	type BrowseItem,
	type NowPlaying,
	type RepeatState,
} from './api';
import {
	ensureSharedDevice,
	pauseSharedDevice,
	transferToSharedDevice,
} from './device';
import { renderWidgetBrowse } from './browse';
import './styles.css';

const WIDGET_ID = 'desktop-mode/music-player';
const POLL_MS = 5000;

type WidgetTeardown = () => void;

declare global {
	interface Window {
		openStationWidgets?: Record<
			string,
			( container: HTMLElement, ctx: unknown ) => WidgetTeardown
		>;
	}
}

interface DesktopApi {
	openNativeWindow?: ( id: string ) => void;
	showToast?: ( opts: { message: string; type?: string } ) => void;
	startOAuth?: ( service: string ) => Promise< { ok: boolean; service: string } >;
	confirm?: ( opts: {
		title?: string;
		message: string;
		confirmLabel?: string;
		danger?: boolean;
	} ) => Promise< boolean >;
}

function toast( message: string, type: 'success' | 'error' = 'success' ): void {
	desktopApi()?.showToast?.( { message, type } );
}

function desktopApi(): DesktopApi | undefined {
	return ( window as unknown as { wp?: { os?: DesktopApi } } ).wp
		?.os;
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

// Native <button> (not wpd-button): the widgets layer only treats
// native controls as interactive — wpd-button clicks never fire inside
// a widget card. This matches the shipped Notes widget's approach.
function iconButton( dashicon: string, label: string ): HTMLButtonElement {
	const button = document.createElement( 'button' );
	button.type = 'button';
	button.className = 'desktop-mode-music-widget__btn';
	button.title = label;
	button.setAttribute( 'aria-label', label );
	const icon = document.createElement( 'span' );
	icon.className = `dashicons ${ dashicon }`;
	button.appendChild( icon );
	return button;
}

/** Spotify's "nothing to control" errors (no device / not found). */
function isNoDeviceError( err: Error ): boolean {
	return /no active device|device not found/i.test( err.message );
}

/**
 * Handle a transport-control failure. When there's no active device the
 * widget can't do anything (it can't create one), so open the full
 * player where playback can be started; otherwise surface the error.
 */
function handleControlError( err: Error ): void {
	if ( isNoDeviceError( err ) ) {
		toast( __( 'Nothing is playing — press play to start.', 'deskbeat-for-desktop-mode' ) );
		return;
	}
	toast( err.message, 'error' );
}

/**
 * Mount the widget. Returns a teardown that stops the poll timer.
 */
function mount( container: HTMLElement ): WidgetTeardown {
	container.classList.add( 'desktop-mode-music-widget' );
	let timer: ReturnType< typeof setInterval > | null = null;
	let destroyed = false;

	const stop = (): void => {
		if ( timer !== null ) {
			clearInterval( timer );
			timer = null;
		}
	};

	// Set from /state — needed to spin up the shared device standalone.
	let isPremium = false;
	let accountId = '';
	// Active device id (from the poll) so volume targets the right one.
	let currentDeviceId = '';
	let suppressVolumeUntil = 0;

	// Connect / setup prompt shown when the account isn't linked yet.
	function renderConnect( canConfigure: boolean, configured: boolean ): void {
		container.replaceChildren();
		const wrap = el( 'div', 'desktop-mode-music-widget__connect' );

		if ( ! configured ) {
			if ( ! canConfigure ) {
				wrap.appendChild(
					el(
						'p',
						'desktop-mode-music-widget__hint',
						__(
							'The music player is not set up yet. Ask an administrator.',
							'deskbeat-for-desktop-mode',
						),
					),
				);
				container.appendChild( wrap );
				return;
			}

			// Admin setup form — enter the site's Spotify app credentials.
			const cfg = config();
			wrap.appendChild(
				el(
					'p',
					'desktop-mode-music-widget__hint',
					__(
						'Create an app in the Spotify Developer Dashboard, then paste its Client ID and Secret.',
						'deskbeat-for-desktop-mode',
					),
				),
			);

			const redirect = el( 'div', 'desktop-mode-music-widget__redirect' );
			redirect.append(
				el(
					'span',
					'desktop-mode-music-widget__redirect-label',
					__( 'Redirect URI to register:', 'deskbeat-for-desktop-mode' ),
				),
				el( 'code', undefined, cfg.redirectUri ),
			);
			wrap.appendChild( redirect );

			const dash = document.createElement( 'a' );
			dash.href = cfg.dashboardUrl;
			dash.target = '_blank';
			dash.rel = 'noreferrer';
			dash.className = 'desktop-mode-music-widget__dashboard';
			dash.textContent = __( 'Open Spotify Dashboard ↗', 'deskbeat-for-desktop-mode' );
			wrap.appendChild( dash );

			const idInput = document.createElement( 'input' );
			idInput.type = 'text';
			idInput.className = 'desktop-mode-music-widget__field';
			idInput.placeholder = __( 'Client ID', 'deskbeat-for-desktop-mode' );
			idInput.autocomplete = 'off';

			const secretInput = document.createElement( 'input' );
			secretInput.type = 'password';
			secretInput.className = 'desktop-mode-music-widget__field';
			secretInput.placeholder = __( 'Client Secret', 'deskbeat-for-desktop-mode' );
			secretInput.autocomplete = 'off';

			wrap.append( idInput, secretInput );

			const saveBtn = document.createElement( 'button' );
			saveBtn.type = 'button';
			saveBtn.className =
				'desktop-mode-music-widget__btn desktop-mode-music-widget__btn--text is-primary';
			saveBtn.textContent = __( 'Save credentials', 'deskbeat-for-desktop-mode' );
			saveBtn.addEventListener( 'click', () => {
				const clientId = idInput.value.trim();
				const clientSecret = secretInput.value.trim();
				if ( ! clientId || ! clientSecret ) {
					toast( __( 'Enter both the Client ID and Secret.', 'deskbeat-for-desktop-mode' ), 'error' );
					return;
				}
				saveSettings( clientId, clientSecret )
					.then( () => {
						toast( __( 'Spotify credentials saved.', 'deskbeat-for-desktop-mode' ) );
						init();
					} )
					.catch( ( err: Error ) => toast( err.message, 'error' ) );
			} );
			wrap.appendChild( saveBtn );

			container.appendChild( wrap );
			return;
		}

		wrap.appendChild(
			el(
				'p',
				'desktop-mode-music-widget__hint',
				__( 'Connect Spotify to see what you are playing.', 'deskbeat-for-desktop-mode' ),
			),
		);
		const connectBtn = document.createElement( 'button' );
		connectBtn.type = 'button';
		connectBtn.className =
			'desktop-mode-music-widget__btn desktop-mode-music-widget__btn--text is-primary';
		connectBtn.textContent = __( 'Connect Spotify', 'deskbeat-for-desktop-mode' );
		connectBtn.addEventListener( 'click', () => {
			const start = desktopApi()?.startOAuth;
			if ( ! start ) {
				toast( __( 'OAuth is unavailable here.', 'deskbeat-for-desktop-mode' ), 'error' );
				return;
			}
			start( config().service )
				.then( () => {
					toast( __( 'Connected to Spotify.', 'deskbeat-for-desktop-mode' ) );
					init();
				} )
				.catch( ( err: Error ) => toast( err.message, 'error' ) );
		} );
		wrap.appendChild( connectBtn );
		container.appendChild( wrap );
	}

	// The now-playing card + transport, built once and updated in place.
	let trackEl: HTMLElement;
	let artistEl: HTMLElement;
	let artImg: HTMLImageElement;
	let artBox: HTMLElement;
	let playIcon: HTMLElement;
	let volumeBtn: HTMLElement | null = null;
	let volumeWrap: HTMLElement | null = null;
	let volumeInput: HTMLInputElement | null = null;
	let shuffleBtn: HTMLElement | null = null;
	let repeatBtn: HTMLElement | null = null;
	let seekFill: HTMLElement | null = null;
	let isPlaying = false;
	let hasTrack = false;
	let built = false;
	// Playback modes + progress, mirrored from /now-playing so the shuffle
	// / repeat buttons and the seek bar reflect real device state.
	let shuffleOn = false;
	let repeatMode: RepeatState = 'off';
	let durationMs = 0;
	// `progressMs` is the server's last-known position; `progressAt` marks
	// when we captured it, so the 1s ticker can advance the bar smoothly
	// between the 5s polls without mutating the source value.
	let progressMs = 0;
	let progressAt = 0;

	function paintProgress(): void {
		if ( ! seekFill ) {
			return;
		}
		const effective =
			isPlaying && durationMs > 0
				? Math.min( durationMs, progressMs + ( Date.now() - progressAt ) )
				: progressMs;
		const pct = durationMs > 0 ? Math.min( 100, ( effective / durationMs ) * 100 ) : 0;
		seekFill.style.width = `${ pct }%`;
	}

	function buildPlayer(): void {
		container.replaceChildren();
		built = true;

		const card = el( 'div', 'desktop-mode-music-widget__card' );
		artBox = el( 'div', 'desktop-mode-music-widget__art' );
		artImg = el( 'img' );
		artImg.alt = '';
		artBox.appendChild( artImg );
		card.appendChild( artBox );

		const meta = el( 'div', 'desktop-mode-music-widget__meta' );
		trackEl = el(
			'div',
			'desktop-mode-music-widget__track',
			__( 'Nothing playing', 'deskbeat-for-desktop-mode' ),
		);
		artistEl = el( 'div', 'desktop-mode-music-widget__artist' );
		meta.append( trackEl, artistEl );
		card.appendChild( meta );

		const browseBtn = iconButton(
			'dashicons-list-view',
			__( 'Browse your library', 'deskbeat-for-desktop-mode' ),
		);
		browseBtn.classList.add( 'desktop-mode-music-widget__open' );
		browseBtn.addEventListener( 'click', showBrowse );

		const disconnectBtn = iconButton(
			'dashicons-exit',
			__( 'Disconnect Spotify', 'deskbeat-for-desktop-mode' ),
		);
		disconnectBtn.classList.add( 'desktop-mode-music-widget__open' );
		disconnectBtn.addEventListener( 'click', () => {
			void ( async () => {
				const ok = await ( desktopApi()?.confirm?.( {
					title: __( 'Disconnect Spotify?', 'deskbeat-for-desktop-mode' ),
					message: __(
						'The desktop will forget your Spotify connection. You can reconnect any time.',
						'deskbeat-for-desktop-mode',
					),
					confirmLabel: __( 'Disconnect', 'deskbeat-for-desktop-mode' ),
					danger: true,
				} ) ?? Promise.resolve( true ) );
				if ( ! ok ) {
					return;
				}
				stop();
				pauseSharedDevice();
				try {
					await disconnect();
				} catch ( err ) {
					toast( ( err as Error ).message, 'error' );
				}
				toast( __( 'Disconnected from Spotify.', 'deskbeat-for-desktop-mode' ) );
				init();
			} )();
		} );

		card.append( browseBtn, disconnectBtn );

		container.appendChild( card );

		// Seek bar — click anywhere to jump. The fill mirrors the poll and
		// is advanced smoothly by the 1s ticker between polls.
		const seekBar = el( 'div', 'desktop-mode-music-widget__seek' );
		seekBar.setAttribute( 'role', 'slider' );
		seekBar.setAttribute(
			'aria-label',
			__( 'Seek', 'deskbeat-for-desktop-mode' ),
		);
		const seekFillEl = el( 'div', 'desktop-mode-music-widget__seek-fill' );
		seekBar.appendChild( seekFillEl );
		seekFill = seekFillEl;
		seekBar.addEventListener( 'click', ( e ) => {
			if ( durationMs <= 0 ) {
				return;
			}
			const rect = seekBar.getBoundingClientRect();
			const pct = Math.min(
				1,
				Math.max( 0, ( e.clientX - rect.left ) / rect.width ),
			);
			const positionMs = Math.round( pct * durationMs );
			progressMs = positionMs;
			progressAt = Date.now();
			paintProgress();
			seek( positionMs, currentDeviceId || undefined )
				.then( () => quickRefresh() )
				.catch( handleControlError );
		} );
		container.appendChild( seekBar );

		const controls = el( 'div', 'desktop-mode-music-widget__controls' );
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

		const run = ( fn: () => Promise< unknown > ) => (): void => {
			fn()
				.then( () => quickRefresh() )
				.catch( handleControlError );
		};
		const volBtn = iconButton(
			'dashicons-controls-volumeon',
			__( 'Volume', 'deskbeat-for-desktop-mode' ),
		);
		volumeBtn = volBtn;

		const shuffleB = iconButton(
			'dashicons-randomize',
			__( 'Shuffle', 'deskbeat-for-desktop-mode' ),
		);
		shuffleBtn = shuffleB;
		const repeatB = iconButton(
			'dashicons-controls-repeat',
			__( 'Repeat', 'deskbeat-for-desktop-mode' ),
		);
		repeatBtn = repeatB;

		shuffleB.addEventListener(
			'click',
			run( () => setShuffle( ! shuffleOn, currentDeviceId || undefined ) ),
		);
		// Cycle off → repeat-all (context) → repeat-one (track) → off.
		repeatB.addEventListener(
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
				// Something is loaded but paused — resume it.
				play().then( () => quickRefresh() ).catch( handleControlError );
				return;
			}
			// Nothing active. Premium accounts can play standalone: spin up
			// the shared in-browser device and take over playback. Free
			// accounts can't (no SDK), so send them to the full player.
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
			);
		} );

		controls.append( shuffleB, prevBtn, playBtn, nextBtn, repeatB, volBtn );
		container.appendChild( controls );

		// Volume slider — collapsible, revealed by the speaker button and
		// shown by the poller only when the device permits volume.
		const vWrap = el( 'div', 'desktop-mode-music-widget__volume-wrap' );
		const vInput = document.createElement( 'input' );
		vInput.type = 'range';
		vInput.min = '0';
		vInput.max = '100';
		vInput.step = '1';
		vInput.value = '100';
		vInput.className = 'desktop-mode-music-widget__volume';
		vWrap.appendChild( vInput );
		vWrap.hidden = true;
		container.appendChild( vWrap );
		volumeWrap = vWrap;
		volumeInput = vInput;

		volBtn.addEventListener( 'click', () => {
			vWrap.hidden = ! vWrap.hidden;
			volBtn.classList.toggle( 'is-primary', ! vWrap.hidden );
		} );

		let volumeTimer: ReturnType< typeof setTimeout > | null = null;
		vInput.addEventListener( 'input', () => {
			const value = Number( vInput.value );
			suppressVolumeUntil = Date.now() + 2000;
			if ( volumeTimer !== null ) {
				clearTimeout( volumeTimer );
			}
			volumeTimer = setTimeout( () => {
				setVolume( value, currentDeviceId || undefined ).catch(
					( err: Error ) => toast( err.message, 'error' ),
				);
			}, 250 );
		} );
	}

	function paint( np: NowPlaying ): void {
		currentDeviceId = np.device?.id ?? '';
		// Playback modes — reflect the device's shuffle / repeat state on
		// the toggle buttons (independent of whether a track is loaded).
		shuffleOn = Boolean( np.shuffle_state );
		if ( shuffleBtn ) {
			shuffleBtn.classList.toggle( 'is-active', shuffleOn );
		}
		repeatMode = np.repeat_state ?? 'off';
		if ( repeatBtn ) {
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
		}
		// Volume: keep the speaker button present as a control; only sync
		// the slider value when the active device reports volume, and skip
		// updating it mid-adjust. If the device can't report/set volume the
		// slider stays collapsed, but the button remains available.
		if ( volumeBtn && volumeWrap && volumeInput ) {
			const dev = np.device;
			volumeBtn.hidden = false;
			if (
				dev &&
				typeof dev.volume_percent === 'number' &&
				dev.supports_volume !== false
			) {
				if ( Date.now() >= suppressVolumeUntil ) {
					volumeInput.value = String( dev.volume_percent );
				}
			} else {
				volumeWrap.hidden = true;
			}
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

	function refresh(): Promise< void > {
		return fetchNowPlaying()
			.then( ( np ) => {
				if ( ! destroyed && built ) {
					paint( np );
				}
			} )
			.catch( () => {
				// Ignore transient poll errors (e.g. no active device).
			} );
	}

	// Spotify's now-playing lags a beat behind a command, so re-poll a
	// few times quickly instead of waiting for the 5s cycle — this is
	// what makes the artwork / track update feel immediate after
	// play / next / previous / selecting a song.
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

	// Rebuild the now-playing view and resume polling.
	function resumeNow(): void {
		buildPlayer();
		quickRefresh();
		timer = setInterval( () => void refresh(), POLL_MS );
	}

	// Swap the widget to the browse view (queue / library / search…).
	function showBrowse(): void {
		stop(); // pause now-playing polling while browsing
		container.replaceChildren();
		const header = el( 'div', 'desktop-mode-music-widget__browse-header' );
		const backBtn = iconButton(
			'dashicons-arrow-left-alt2',
			__( 'Back', 'deskbeat-for-desktop-mode' ),
		);
		backBtn.addEventListener( 'click', resumeNow );
		header.append(
			backBtn,
			el(
				'span',
				'desktop-mode-music-widget__browse-title',
				__( 'Browse', 'deskbeat-for-desktop-mode' ),
			),
		);
		const body = el( 'div', 'desktop-mode-music-widget__browse-body' );
		container.append( header, body );
		renderWidgetBrowse( body, { playItem, toast } );
	}

	// Play a browse-list item, then return to the now-playing view.
	async function playItem( item: BrowseItem ): Promise< void > {
		if ( isPremium ) {
			const dev = await ensureSharedDevice( accountId, ( m ) =>
				toast( m, 'error' ),
			);
			await playUri( item, dev.deviceId );
		} else {
			await playUri( item );
		}
		toast( __( 'Playing…', 'deskbeat-for-desktop-mode' ) );
		resumeNow();
	}

	// Decide which face to show, then poll while connected. Re-runnable
	// (e.g. after a successful connect).
	function init(): void {
		stop();
		fetchState()
			.then( ( state ) => {
				if ( destroyed ) {
					return;
				}
				if ( ! state.connected ) {
					renderConnect( state.canConfigure, state.configured );
					return;
				}
				isPremium = state.profile?.isPremium ?? false;
				accountId = state.profile?.id ?? '';
				buildPlayer();
				void refresh();
				timer = setInterval( () => void refresh(), POLL_MS );
			} )
			.catch( () => {
				if ( ! destroyed ) {
					renderConnect( false, true );
				}
			} );
	}

	// Advance the seek bar smoothly between the 5s polls.
	const progressTimer = setInterval( () => {
		if ( ! destroyed ) {
			paintProgress();
		}
	}, 1000 );

	init();

	return () => {
		destroyed = true;
		stop();
		clearInterval( progressTimer );
	};
}

const widgets = ( window.openStationWidgets ??
	( window.openStationWidgets = {} ) ) as NonNullable<
	Window[ 'openStationWidgets' ]
>;
widgets[ WIDGET_ID ] = mount;
