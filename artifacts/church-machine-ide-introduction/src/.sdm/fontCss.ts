import { buildRegistryFontsCssUrl } from './core/fonts';

const REGISTRY_FONTS_ATTRIBUTE = 'data-sdm-registry-fonts';

/**
 * Loads the fixed SDM registry stylesheet once per page. The CSS is small
 * and font bytes only download for families the slide actually uses, so
 * every registered family renders without a matching `index.html` link.
 */
export function ensureRegistryFontsStylesheet(): void {
  if (typeof document === 'undefined') {
    return;
  }
  if (
    document.head.querySelector(`link[${REGISTRY_FONTS_ATTRIBUTE}]`) !== null
  ) {
    return;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = buildRegistryFontsCssUrl();
  link.setAttribute(REGISTRY_FONTS_ATTRIBUTE, '');
  document.head.appendChild(link);
}
