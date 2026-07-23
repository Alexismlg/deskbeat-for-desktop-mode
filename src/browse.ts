/**
 * Desktop Mode — Music Player widget: Browse + Search.
 *
 * The widget-native version of the browse view (native controls, since
 * `wpd-*` clicks don't fire inside the widgets layer). Reuses the data
 * layer (`fetchBrowse` / `fetchSearch`) and pages by echoing the opaque
 * `next` cursor; the queue is unpaginated, every other section — Search
 * included — infinite-scrolls.
 *
 * @since 0.9.7
 */

import { __ } from './i18n';
import {
	fetchBrowse,
	fetchSearch,
	type BrowseItem,
	type BrowseSection,
} from './api';

export interface WidgetBrowseDeps {
	playItem: ( item: BrowseItem ) => Promise< void >;
	toast: ( message: string, type?: 'success' | 'error' ) => void;
}

const SECTIONS: Array< { id: BrowseSection; label: string } > = [
	{ id: 'queue', label: __( 'Queue', 'deskbeat-for-desktop-mode' ) },
	{ id: 'library', label: __( 'Liked', 'deskbeat-for-desktop-mode' ) },
	{ id: 'top', label: __( 'Top', 'deskbeat-for-desktop-mode' ) },
	{ id: 'recently-played', label: __( 'Recent', 'deskbeat-for-desktop-mode' ) },
	{ id: 'playlists', label: __( 'Playlists', 'deskbeat-for-desktop-mode' ) },
	{ id: 'search', label: __( 'Search', 'deskbeat-for-desktop-mode' ) },
];

const SCROLL_THRESHOLD_PX = 48;
const SEARCH_DEBOUNCE_MS = 350;

function node( tag: string, className?: string, text?: string ): HTMLElement {
	const element = document.createElement( tag );
	if ( className ) {
		element.className = className;
	}
	if ( text !== undefined ) {
		element.textContent = text;
	}
	return element;
}

/** Render the browse UI into `container`. */
export function renderWidgetBrowse(
	container: HTMLElement,
	deps: WidgetBrowseDeps,
): void {
	container.replaceChildren();
	container.classList.add( 'desktop-mode-music-widget__browse' );

	const nav = node( 'div', 'desktop-mode-music-widget__browse-nav' );
	const searchInput = document.createElement( 'input' );
	searchInput.type = 'search';
	searchInput.className = 'desktop-mode-music-widget__search';
	searchInput.placeholder = __( 'Search songs or artists…', 'deskbeat-for-desktop-mode' );
	searchInput.hidden = true;
	const list = node( 'div', 'desktop-mode-music-widget__browse-list' );
	container.append( nav, searchInput, list );

	let active: BrowseSection = 'queue';
	let cursor: string | null = null;
	let searchQuery = '';
	let loading = false;
	let epoch = 0;
	let searchTimer: ReturnType< typeof setTimeout > | null = null;
	const chips = new Map< BrowseSection, HTMLElement >();

	function buildRow( item: BrowseItem ): HTMLElement {
		const row = document.createElement( 'button' );
		row.type = 'button';
		row.className = 'desktop-mode-music-widget__row';
		row.title = item.name;

		const thumb = node( 'span', 'desktop-mode-music-widget__row-thumb' );
		if ( item.image ) {
			const img = document.createElement( 'img' );
			img.src = item.image;
			img.alt = '';
			thumb.appendChild( img );
		}
		const meta = node( 'span', 'desktop-mode-music-widget__row-meta' );
		meta.appendChild(
			node( 'span', 'desktop-mode-music-widget__row-name', item.name ),
		);
		if ( item.subtitle ) {
			meta.appendChild(
				node( 'span', 'desktop-mode-music-widget__row-subtitle', item.subtitle ),
			);
		}
		row.append( thumb, meta );
		row.addEventListener( 'click', () => {
			deps
				.playItem( item )
				.catch( ( err: Error ) => deps.toast( err.message, 'error' ) );
		} );
		return row;
	}

	function appendRows( items: BrowseItem[] ): void {
		const fragment = document.createDocumentFragment();
		for ( const item of items ) {
			fragment.appendChild( buildRow( item ) );
		}
		list.appendChild( fragment );
	}

	function showEmpty( message: string ): void {
		list.replaceChildren(
			node( 'p', 'desktop-mode-music-widget__browse-empty', message ),
		);
	}

	function loadPage( initial: boolean ): void {
		if ( ! initial && loading ) {
			return;
		}
		loading = true;
		const myEpoch = epoch;
		if ( initial ) {
			list.replaceChildren(
				node(
					'p',
					'desktop-mode-music-widget__browse-empty',
					__( 'Loading…', 'deskbeat-for-desktop-mode' ),
				),
			);
		}

		const fetcher =
			active === 'search'
				? fetchSearch( searchQuery, initial ? undefined : cursor ?? undefined )
				: fetchBrowse( active, initial ? undefined : cursor ?? undefined );

		fetcher
			.then( ( page ) => {
				if ( myEpoch !== epoch ) {
					return;
				}
				if ( initial ) {
					list.replaceChildren();
					if ( page.items.length === 0 ) {
						showEmpty(
							active === 'search'
								? __( 'No results.', 'deskbeat-for-desktop-mode' )
								: __( 'Nothing here yet.', 'deskbeat-for-desktop-mode' ),
						);
					}
				}
				appendRows( page.items );
				cursor = page.next;
			} )
			.catch( ( err: Error ) => {
				if ( myEpoch !== epoch ) {
					return;
				}
				if ( initial ) {
					showEmpty(
						__( 'Could not load this list.', 'deskbeat-for-desktop-mode' ) +
							' ' +
							err.message,
					);
				} else {
					deps.toast( err.message, 'error' );
				}
			} )
			.finally( () => {
				loading = false;
			} );
	}

	list.addEventListener( 'scroll', () => {
		if (
			! loading &&
			cursor !== null &&
			list.scrollTop + list.clientHeight >=
				list.scrollHeight - SCROLL_THRESHOLD_PX
		) {
			loadPage( false );
		}
	} );

	function runSearch( query: string ): void {
		epoch += 1;
		cursor = null;
		searchQuery = query.trim();
		if ( searchQuery === '' ) {
			showEmpty( __( 'Type to search songs and artists.', 'deskbeat-for-desktop-mode' ) );
			return;
		}
		loadPage( true );
	}

	searchInput.addEventListener( 'input', () => {
		if ( searchTimer !== null ) {
			clearTimeout( searchTimer );
		}
		const value = searchInput.value;
		searchTimer = setTimeout( () => runSearch( value ), SEARCH_DEBOUNCE_MS );
	} );

	function setActive( section: BrowseSection ): void {
		active = section;
		cursor = null;
		epoch += 1;
		for ( const [ id, chip ] of chips ) {
			chip.classList.toggle( 'is-active', id === section );
		}
		const isSearch = section === 'search';
		searchInput.hidden = ! isSearch;
		if ( isSearch ) {
			runSearch( searchInput.value );
		} else {
			loadPage( true );
		}
	}

	for ( const section of SECTIONS ) {
		const chip = document.createElement( 'button' );
		chip.type = 'button';
		chip.className = 'desktop-mode-music-widget__chip';
		chip.classList.toggle( 'is-active', section.id === active );
		chip.textContent = section.label;
		chip.addEventListener( 'click', () => setActive( section.id ) );
		chips.set( section.id, chip );
		nav.appendChild( chip );
	}

	setActive( active );
}
