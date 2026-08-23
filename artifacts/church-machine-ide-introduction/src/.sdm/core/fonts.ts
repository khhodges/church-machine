/**
 * Registered font families for SDM decks. Documents keep storing single
 * family names (`{kind:'family'}` fonts and `theme.fonts` values); at render
 * time a registered name expands to a cross-platform CSS fallback stack, and
 * `buildRegistryFontsCssUrl` lists the Google-hosted faces (the curated
 * Google tier itself plus metric-compatible substitutes for PowerPoint
 * classics) that the slide runtime and workspace preview load as one fixed
 * stylesheet. Unregistered families pass through verbatim so imported PPTX
 * decks are untouched, and only this fixed set ever reaches a Google Fonts
 * URL — arbitrary document text must not egress.
 */

export type SdmFontTier = 'classic' | 'google';

export type SdmFontCategory = 'display' | 'mono' | 'sans' | 'script' | 'serif';

export interface SdmWebFontFamily {
  family: string;
  /**
   * css2 `wght` axis selector (`400;700` or `100..900`). `null` requests the
   * default face only; an unsupported axis 404s the whole combined
   * stylesheet, so every value here must match what Google Fonts serves.
   */
  weights: string | null;
}

export interface SdmRegisteredFont {
  family: string;
  tier: SdmFontTier;
  category: SdmFontCategory;
  /** CSS stack rendered after the family, ending in a generic keyword. */
  fallbacks: ReadonlyArray<string>;
  /** Google-hosted faces this entry needs in the registry stylesheet. */
  webFamilies: ReadonlyArray<SdmWebFontFamily>;
}

const classic = (
  family: string,
  category: SdmFontCategory,
  fallbacks: ReadonlyArray<string>,
  webFamilies: ReadonlyArray<SdmWebFontFamily> = [],
): SdmRegisteredFont => ({
  family,
  tier: 'classic',
  category,
  fallbacks,
  webFamilies,
});

const google = (
  family: string,
  category: SdmFontCategory,
  weights: string | null,
  generic: string,
): SdmRegisteredFont => ({
  family,
  tier: 'google',
  category,
  fallbacks: [generic],
  webFamilies: [{ family, weights }],
});

export const SDM_FONT_REGISTRY: ReadonlyArray<SdmRegisteredFont> = [
  classic('Aptos', 'sans', ['Segoe UI', 'Arial', 'sans-serif']),
  classic('Aptos Display', 'sans', [
    'Aptos',
    'Segoe UI',
    'Arial',
    'sans-serif',
  ]),
  classic(
    'Arial',
    'sans',
    ['Arimo', 'Helvetica', 'sans-serif'],
    [{ family: 'Arimo', weights: '400..700' }],
  ),
  classic('Book Antiqua', 'serif', ['Palatino Linotype', 'Palatino', 'serif']),
  classic(
    'Calibri',
    'sans',
    ['Carlito', 'sans-serif'],
    [{ family: 'Carlito', weights: '400;700' }],
  ),
  classic(
    'Cambria',
    'serif',
    ['Caladea', 'serif'],
    [{ family: 'Caladea', weights: '400;700' }],
  ),
  classic(
    'Century Gothic',
    'sans',
    ['Poppins', 'sans-serif'],
    [{ family: 'Poppins', weights: '100;200;300;400;500;600;700;800;900' }],
  ),
  classic(
    'Comic Sans MS',
    'script',
    ['Comic Neue', 'cursive'],
    [{ family: 'Comic Neue', weights: '300;400;700' }],
  ),
  classic(
    'Courier New',
    'mono',
    ['Cousine', 'Liberation Mono', 'monospace'],
    [{ family: 'Cousine', weights: '400;700' }],
  ),
  classic(
    'Garamond',
    'serif',
    ['EB Garamond', 'serif'],
    [{ family: 'EB Garamond', weights: '400..800' }],
  ),
  classic(
    'Georgia',
    'serif',
    ['Gelasio', 'serif'],
    [{ family: 'Gelasio', weights: '400..700' }],
  ),
  classic(
    'Helvetica',
    'sans',
    ['Arial', 'Arimo', 'sans-serif'],
    [{ family: 'Arimo', weights: '400..700' }],
  ),
  classic(
    'Impact',
    'display',
    ['Anton', 'Arial Narrow', 'sans-serif'],
    [{ family: 'Anton', weights: null }],
  ),
  classic('Segoe UI', 'sans', ['Arial', 'sans-serif']),
  classic('Tahoma', 'sans', ['Verdana', 'DejaVu Sans', 'sans-serif']),
  classic(
    'Times New Roman',
    'serif',
    ['Tinos', 'Liberation Serif', 'serif'],
    [{ family: 'Tinos', weights: '400;700' }],
  ),
  classic('Trebuchet MS', 'sans', ['sans-serif']),
  classic('Verdana', 'sans', ['DejaVu Sans', 'Geneva', 'sans-serif']),
  google('Anton', 'display', null, 'sans-serif'),
  google('Archivo', 'sans', '100..900', 'sans-serif'),
  google('Bebas Neue', 'display', null, 'sans-serif'),
  google('Caveat', 'script', '400..700', 'cursive'),
  google('DM Mono', 'mono', '300;400;500', 'monospace'),
  google('DM Sans', 'sans', '100..1000', 'sans-serif'),
  google('EB Garamond', 'serif', '400..800', 'serif'),
  google('Fraunces', 'serif', '100..900', 'serif'),
  google('Inter', 'sans', '100..900', 'sans-serif'),
  google('Instrument Serif', 'serif', null, 'serif'),
  google('JetBrains Mono', 'mono', '100..800', 'monospace'),
  google('Lato', 'sans', '100;300;400;700;900', 'sans-serif'),
  google('Libre Baskerville', 'serif', '400;700', 'serif'),
  google('Libre Franklin', 'sans', '100..900', 'sans-serif'),
  google('Lora', 'serif', '400..700', 'serif'),
  google('Manrope', 'sans', '200..800', 'sans-serif'),
  google('Merriweather', 'serif', '300..900', 'serif'),
  google('Montserrat', 'sans', '100..900', 'sans-serif'),
  google('Nunito', 'sans', '200..1000', 'sans-serif'),
  google('Open Sans', 'sans', '300..800', 'sans-serif'),
  google('Outfit', 'sans', '100..900', 'sans-serif'),
  google('Playfair Display', 'serif', '400..900', 'serif'),
  google('Plus Jakarta Sans', 'sans', '200..800', 'sans-serif'),
  google(
    'Poppins',
    'sans',
    '100;200;300;400;500;600;700;800;900',
    'sans-serif',
  ),
  google('Raleway', 'sans', '100..900', 'sans-serif'),
  google('Roboto', 'sans', '100..900', 'sans-serif'),
  google('Source Serif 4', 'serif', '200..900', 'serif'),
  google('Space Grotesk', 'sans', '300..700', 'sans-serif'),
  google('Work Sans', 'sans', '100..900', 'sans-serif'),
];

const registryByKey = new Map(
  SDM_FONT_REGISTRY.map((entry) => [familyKey(entry.family), entry]),
);

function familyKey(family: string): string {
  return family.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function getRegisteredFont(
  family: string,
): SdmRegisteredFont | undefined {
  return registryByKey.get(familyKey(family));
}

const GENERIC_FAMILIES = new Set([
  'cursive',
  'fantasy',
  'monospace',
  'sans-serif',
  'serif',
  'system-ui',
]);

function quoteFamily(family: string): string {
  return GENERIC_FAMILIES.has(family) ? family : `'${family}'`;
}

/**
 * Full quoted CSS `font-family` stack for a registered family, or
 * `undefined` for unregistered families so callers keep today's verbatim
 * behavior.
 */
export function fontFamilyCss(family: string): string | undefined {
  const entry = getRegisteredFont(family);
  if (entry === undefined) {
    return undefined;
  }

  return [entry.family, ...entry.fallbacks].map(quoteFamily).join(', ');
}

const GOOGLE_FONTS_CSS_BASE = 'https://fonts.googleapis.com/css2';

/**
 * One combined Google Fonts css2 URL covering every registry web face. The
 * CSS is small and font bytes only download for families the page actually
 * uses, so consumers load this unconditionally instead of tracking which
 * families a document references.
 */
export function buildRegistryFontsCssUrl(): string {
  const byFamily = new Map<string, SdmWebFontFamily>();
  for (const entry of SDM_FONT_REGISTRY) {
    for (const webFamily of entry.webFamilies) {
      if (!byFamily.has(webFamily.family)) {
        byFamily.set(webFamily.family, webFamily);
      }
    }
  }
  const params = [...byFamily.values()]
    .sort((a, b) => a.family.localeCompare(b.family))
    .map(({ family, weights }) => {
      const name = encodeURIComponent(family).replace(/%20/g, '+');

      return weights === null
        ? `family=${name}`
        : `family=${name}:wght@${weights}`;
    })
    .join('&');

  return `${GOOGLE_FONTS_CSS_BASE}?${params}&display=swap`;
}

/**
 * Nearest registered family for a possibly misspelled name (edit distance
 * at most 2 after case/whitespace normalization), for validation messages.
 */
export function suggestRegisteredFont(family: string): string | undefined {
  const target = familyKey(family);
  if (target === '' || target.length > 64) {
    return undefined;
  }
  const exact = registryByKey.get(target);
  if (exact !== undefined) {
    return exact.family;
  }

  let best: SdmRegisteredFont | undefined;
  let bestDistance = 3;
  for (const entry of SDM_FONT_REGISTRY) {
    const distance = editDistance(target, familyKey(entry.family));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }

  return best?.family;
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) {
    return 3;
  }
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }

  return previous[b.length] ?? 3;
}
