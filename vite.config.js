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

export default defineConfig( ( { mode } ) => {
	const isProd = mode === 'production';
	const base = 'music-player-widget';

	return {
		build: {
			outDir: 'assets/js',
			// Two passes (dev + prod) write into the same dir — don't let
			// the second run delete what the first produced.
			emptyOutDir: false,
			target: 'es2020',
			minify: isProd ? 'esbuild' : false,
			sourcemap: false,
			lib: {
				entry: resolve( __dirname, 'src/index.ts' ),
				formats: [ 'iife' ],
				name: 'musicPlayerForDesktopMode',
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
