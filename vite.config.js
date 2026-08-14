/**
 * Vite config for Music Player for Desktop Mode.
 *
 * Builds `src/index.ts` into a self-contained IIFE bundle:
 *
 *   assets/js/music-player-widget.js        (development, unminified)
 *   assets/js/music-player-widget.min.js    (production, minified)
 *   assets/js/music-player-widget[.min].css (co-located styles)
 *
 * The bundle uses Desktop Mode's runtime globals (`window.wp.desktop.*`,
 * `window.wp.i18n`) — nothing from Desktop Mode's source is imported, so
 * this plugin stays a clean, standalone add-on.
 *
 * Build output under assets/js/ is generated — never hand-edit it; edit
 * the TS sources under src/ and run `npm run build`.
 */

import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Two self-contained IIFE bundles, each built in its own pass (selected
// by DESKBEAT_ENTRY): the dock widget and the full-player native window.
const ENTRIES = {
	widget: {
		entry: 'src/index.ts',
		base: 'music-player-widget',
		name: 'musicPlayerForDesktopMode',
	},
	'player-window': {
		entry: 'src/player-window.ts',
		base: 'music-player-window',
		name: 'musicPlayerWindowForDesktopMode',
	},
};

export default defineConfig( ( { mode } ) => {
	const isProd = mode === 'production';
	const target = ENTRIES[ process.env.DESKBEAT_ENTRY ] ?? ENTRIES.widget;
	const base = target.base;

	return {
		build: {
			outDir: 'assets/js',
			// Passes (dev + prod, per entry) write into the same dir —
			// don't let a later run delete what an earlier one produced.
			emptyOutDir: false,
			target: 'es2020',
			minify: isProd ? 'esbuild' : false,
			sourcemap: false,
			lib: {
				entry: resolve( __dirname, target.entry ),
				formats: [ 'iife' ],
				name: target.name,
				fileName: () => ( isProd ? `${ base }.min.js` : `${ base }.js` ),
			},
			rollupOptions: {
				output: {
					// Vite lib mode defaults bundled CSS to `style.css`;
					// rename it to share the JS bundle's base name so
					// `wp_register_style()` finds it.
					assetFileNames: ( asset ) => {
						if ( asset.name && asset.name.endsWith( '.css' ) ) {
							return isProd ? `${ base }.min.css` : `${ base }.css`;
						}
						return '[name].[hash][extname]';
					},
				},
			},
		},
	};
} );
