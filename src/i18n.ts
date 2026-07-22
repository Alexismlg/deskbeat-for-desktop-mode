/**
 * Tiny i18n shim over WordPress's `wp.i18n` global (script dep
 * `wp-i18n`), so the bundle doesn't need to bundle `@wordpress/i18n`.
 * Falls back to the raw string when unavailable.
 *
 * @since 1.0.0
 */

interface WpI18n {
	__( text: string, domain?: string ): string;
	_n( single: string, plural: string, n: number, domain?: string ): string;
	sprintf( format: string, ...args: Array< string | number > ): string;
}

function i18n(): WpI18n | undefined {
	return ( window as unknown as { wp?: { i18n?: WpI18n } } ).wp?.i18n;
}

export function __( text: string, domain?: string ): string {
	const api = i18n();
	return api?.__ ? api.__( text, domain ) : text;
}
