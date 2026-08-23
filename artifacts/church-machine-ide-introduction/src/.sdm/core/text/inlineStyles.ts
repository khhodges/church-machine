import { fontFamilyCss } from '../fonts';
import {
  SDM_DEFAULT_TEXT_SIZE_PT,
  SDM_POINT_TO_UNIT,
  type Color,
  type Font,
  type Paragraph,
  type RunStyle,
  type Theme,
} from '../schema';
import type { EffectiveParagraph } from './listStyles';

export interface SdmTextCssStyle {
  backgroundColor?: string;
  color?: string;
  display?: 'inline-block';
  fontFamily?: string;
  fontSize?: string;
  fontStyle?: 'italic' | 'normal';
  fontWeight?: number;
  letterSpacing?: string;
  lineHeight?: number;
  marginBottom?: string;
  marginTop?: string;
  minWidth?: string;
  paddingLeft?: string;
  textAlign?: Paragraph['align'];
  textDecoration?: string;
  textIndent?: string;
  whiteSpace?: 'pre-wrap';
}

function themeValue(
  record: Record<string, string> | undefined,
  token: string,
): string | undefined {
  return record !== undefined && Object.hasOwn(record, token)
    ? record[token]
    : undefined;
}

export function resolveTextColor(color: Color, theme?: Theme): string {
  if (color.kind === 'rgb') {
    return color.value;
  }

  return themeValue(theme?.colors, color.token) ?? '#000000';
}

export function resolveTextFont(
  font: Font | undefined,
  theme?: Theme,
): string | undefined {
  if (font === undefined) {
    return undefined;
  }
  const family =
    font.kind === 'family' ? font.family : themeValue(theme?.fonts, font.token);
  if (family === undefined) {
    return undefined;
  }

  return fontFamilyCss(family) ?? family;
}

export function runStylePropertyCss(
  style: Partial<RunStyle>,
  theme?: Theme,
): SdmTextCssStyle {
  const hasTextDecoration =
    Object.hasOwn(style, 'underline') || Object.hasOwn(style, 'strike');

  return {
    ...(style.color === undefined
      ? {}
      : { color: resolveTextColor(style.color, theme) }),
    ...(style.highlight === undefined
      ? {}
      : { backgroundColor: resolveTextColor(style.highlight, theme) }),
    ...(style.font === undefined
      ? {}
      : { fontFamily: resolveTextFont(style.font, theme) }),
    ...(style.sizePt === undefined
      ? {}
      : { fontSize: `${style.sizePt * SDM_POINT_TO_UNIT}px` }),
    ...(style.weight === undefined ? {} : { fontWeight: style.weight }),
    ...(style.italic === undefined
      ? {}
      : { fontStyle: style.italic ? 'italic' : 'normal' }),
    ...(hasTextDecoration
      ? {
          textDecoration:
            [
              style.underline ? 'underline' : '',
              style.strike ? 'line-through' : '',
            ]
              .filter(Boolean)
              .join(' ') || 'none',
        }
      : {}),
    ...(style.letterSpacingPt === undefined
      ? {}
      : {
          letterSpacing: `${style.letterSpacingPt * SDM_POINT_TO_UNIT}px`,
        }),
  };
}

export function effectiveRunStyleCss(
  style: RunStyle,
  theme?: Theme,
): SdmTextCssStyle {
  return {
    fontSize: `${(style.sizePt ?? SDM_DEFAULT_TEXT_SIZE_PT) * SDM_POINT_TO_UNIT}px`,
    whiteSpace: 'pre-wrap',
    ...runStylePropertyCss(style, theme),
  };
}

export function paragraphLayoutCss(
  paragraph: EffectiveParagraph,
): SdmTextCssStyle {
  return {
    textAlign: paragraph.align,
    lineHeight: paragraph.lineHeight,
    paddingLeft:
      paragraph.indentPt === 0
        ? undefined
        : `${paragraph.indentPt * SDM_POINT_TO_UNIT}px`,
    textIndent:
      paragraph.hangingIndentPt === 0
        ? undefined
        : `${-paragraph.hangingIndentPt * SDM_POINT_TO_UNIT}px`,
    marginTop:
      paragraph.spaceBeforePt === 0
        ? undefined
        : `${paragraph.spaceBeforePt * SDM_POINT_TO_UNIT}px`,
    marginBottom:
      paragraph.spaceAfterPt === 0
        ? undefined
        : `${paragraph.spaceAfterPt * SDM_POINT_TO_UNIT}px`,
  };
}

export function paragraphMarkerCss(
  paragraph: EffectiveParagraph,
  theme?: Theme,
): SdmTextCssStyle {
  return {
    ...effectiveRunStyleCss(
      {
        ...paragraph.defaultRunStyle,
        ...paragraph.runs[0],
        ...paragraph.markerStyle,
      },
      theme,
    ),
    display: 'inline-block',
    minWidth: `${paragraph.hangingIndentPt * SDM_POINT_TO_UNIT}px`,
    textIndent: '0',
  };
}
