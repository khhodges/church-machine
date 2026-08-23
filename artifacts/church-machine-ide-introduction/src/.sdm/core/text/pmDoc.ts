import { Value } from '@sinclair/typebox/value';
import type { Mark, Node as ProseMirrorNode } from 'prosemirror-model';

import {
  ActionSchema,
  BulletSchema,
  ColorSchema,
  FontSchema,
  InsetsSchema,
  RunStyleSchema,
  type Action,
  type Paragraph,
  type RunStyle,
  type TextBody,
  type TextRun,
} from '../schema';
import { effectiveParagraph } from './listStyles';
import { sdmTextSchema } from './pmSchema';
import { deepEqual, RUN_STYLE_KEYS, runStyleOverrides } from './styleUtils';

function hasRunStyle(style: RunStyle | undefined): style is RunStyle {
  return style !== undefined && Object.keys(style).length > 0;
}

export function canonicalizeRunStyle(style: RunStyle): RunStyle {
  const next: RunStyle = {
    ...(style.font === undefined ? {} : { font: style.font }),
    ...(style.sizePt === undefined ? {} : { sizePt: style.sizePt }),
    ...(style.weight === undefined ? {} : { weight: style.weight }),
    ...(style.italic === undefined ? {} : { italic: style.italic }),
    ...(style.underline === undefined ? {} : { underline: style.underline }),
    ...(style.strike === undefined ? {} : { strike: style.strike }),
    ...(style.color === undefined ? {} : { color: style.color }),
    ...(style.highlight === undefined ? {} : { highlight: style.highlight }),
    ...(style.letterSpacingPt === undefined
      ? {}
      : { letterSpacingPt: style.letterSpacingPt }),
  };

  return deepEqual(style, next) ? style : next;
}

export function runStyleFromRun(run: TextRun): RunStyle {
  return canonicalizeRunStyle({
    ...(run.font === undefined ? {} : { font: run.font }),
    ...(run.sizePt === undefined ? {} : { sizePt: run.sizePt }),
    ...(run.weight === undefined ? {} : { weight: run.weight }),
    ...(run.italic === undefined ? {} : { italic: run.italic }),
    ...(run.underline === undefined ? {} : { underline: run.underline }),
    ...(run.strike === undefined ? {} : { strike: run.strike }),
    ...(run.color === undefined ? {} : { color: run.color }),
    ...(run.highlight === undefined ? {} : { highlight: run.highlight }),
    ...(run.letterSpacingPt === undefined
      ? {}
      : { letterSpacingPt: run.letterSpacingPt }),
  });
}

function canonicalizeRun(run: TextRun): TextRun {
  const style = runStyleFromRun(run);
  const next: TextRun = {
    text: run.text,
    ...style,
    ...(run.action === undefined ? {} : { action: run.action }),
  };

  return deepEqual(run, next) ? run : next;
}

function canonicalizeRunAgainstDefault(
  run: TextRun,
  defaultRunStyle: RunStyle | undefined,
): TextRun {
  const next: TextRun = {
    text: run.text,
    ...runStyleOverrides(runStyleFromRun(run), defaultRunStyle),
    ...(run.action === undefined ? {} : { action: run.action }),
  };

  return deepEqual(run, next) ? run : next;
}

function sameRunMetadata(left: TextRun, right: TextRun): boolean {
  if (!deepEqual(left.action, right.action)) {
    return false;
  }

  return RUN_STYLE_KEYS.every((key) => deepEqual(left[key], right[key]));
}

function canonicalizeParagraph(paragraph: Paragraph): Paragraph {
  let defaultRunStyle =
    paragraph.defaultRunStyle === undefined
      ? undefined
      : canonicalizeRunStyle(paragraph.defaultRunStyle);
  const nonemptyRuns: Array<TextRun> = [];
  const emptyRunStyles: Array<RunStyle> = [];

  for (const source of paragraph.runs) {
    const canonical = canonicalizeRun(source);
    if (canonical.text === '') {
      emptyRunStyles.push(runStyleFromRun(canonical));
      continue;
    }
    const run = canonicalizeRunAgainstDefault(canonical, defaultRunStyle);
    const previous = nonemptyRuns[nonemptyRuns.length - 1];
    if (previous !== undefined && sameRunMetadata(previous, run)) {
      nonemptyRuns[nonemptyRuns.length - 1] = {
        ...previous,
        text: `${previous.text}${run.text}`,
      };
    } else {
      nonemptyRuns.push(run);
    }
  }

  if (nonemptyRuns.length === 0 && emptyRunStyles.length > 0) {
    const hoisted = emptyRunStyles.reduce<RunStyle>(
      (style, runStyle) => ({ ...style, ...runStyle }),
      defaultRunStyle ?? {},
    );
    defaultRunStyle = canonicalizeRunStyle(hoisted);
  }
  if (!hasRunStyle(defaultRunStyle)) {
    defaultRunStyle = undefined;
  }
  const markerStyle =
    paragraph.markerStyle === undefined
      ? undefined
      : canonicalizeRunStyle(paragraph.markerStyle);

  const next: Paragraph = {
    runs: nonemptyRuns,
    ...(defaultRunStyle === undefined ? {} : { defaultRunStyle }),
    ...(!hasRunStyle(markerStyle) ? {} : { markerStyle }),
    ...(paragraph.align === undefined ? {} : { align: paragraph.align }),
    ...(paragraph.level === undefined ? {} : { level: paragraph.level }),
    ...(paragraph.bullet === undefined ? {} : { bullet: paragraph.bullet }),
    ...(paragraph.lineHeight === undefined
      ? {}
      : { lineHeight: paragraph.lineHeight }),
    ...(paragraph.spaceBeforePt === undefined
      ? {}
      : { spaceBeforePt: paragraph.spaceBeforePt }),
    ...(paragraph.spaceAfterPt === undefined
      ? {}
      : { spaceAfterPt: paragraph.spaceAfterPt }),
    ...(paragraph.indentPt === undefined
      ? {}
      : { indentPt: paragraph.indentPt }),
    ...(paragraph.hangingIndentPt === undefined
      ? {}
      : { hangingIndentPt: paragraph.hangingIndentPt }),
  };

  return deepEqual(paragraph, next) ? paragraph : next;
}

export function canonicalizeTextBody(body: TextBody): TextBody {
  let changed = false;
  const paragraphs = body.paragraphs.map((paragraph) => {
    const next = canonicalizeParagraph(paragraph);
    changed ||= next !== paragraph;

    return next;
  });
  const next: TextBody = {
    paragraphs: changed ? paragraphs : body.paragraphs,
    ...(body.verticalAlign === undefined
      ? {}
      : { verticalAlign: body.verticalAlign }),
    ...(body.overflow === undefined ? {} : { overflow: body.overflow }),
    ...(body.insetsPt === undefined ? {} : { insetsPt: body.insetsPt }),
  };

  return deepEqual(body, next) ? body : next;
}

export function marksFromRunStyle(
  style: RunStyle,
  action?: Action,
): Array<Mark> {
  const marks: Array<Mark> = [];
  if (style.font !== undefined) {
    marks.push(sdmTextSchema.marks.font.create({ font: style.font }));
  }
  if (style.sizePt !== undefined) {
    marks.push(sdmTextSchema.marks.sizePt.create({ sizePt: style.sizePt }));
  }
  if (style.weight !== undefined) {
    marks.push(sdmTextSchema.marks.weight.create({ weight: style.weight }));
  }
  if (style.italic !== undefined) {
    marks.push(sdmTextSchema.marks.italic.create({ enabled: style.italic }));
  }
  if (style.underline !== undefined) {
    marks.push(
      sdmTextSchema.marks.underline.create({ enabled: style.underline }),
    );
  }
  if (style.strike !== undefined) {
    marks.push(sdmTextSchema.marks.strike.create({ enabled: style.strike }));
  }
  if (style.color !== undefined) {
    marks.push(sdmTextSchema.marks.color.create({ color: style.color }));
  }
  if (style.highlight !== undefined) {
    marks.push(
      sdmTextSchema.marks.highlight.create({ color: style.highlight }),
    );
  }
  if (style.letterSpacingPt !== undefined) {
    marks.push(
      sdmTextSchema.marks.letterSpacingPt.create({
        letterSpacingPt: style.letterSpacingPt,
      }),
    );
  }
  if (action !== undefined) {
    marks.push(sdmTextSchema.marks.action.create({ action }));
  }

  return marks;
}

function markAttribute(mark: Mark, name: string): unknown {
  return mark.attrs[name];
}

export function runStyleFromMarks(marks: ReadonlyArray<Mark>): RunStyle {
  const style: RunStyle = {};
  for (const mark of marks) {
    if (mark.type === sdmTextSchema.marks.font) {
      const value = markAttribute(mark, 'font');
      if (Value.Check(FontSchema, value)) {
        style.font = value;
      }
    } else if (mark.type === sdmTextSchema.marks.sizePt) {
      const value = markAttribute(mark, 'sizePt');
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        style.sizePt = value;
      }
    } else if (mark.type === sdmTextSchema.marks.weight) {
      const value = markAttribute(mark, 'weight');
      if (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 100 &&
        value <= 900
      ) {
        style.weight = value;
      }
    } else if (mark.type === sdmTextSchema.marks.italic) {
      style.italic = markAttribute(mark, 'enabled') !== false;
    } else if (mark.type === sdmTextSchema.marks.underline) {
      style.underline = markAttribute(mark, 'enabled') !== false;
    } else if (mark.type === sdmTextSchema.marks.strike) {
      style.strike = markAttribute(mark, 'enabled') !== false;
    } else if (mark.type === sdmTextSchema.marks.color) {
      const value = markAttribute(mark, 'color');
      if (Value.Check(ColorSchema, value)) {
        style.color = value;
      }
    } else if (mark.type === sdmTextSchema.marks.highlight) {
      const value = markAttribute(mark, 'color');
      if (Value.Check(ColorSchema, value)) {
        style.highlight = value;
      }
    } else if (mark.type === sdmTextSchema.marks.letterSpacingPt) {
      const value = markAttribute(mark, 'letterSpacingPt');
      if (typeof value === 'number' && Number.isFinite(value)) {
        style.letterSpacingPt = value;
      }
    }
  }

  return canonicalizeRunStyle(style);
}

function actionFromMarks(marks: ReadonlyArray<Mark>): Action | undefined {
  const actionMark = marks.find(
    (mark) => mark.type === sdmTextSchema.marks.action,
  );
  const value =
    actionMark === undefined ? undefined : markAttribute(actionMark, 'action');

  return Value.Check(ActionSchema, value) ? value : undefined;
}

function inlineNodes(
  run: TextRun,
  defaultRunStyle: RunStyle | undefined,
): Array<ProseMirrorNode> {
  const marks = marksFromRunStyle(
    { ...defaultRunStyle, ...runStyleFromRun(run) },
    run.action,
  );
  const nodes: Array<ProseMirrorNode> = [];
  const lines = run.text.split('\n');
  for (const [index, line] of lines.entries()) {
    if (line !== '') {
      nodes.push(sdmTextSchema.text(line, marks));
    }
    if (index < lines.length - 1) {
      nodes.push(sdmTextSchema.nodes.hard_break.create(null, null, marks));
    }
  }

  return nodes;
}

function paragraphNode(paragraph: Paragraph): ProseMirrorNode {
  const effective = effectiveParagraph(paragraph);

  return sdmTextSchema.nodes.paragraph.create(
    {
      align: paragraph.align ?? null,
      bullet: paragraph.bullet ?? null,
      defaultRunStyle: paragraph.defaultRunStyle ?? null,
      hangingIndentPt: paragraph.hangingIndentPt ?? null,
      indentPt: paragraph.indentPt ?? null,
      level: paragraph.level ?? null,
      lineHeight: paragraph.lineHeight ?? null,
      markerStyle: paragraph.markerStyle ?? null,
      spaceAfterPt: paragraph.spaceAfterPt ?? null,
      spaceBeforePt: paragraph.spaceBeforePt ?? null,
      synthetic: false,
    },
    paragraph.runs.flatMap((run) =>
      inlineNodes(run, effective.defaultRunStyle),
    ),
  );
}

export function textBodyToDoc(body: TextBody): ProseMirrorNode {
  const canonical = canonicalizeTextBody(body);
  const paragraphs =
    canonical.paragraphs.length === 0
      ? [
          sdmTextSchema.nodes.paragraph.create({
            align: null,
            bullet: null,
            defaultRunStyle: null,
            hangingIndentPt: null,
            indentPt: null,
            level: null,
            lineHeight: null,
            markerStyle: null,
            spaceAfterPt: null,
            spaceBeforePt: null,
            synthetic: true,
          }),
        ]
      : canonical.paragraphs.map((paragraph) => paragraphNode(paragraph));

  return sdmTextSchema.nodes.doc.create(
    {
      insetsPt: canonical.insetsPt ?? null,
      overflow: canonical.overflow ?? null,
      verticalAlign: canonical.verticalAlign ?? null,
    },
    paragraphs,
  );
}

function optionalNumber(
  value: unknown,
  predicate: (candidate: number) => boolean,
): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && predicate(value)
    ? value
    : undefined;
}

export function paragraphFromPmAttrs(
  attrs: Record<string, unknown>,
): Paragraph {
  const defaultRunStyle = Value.Check(RunStyleSchema, attrs.defaultRunStyle)
    ? canonicalizeRunStyle(attrs.defaultRunStyle)
    : undefined;
  const markerStyle = Value.Check(RunStyleSchema, attrs.markerStyle)
    ? canonicalizeRunStyle(attrs.markerStyle)
    : undefined;
  const align =
    attrs.align === 'left' ||
    attrs.align === 'center' ||
    attrs.align === 'right' ||
    attrs.align === 'justify'
      ? attrs.align
      : undefined;
  const level = optionalNumber(
    attrs.level,
    (value) => Number.isInteger(value) && value >= 0 && value <= 8,
  );
  const bullet = Value.Check(BulletSchema, attrs.bullet)
    ? attrs.bullet
    : undefined;
  const lineHeight = optionalNumber(attrs.lineHeight, (value) => value > 0);
  const indentPt = optionalNumber(attrs.indentPt, (value) => value >= 0);
  const hangingIndentPt = optionalNumber(
    attrs.hangingIndentPt,
    (value) => value >= 0,
  );
  const spaceBeforePt = optionalNumber(
    attrs.spaceBeforePt,
    (value) => value >= 0,
  );
  const spaceAfterPt = optionalNumber(
    attrs.spaceAfterPt,
    (value) => value >= 0,
  );

  return {
    runs: [],
    ...(align === undefined ? {} : { align }),
    ...(level === undefined ? {} : { level }),
    ...(bullet === undefined ? {} : { bullet }),
    ...(!hasRunStyle(defaultRunStyle) ? {} : { defaultRunStyle }),
    ...(!hasRunStyle(markerStyle) ? {} : { markerStyle }),
    ...(lineHeight === undefined ? {} : { lineHeight }),
    ...(spaceBeforePt === undefined ? {} : { spaceBeforePt }),
    ...(spaceAfterPt === undefined ? {} : { spaceAfterPt }),
    ...(indentPt === undefined ? {} : { indentPt }),
    ...(hangingIndentPt === undefined ? {} : { hangingIndentPt }),
  };
}

export function defaultRunStyleAttr(style: RunStyle): RunStyle | null {
  const canonical = canonicalizeRunStyle(style);

  return Object.keys(canonical).length === 0 ? null : canonical;
}

function paragraphFromNode(node: ProseMirrorNode): Paragraph | undefined {
  const attrs: Record<string, unknown> = node.attrs;
  const overrides = paragraphFromPmAttrs(attrs);
  const effective = effectiveParagraph(overrides);
  const runs: Array<TextRun> = [];
  node.forEach((child) => {
    let text: string | undefined;
    if (child.isText && child.text !== undefined) {
      text = child.text;
    } else if (child.type === sdmTextSchema.nodes.hard_break) {
      text = '\n';
    }
    if (text === undefined || text === '') {
      return;
    }
    const action = actionFromMarks(child.marks);
    const run: TextRun = {
      text,
      ...runStyleOverrides(
        runStyleFromMarks(child.marks),
        effective.defaultRunStyle,
      ),
      ...(action === undefined ? {} : { action }),
    };
    const previous = runs[runs.length - 1];
    if (previous !== undefined && sameRunMetadata(previous, run)) {
      runs[runs.length - 1] = {
        ...previous,
        text: `${previous.text}${run.text}`,
      };
    } else {
      runs.push(run);
    }
  });

  if (attrs.synthetic === true && runs.length === 0) {
    return undefined;
  }

  return { ...overrides, runs };
}

export function docToTextBody(doc: ProseMirrorNode): TextBody {
  const attrs: Record<string, unknown> = doc.attrs;
  const paragraphs: Array<Paragraph> = [];
  doc.forEach((node) => {
    if (node.type !== sdmTextSchema.nodes.paragraph) {
      return;
    }
    const paragraph = paragraphFromNode(node);
    if (paragraph !== undefined) {
      paragraphs.push(paragraph);
    }
  });
  const verticalAlign =
    attrs.verticalAlign === 'top' ||
    attrs.verticalAlign === 'middle' ||
    attrs.verticalAlign === 'bottom'
      ? attrs.verticalAlign
      : undefined;
  const overflow =
    attrs.overflow === 'clip' || attrs.overflow === 'visible'
      ? attrs.overflow
      : undefined;
  const insetsPt = Value.Check(InsetsSchema, attrs.insetsPt)
    ? attrs.insetsPt
    : undefined;

  return canonicalizeTextBody({
    paragraphs,
    ...(verticalAlign === undefined ? {} : { verticalAlign }),
    ...(overflow === undefined ? {} : { overflow }),
    ...(insetsPt === undefined ? {} : { insetsPt }),
  });
}

export function docToTextBodyWithReuse(
  doc: ProseMirrorNode,
  previous: TextBody,
): TextBody {
  const next = docToTextBody(doc);

  return deepEqual(next, previous) ? previous : next;
}
