/**
 * Desktop Mode — Music Player: shared in-browser playback device.
 *
 * The window and the widget compile to separate bundles but must drive
 * ONE Spotify Web Playback SDK device, not two competing ones. The live
 * player object is therefore parked on a `window`-global holder that
 * both bundles read: whichever surface creates the device first, the
 * other reuses it. This is what lets the widget control (and start)
 * playback standalone, while staying in sync with the window.
 *
 * @since 0.9.7
 */

import { __ } from './i18n';
import { transfer } from './api';
import { createPlaybackDevice, type PlaybackDevice } from './playback';

interface SharedHolder {
	device: PlaybackDevice | null;
	accountId: string;
	creating: Promise< PlaybackDevice > | null;
}

/** The single cross-bundle holder, lazily created on `window`. */
function holder(): SharedHolder {
	const w = window as unknown as {
		__desktopModeMusicPlayerDevice?: SharedHolder;
	};
	if ( ! w.__desktopModeMusicPlayerDevice ) {
		w.__desktopModeMusicPlayerDevice = {
			device: null,
			accountId: '',
			creating: null,
		};
	}
	return w.__desktopModeMusicPlayerDevice;
}

function sleep( ms: number ): Promise< void > {
	return new Promise( ( resolve ) => setTimeout( resolve, ms ) );
}

/** The current shared device id, or '' when none exists yet. */
export function sharedDeviceId(): string {
	return holder().device?.deviceId ?? '';
}

/**
 * Get (or create) the shared in-browser device for `accountId`. A
 * concurrent call while one creation is in flight awaits the same
 * promise (no duplicate devices). Rebuilds cleanly if the connected
 * account changed.
 *
 * @param accountId Spotify account id the device belongs to.
 * @param onError   Surface SDK errors (e.g. non-Premium) to the caller.
 */
export async function ensureSharedDevice(
	accountId: string,
	onError: ( message: string ) => void,
): Promise< PlaybackDevice > {
	const shared = holder();
	if ( shared.device && shared.accountId === accountId ) {
		return shared.device;
	}
	if ( shared.creating ) {
		return shared.creating;
	}
	if ( shared.device && shared.accountId !== accountId ) {
		// Account changed — tear the old device down and let Spotify
		// deregister it before creating the new one.
		try {
			shared.device.player.disconnect();
		} catch {
			// Already gone.
		}
		shared.device = null;
		await sleep( 1200 );
	}
	shared.creating = createPlaybackDevice(
		__( 'Desktop Mode', 'deskbeat-for-desktop-mode' ),
		{ onError },
	)
		.then( ( dev ) => {
			shared.device = dev;
			shared.accountId = accountId;
			shared.creating = null;
			return dev;
		} )
		.catch( ( err ) => {
			shared.creating = null;
			throw err;
		} );
	return shared.creating;
}

/**
 * Transfer playback onto a device, retrying the transient "Device not
 * found" 404 Spotify returns for a moment after a freshly-created
 * device registers.
 */
export async function transferToSharedDevice( deviceId: string ): Promise< void > {
	let lastError: unknown;
	for ( let attempt = 0; attempt < 6; attempt++ ) {
		try {
			await transfer( deviceId, true );
			return;
		} catch ( err ) {
			lastError = err;
			await sleep( 600 );
		}
	}
	throw lastError instanceof Error
		? lastError
		: new Error( 'Could not transfer playback to this device.' );
}

/**
 * Pause the shared device without tearing it down — used on window
 * close / disconnect so audio stops but the device stays registered
 * (recreating it is what caused "Device not found").
 */
export function pauseSharedDevice(): void {
	const shared = holder();
	if ( shared.device ) {
		try {
			void shared.device.player.pause();
		} catch {
			// Nothing playing / player gone.
		}
	}
}
