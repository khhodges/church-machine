import type { CSSProperties } from 'react';
import {
  SDM_POINT_TO_UNIT,
  type Asset,
  type Color,
  type Font,
  type Paint,
  type RunStyle,
  type Stroke,
  type Theme,
} from './core/schema';
import {
  effectiveRunStyleCss,
  resolveTextColor,
  resolveTextFont,
} from './core/text/inlineStyles';

export function resolveColor(color: Color, theme?: Theme): string {
  return resolveTextColor(color, theme);
}

export function resolvePaint(
  color: Color,
  opacity: number | undefined,
  theme?: Theme,
): string {
  const hex = resolveColor(color, theme);
  if (opacity === undefined || opacity >= 1) {
    return hex;
  }
  const red = parseInt(hex.slice(1, 3), 16);
  const green = parseInt(hex.slice(3, 5), 16);
  const blue = parseInt(hex.slice(5, 7), 16);

  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

const SAFE_ACTION_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function sanitizeActionUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url, 'https://sdm.invalid/');

    return SAFE_ACTION_PROTOCOLS.has(parsed.protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

export function resolveFont(
  font: Font | undefined,
  theme?: Theme,
): string | undefined {
  return resolveTextFont(font, theme);
}

export function resolveAssetSrc(
  assets: Record<string, Asset> | undefined,
  assetId: string,
  baseUrl: string,
): string | undefined {
  const src =
    assets !== undefined && Object.hasOwn(assets, assetId)
      ? assets[assetId].src
      : undefined;
  if (!src) {
    return undefined;
  }
  if (/^(https?:|data:|blob:|\/)/i.test(src)) {
    return src;
  }

  return `${baseUrl.replace(/\/$/, '')}/${src.replace(/^\//, '')}`;
}

function cssUrl(src: string): string {
  const escaped = src.replace(
    /["\\\n\r\f]/g,
    (char) => `\\${char.charCodeAt(0).toString(16)} `,
  );

  return `url("${escaped}")`;
}

export function paintToBackground(
  paint: Paint,
  theme: Theme | undefined,
  resolveAsset: (assetId: string) => string | undefined,
): { background: string; opacity?: number } | undefined {
  switch (paint.kind) {
    case 'none':
      return undefined;
    case 'solid':
      return { background: resolvePaint(paint.color, paint.opacity, theme) };
    case 'linearGradient':
      return {
        background: `linear-gradient(${paint.angleDeg}deg, ${paint.stops
          .map(
            (stop) =>
              `${resolvePaint(stop.color, stop.opacity, theme)} ${Math.round(stop.offset * 100)}%`,
          )
          .join(', ')})`,
      };
    case 'image': {
      const src = resolveAsset(paint.assetId);
      const size = paint.fit === 'fill' ? '100% 100%' : paint.fit;

      return src
        ? {
            background: `center / ${size} no-repeat ${cssUrl(src)}`,
            opacity: paint.opacity,
          }
        : undefined;
    }
  }
}

export function strokeToBorder(
  stroke: Stroke | undefined,
  theme?: Theme,
): string | undefined {
  if (!stroke) {
    return undefined;
  }
  let dash = 'solid';
  if (stroke.dash === 'dash') {
    dash = 'dashed';
  } else if (stroke.dash === 'dot') {
    dash = 'dotted';
  }

  return `${stroke.widthPt * SDM_POINT_TO_UNIT}px ${dash} ${resolvePaint(stroke.color, stroke.opacity, theme)}`;
}

export function textRunStyle(run: RunStyle, theme?: Theme): CSSProperties {
  return effectiveRunStyleCss(run, theme);
}
