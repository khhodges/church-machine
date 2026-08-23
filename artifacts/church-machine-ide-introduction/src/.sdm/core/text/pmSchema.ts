import { Value } from '@sinclair/typebox/value';
import {
  Schema,
  type Attrs,
  type DOMOutputSpec,
  type MarkSpec,
  type NodeSpec,
} from 'prosemirror-model';

import { fontFamilyCss } from '../fonts';
import {
  ActionSchema,
  BulletSchema,
  ColorSchema,
  FontSchema,
  RunStyleSchema,
  SDM_POINT_TO_UNIT,
  type Bullet,
  type Color,
  type Insets,
  type Paragraph,
  type RunStyle,
  type TextBody,
} from '../schema';

export interface SdmTextDocAttrs {
  insetsPt: Insets | null;
  overflow: TextBody['overflow'] | null;
  verticalAlign: TextBody['verticalAlign'] | null;
}

export interface SdmParagraphAttrs {
  align: Paragraph['align'] | null;
  bullet: Bullet | null;
  defaultRunStyle: RunStyle | null;
  hangingIndentPt: number | null;
  indentPt: number | null;
  level: number | null;
  lineHeight: number | null;
  markerStyle: RunStyle | null;
  spaceAfterPt: number | null;
  spaceBeforePt: number | null;
  synthetic: boolean;
}

function valueAttribute(name: string, value: unknown): Record<string, string> {
  return value === null || value === undefined
    ? {}
    : { [name]: JSON.stringify(value) };
}

function styledSpan(
  dataName: string,
  value: unknown,
  style?: string,
): DOMOutputSpec {
  return [
    'span',
    {
      ...valueAttribute(dataName, value),
      ...(style === undefined ? {} : { style }),
    },
    0,
  ];
}

function colorStyle(property: string, color: Color | null): string | undefined {
  return color?.kind === 'rgb' ? `${property}: ${color.value}` : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDomElement(node: Node | string): node is Element {
  return typeof node !== 'string' && node.nodeType === Node.ELEMENT_NODE;
}

function parsedAttribute(node: Node | string, name: string): unknown {
  if (!isDomElement(node)) {
    return undefined;
  }
  const value = node.getAttribute(name);
  if (value === null) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function optionalNumber(
  value: unknown,
  predicate: (candidate: number) => boolean,
): number | null {
  return typeof value === 'number' && Number.isFinite(value) && predicate(value)
    ? value
    : null;
}

function paragraphAttrsFromDOM(node: Node | string): Attrs | false {
  const value = parsedAttribute(node, 'data-sdm-paragraph-attrs');
  if (!isRecord(value)) {
    return false;
  }
  const align =
    value.align === 'left' ||
    value.align === 'center' ||
    value.align === 'right' ||
    value.align === 'justify'
      ? value.align
      : null;

  return {
    align,
    bullet: Value.Check(BulletSchema, value.bullet) ? value.bullet : null,
    defaultRunStyle: Value.Check(RunStyleSchema, value.defaultRunStyle)
      ? value.defaultRunStyle
      : null,
    hangingIndentPt: optionalNumber(
      value.hangingIndentPt,
      (candidate) => candidate >= 0,
    ),
    indentPt: optionalNumber(value.indentPt, (candidate) => candidate >= 0),
    level: optionalNumber(
      value.level,
      (candidate) =>
        Number.isInteger(candidate) && candidate >= 0 && candidate <= 8,
    ),
    lineHeight: optionalNumber(value.lineHeight, (candidate) => candidate > 0),
    markerStyle: Value.Check(RunStyleSchema, value.markerStyle)
      ? value.markerStyle
      : null,
    spaceAfterPt: optionalNumber(
      value.spaceAfterPt,
      (candidate) => candidate >= 0,
    ),
    spaceBeforePt: optionalNumber(
      value.spaceBeforePt,
      (candidate) => candidate >= 0,
    ),
    synthetic: false,
  };
}

const doc: NodeSpec = {
  attrs: {
    insetsPt: { default: null },
    overflow: { default: null },
    verticalAlign: { default: null },
  },
  content: 'paragraph+',
};

const paragraph: NodeSpec = {
  attrs: {
    align: { default: null },
    bullet: { default: null },
    defaultRunStyle: { default: null },
    hangingIndentPt: { default: null },
    indentPt: { default: null },
    level: { default: null },
    lineHeight: { default: null },
    markerStyle: { default: null },
    spaceAfterPt: { default: null },
    spaceBeforePt: { default: null },
    synthetic: { default: false },
  },
  content: 'inline*',
  group: 'block',
  parseDOM: [
    {
      tag: 'div[data-sdm-text-paragraph]',
      getAttrs: paragraphAttrsFromDOM,
    },
    { tag: 'p' },
    { tag: 'div' },
  ],
  toDOM(node) {
    const level =
      typeof node.attrs.level === 'number' && Number.isInteger(node.attrs.level)
        ? node.attrs.level
        : 0;
    const bullet: unknown = node.attrs.bullet;
    const hasMarker =
      isRecord(bullet) &&
      (bullet.kind === 'character' || bullet.kind === 'number');

    return [
      'div',
      {
        'data-sdm-text-paragraph': '',
        'data-sdm-level': String(level),
        ...(hasMarker ? { 'data-sdm-has-marker': 'true' } : {}),
        ...valueAttribute('data-sdm-paragraph-attrs', node.attrs),
      },
      0,
    ];
  },
};

const hardBreak: NodeSpec = {
  group: 'inline',
  inline: true,
  selectable: false,
  parseDOM: [{ tag: 'br' }],
  toDOM: () => ['br'],
};

const font: MarkSpec = {
  attrs: { font: {} },
  parseDOM: [
    {
      tag: 'span[data-sdm-font]',
      getAttrs(node) {
        const value = parsedAttribute(node, 'data-sdm-font');

        return Value.Check(FontSchema, value) ? { font: value } : false;
      },
    },
  ],
  toDOM(mark) {
    const value: unknown = mark.attrs.font;
    const family =
      typeof value === 'object' &&
      value !== null &&
      'kind' in value &&
      value.kind === 'family' &&
      'family' in value &&
      typeof value.family === 'string'
        ? value.family
        : undefined;

    return styledSpan(
      'data-sdm-font',
      value,
      family === undefined
        ? undefined
        : `font-family: ${fontFamilyCss(family) ?? JSON.stringify(family)}`,
    );
  },
};

const sizePt: MarkSpec = {
  attrs: { sizePt: {} },
  parseDOM: [
    {
      tag: 'span[data-sdm-size-pt]',
      getAttrs(node) {
        const value = parsedAttribute(node, 'data-sdm-size-pt');

        return typeof value === 'number' && Number.isFinite(value) && value > 0
          ? { sizePt: value }
          : false;
      },
    },
  ],
  toDOM(mark) {
    const value: unknown = mark.attrs.sizePt;

    return styledSpan(
      'data-sdm-size-pt',
      value,
      typeof value === 'number'
        ? `font-size: ${value * SDM_POINT_TO_UNIT}px`
        : undefined,
    );
  },
};

const weight: MarkSpec = {
  attrs: { weight: {} },
  parseDOM: [
    {
      tag: 'span[data-sdm-weight]',
      getAttrs(node) {
        const value = parsedAttribute(node, 'data-sdm-weight');

        return typeof value === 'number' &&
          Number.isInteger(value) &&
          value >= 100 &&
          value <= 900
          ? { weight: value }
          : false;
      },
    },
    { tag: 'strong', getAttrs: () => ({ weight: 700 }) },
    { tag: 'b', getAttrs: () => ({ weight: 700 }) },
    {
      style: 'font-weight',
      getAttrs(value) {
        const parsed =
          value === 'bold' ? 700 : Number.parseInt(String(value), 10);

        return Number.isInteger(parsed) ? { weight: parsed } : false;
      },
    },
  ],
  toDOM(mark) {
    const value: unknown = mark.attrs.weight;

    return styledSpan(
      'data-sdm-weight',
      value,
      typeof value === 'number' ? `font-weight: ${value}` : undefined,
    );
  },
};

const italic: MarkSpec = {
  attrs: { enabled: { default: true } },
  parseDOM: [
    {
      tag: '[data-sdm-italic]',
      getAttrs(node) {
        const value = parsedAttribute(node, 'data-sdm-italic');

        return typeof value === 'boolean' ? { enabled: value } : false;
      },
    },
    { tag: 'em', getAttrs: () => ({ enabled: true }) },
    { tag: 'i', getAttrs: () => ({ enabled: true }) },
    { style: 'font-style=italic', getAttrs: () => ({ enabled: true }) },
  ],
  toDOM(mark) {
    return mark.attrs.enabled === false
      ? styledSpan('data-sdm-italic', false, 'font-style: normal')
      : ['em', valueAttribute('data-sdm-italic', true), 0];
  },
};

const underline: MarkSpec = {
  attrs: { enabled: { default: true } },
  parseDOM: [
    {
      tag: '[data-sdm-underline]',
      getAttrs(node) {
        const value = parsedAttribute(node, 'data-sdm-underline');

        return typeof value === 'boolean' ? { enabled: value } : false;
      },
    },
    { tag: 'u', getAttrs: () => ({ enabled: true }) },
    {
      style: 'text-decoration=underline',
      getAttrs: () => ({ enabled: true }),
    },
  ],
  toDOM(mark) {
    return mark.attrs.enabled === false
      ? styledSpan('data-sdm-underline', false, 'text-decoration-line: none')
      : ['u', valueAttribute('data-sdm-underline', true), 0];
  },
};

const strike: MarkSpec = {
  attrs: { enabled: { default: true } },
  parseDOM: [
    {
      tag: '[data-sdm-strike]',
      getAttrs(node) {
        const value = parsedAttribute(node, 'data-sdm-strike');

        return typeof value === 'boolean' ? { enabled: value } : false;
      },
    },
    { tag: 's', getAttrs: () => ({ enabled: true }) },
    { tag: 'strike', getAttrs: () => ({ enabled: true }) },
    { tag: 'del', getAttrs: () => ({ enabled: true }) },
    {
      style: 'text-decoration=line-through',
      getAttrs: () => ({ enabled: true }),
    },
  ],
  toDOM(mark) {
    return mark.attrs.enabled === false
      ? styledSpan('data-sdm-strike', false, 'text-decoration-line: none')
      : ['s', valueAttribute('data-sdm-strike', true), 0];
  },
};

const color: MarkSpec = {
  attrs: { color: {} },
  parseDOM: [
    {
      tag: 'span[data-sdm-color]',
      getAttrs(node) {
        const value = parsedAttribute(node, 'data-sdm-color');

        return Value.Check(ColorSchema, value) ? { color: value } : false;
      },
    },
  ],
  toDOM(mark) {
    const candidate: unknown = mark.attrs.color;
    const value = Value.Check(ColorSchema, candidate) ? candidate : null;

    return styledSpan('data-sdm-color', value, colorStyle('color', value));
  },
};

const highlight: MarkSpec = {
  attrs: { color: {} },
  parseDOM: [
    {
      tag: 'span[data-sdm-highlight]',
      getAttrs(node) {
        const value = parsedAttribute(node, 'data-sdm-highlight');

        return Value.Check(ColorSchema, value) ? { color: value } : false;
      },
    },
  ],
  toDOM(mark) {
    const candidate: unknown = mark.attrs.color;
    const value = Value.Check(ColorSchema, candidate) ? candidate : null;

    return styledSpan(
      'data-sdm-highlight',
      value,
      colorStyle('background-color', value),
    );
  },
};

const letterSpacingPt: MarkSpec = {
  attrs: { letterSpacingPt: {} },
  parseDOM: [
    {
      tag: 'span[data-sdm-letter-spacing-pt]',
      getAttrs(node) {
        const value = parsedAttribute(node, 'data-sdm-letter-spacing-pt');

        return typeof value === 'number' && Number.isFinite(value)
          ? { letterSpacingPt: value }
          : false;
      },
    },
  ],
  toDOM(mark) {
    const value: unknown = mark.attrs.letterSpacingPt;

    return styledSpan(
      'data-sdm-letter-spacing-pt',
      value,
      typeof value === 'number'
        ? `letter-spacing: ${value * SDM_POINT_TO_UNIT}px`
        : undefined,
    );
  },
};

const action: MarkSpec = {
  attrs: { action: {} },
  inclusive: false,
  parseDOM: [
    {
      tag: 'span[data-sdm-action]',
      getAttrs(node) {
        const value = parsedAttribute(node, 'data-sdm-action');

        return Value.Check(ActionSchema, value) ? { action: value } : false;
      },
    },
    {
      tag: 'a[href]',
      getAttrs(node) {
        if (typeof node === 'string' || !('getAttribute' in node)) {
          return false;
        }
        const href = node.getAttribute('href');

        return href === null
          ? false
          : { action: { kind: 'openUrl', url: href } };
      },
    },
  ],
  toDOM(mark) {
    return styledSpan('data-sdm-action', mark.attrs.action);
  },
};

export const sdmTextSchema = new Schema({
  nodes: {
    doc,
    paragraph,
    text: { group: 'inline' },
    hard_break: hardBreak,
  },
  marks: {
    font,
    sizePt,
    weight,
    italic,
    underline,
    strike,
    color,
    highlight,
    letterSpacingPt,
    action,
  },
});
