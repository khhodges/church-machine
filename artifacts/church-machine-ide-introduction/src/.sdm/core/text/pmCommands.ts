import { Value } from '@sinclair/typebox/value';
import { splitBlockKeepMarks } from 'prosemirror-commands';
import type {
  Mark,
  MarkType,
  Node as ProseMirrorNode,
} from 'prosemirror-model';
import type { Command, EditorState, Transaction } from 'prosemirror-state';

import {
  RunStyleSchema,
  type Bullet,
  type Paragraph,
  type RunStyle,
} from '../schema';
import { effectiveParagraph, SDM_DEFAULT_LIST_INDENT_PT } from './listStyles';
import {
  defaultRunStyleAttr,
  marksFromRunStyle,
  paragraphFromPmAttrs,
  runStyleFromMarks,
} from './pmDoc';
import { sdmTextSchema } from './pmSchema';
import { isRecord, RUN_STYLE_KEYS } from './styleUtils';

interface ParagraphTarget {
  index: number;
  node: ProseMirrorNode;
  position: number;
}

type ParagraphAttrsUpdate = (
  attrs: Record<string, unknown>,
  index: number,
  isHead: boolean,
) => Record<string, unknown>;

function headParagraphPosition(state: EditorState): number | undefined {
  const { $head } = state.selection;
  if ($head.parent.type === sdmTextSchema.nodes.paragraph) {
    return $head.before();
  }
  if ($head.nodeBefore?.type === sdmTextSchema.nodes.paragraph) {
    return $head.pos - $head.nodeBefore.nodeSize;
  }

  return undefined;
}

function paragraphTargets(state: EditorState): Array<ParagraphTarget> {
  if (state.selection.empty) {
    const index = state.selection.$from.index(0);
    const node = state.doc.child(index);
    if (node.type !== sdmTextSchema.nodes.paragraph) {
      return [];
    }
    let position = 0;
    for (let childIndex = 0; childIndex < index; childIndex += 1) {
      position += state.doc.child(childIndex).nodeSize;
    }

    return [{ index, node, position }];
  }

  const targets: Array<ParagraphTarget> = [];
  state.doc.forEach((node, position, index) => {
    const end = position + node.nodeSize;
    if (
      node.type === sdmTextSchema.nodes.paragraph &&
      state.selection.from < end &&
      state.selection.to > position
    ) {
      targets.push({ index, node, position });
    }
  });

  return targets;
}

function updateParagraphAttrs(update: ParagraphAttrsUpdate): Command {
  return (state, dispatch) => {
    const targets = paragraphTargets(state);
    if (targets.length === 0) {
      return false;
    }
    if (dispatch === undefined) {
      return true;
    }
    const transaction = state.tr;
    let changed = false;
    const headPosition = headParagraphPosition(state);
    targets.forEach((target, index) => {
      const attrs: Record<string, unknown> = target.node.attrs;
      const next = update(attrs, index, target.position === headPosition);
      if (JSON.stringify(next) === JSON.stringify(attrs)) {
        return;
      }
      transaction.setNodeMarkup(target.position, undefined, next);
      changed = true;
    });
    if (changed) {
      if (state.storedMarks !== null) {
        transaction.setStoredMarks(state.storedMarks);
      }
      dispatch(transaction);
    }

    return true;
  };
}

export function setParagraphAlignment(align: Paragraph['align']): Command {
  return updateParagraphAttrs((attrs) => ({ ...attrs, align: align ?? null }));
}

export function setParagraphSpacing(
  values: Partial<
    Pick<Paragraph, 'lineHeight' | 'spaceAfterPt' | 'spaceBeforePt'>
  >,
): Command {
  return updateParagraphAttrs((attrs) => {
    const next = { ...attrs };
    if (Object.hasOwn(values, 'lineHeight')) {
      next.lineHeight = values.lineHeight ?? null;
    }
    if (Object.hasOwn(values, 'spaceAfterPt')) {
      next.spaceAfterPt = values.spaceAfterPt ?? null;
    }
    if (Object.hasOwn(values, 'spaceBeforePt')) {
      next.spaceBeforePt = values.spaceBeforePt ?? null;
    }

    return next;
  });
}

function shiftedParagraphAttrs(
  attrs: Record<string, unknown>,
  delta: number,
): Record<string, unknown> {
  const paragraph = paragraphFromPmAttrs(attrs);
  const currentLevel = paragraph.level ?? 0;
  const level = Math.max(0, Math.min(8, currentLevel + delta));
  if (level === currentLevel) {
    return attrs;
  }

  return {
    ...attrs,
    indentPt:
      paragraph.indentPt === undefined
        ? null
        : Math.max(
            0,
            paragraph.indentPt +
              (level - currentLevel) * SDM_DEFAULT_LIST_INDENT_PT,
          ),
    level: level === 0 ? null : level,
  };
}

function shiftParagraphLevel(delta: number): Command {
  return (state, dispatch) => {
    const targets = paragraphTargets(state);
    if (targets.length === 0) {
      return false;
    }
    if (dispatch === undefined) {
      return true;
    }
    const transaction = state.tr;
    let changed = false;
    for (const target of targets) {
      const next = shiftedParagraphAttrs(target.node.attrs, delta);
      if (next === target.node.attrs) {
        continue;
      }
      transaction.setNodeMarkup(target.position, undefined, next);
      changed = true;
    }
    if (changed) {
      if (state.storedMarks !== null) {
        transaction.setStoredMarks(state.storedMarks);
      }
      dispatch(transaction);
    }

    return true;
  };
}

export const indentParagraphs = shiftParagraphLevel(1);
export const outdentParagraphs = shiftParagraphLevel(-1);

/**
 * Google Slides Backspace ladder for the start of a paragraph: the first
 * press clears the bullet, later presses walk the indent back, and only a
 * bare paragraph falls through to the default join behavior.
 */
export const backspaceParagraphFormatting: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if (!state.selection.empty || $from.parentOffset !== 0) {
    return false;
  }
  const parent = $from.parent;
  if (parent.type !== sdmTextSchema.nodes.paragraph) {
    return false;
  }
  const attrs: Record<string, unknown> = parent.attrs;
  const paragraph = paragraphFromPmAttrs(attrs);
  const effective = effectiveParagraph(paragraph);
  const hasBullet =
    effective.bullet?.kind === 'character' ||
    effective.bullet?.kind === 'number';
  const level = effective.level;
  const hasResidualIndent = paragraph.indentPt !== undefined;
  if (!hasBullet && level === 0 && !hasResidualIndent) {
    return false;
  }
  if (dispatch !== undefined) {
    let next: Record<string, unknown>;
    if (hasBullet) {
      next = {
        ...attrs,
        bullet: null,
        hangingIndentPt: null,
        indentPt:
          paragraph.indentPt === undefined
            ? null
            : Math.max(0, effective.indentPt - effective.hangingIndentPt),
        markerStyle: null,
      };
    } else if (level > 0) {
      next = shiftedParagraphAttrs(attrs, -1);
    } else {
      next = { ...attrs, indentPt: null };
    }
    dispatch(state.tr.setNodeMarkup($from.before(), undefined, next));
  }

  return true;
};

export type SdmBulletUpdate =
  | { kind: 'character'; character: string }
  | { kind: 'number'; style?: string; startAt?: number | null };

/**
 * Replaces the bullet of every selected paragraph. Number updates preserve
 * each paragraph's existing restart unless the update carries `startAt`
 * (`null` clears it); an explicit restart lands only on the paragraph at the
 * selection head — the one whose value formatting controls display.
 */
export function setBulletProperties(update: SdmBulletUpdate): Command {
  return updateParagraphAttrs((attrs, _index, isHead) => {
    if (update.kind === 'character') {
      return {
        ...attrs,
        bullet: { kind: 'character', character: update.character },
      };
    }
    const current =
      isRecord(attrs.bullet) && attrs.bullet.kind === 'number'
        ? attrs.bullet
        : undefined;
    const style =
      update.style ??
      (typeof current?.style === 'string' ? current.style : undefined);
    const currentStartAt =
      typeof current?.startAt === 'number' ? current.startAt : undefined;
    const startAt =
      isHead && update.startAt !== undefined
        ? (update.startAt ?? undefined)
        : currentStartAt;

    return {
      ...attrs,
      bullet: {
        kind: 'number',
        ...(style === undefined ? {} : { style }),
        ...(startAt === undefined ? {} : { startAt }),
      },
    };
  });
}

function toggleBullets(
  kind: 'character' | 'number',
  create: (index: number) => Bullet,
): Command {
  return (state, dispatch) => {
    const targets = paragraphTargets(state);
    if (targets.length === 0) {
      return false;
    }
    const allActive = targets.every(({ node }) => {
      const effective = effectiveParagraph(paragraphFromPmAttrs(node.attrs));

      return effective.bullet?.kind === kind;
    });
    if (dispatch === undefined) {
      return true;
    }
    const transaction = state.tr;
    targets.forEach((target, index) => {
      const paragraph = paragraphFromPmAttrs(target.node.attrs);
      const effective = effectiveParagraph(paragraph);
      transaction.setNodeMarkup(target.position, undefined, {
        ...target.node.attrs,
        bullet: allActive ? null : create(index),
        // Toggling off removes only the marker and its gutter, exactly like
        // the first Backspace press; level and remaining indent survive.
        ...(allActive
          ? {
              hangingIndentPt: null,
              indentPt:
                paragraph.indentPt === undefined
                  ? null
                  : Math.max(0, effective.indentPt - effective.hangingIndentPt),
              markerStyle: null,
            }
          : {}),
      });
    });
    dispatch(transaction);

    return true;
  };
}

export function toggleCharacterBullets(character = '•'): Command {
  return toggleBullets('character', () => ({ kind: 'character', character }));
}

export function toggleNumberedBullets({
  startAt,
  style,
}: {
  startAt?: number;
  style?: string;
} = {}): Command {
  return toggleBullets('number', (index) => ({
    kind: 'number',
    ...(style === undefined ? {} : { style }),
    ...(index === 0 && startAt !== undefined ? { startAt } : {}),
  }));
}

function markTypeForStyle(key: keyof RunStyle): MarkType {
  switch (key) {
    case 'font':
      return sdmTextSchema.marks.font;
    case 'sizePt':
      return sdmTextSchema.marks.sizePt;
    case 'weight':
      return sdmTextSchema.marks.weight;
    case 'italic':
      return sdmTextSchema.marks.italic;
    case 'underline':
      return sdmTextSchema.marks.underline;
    case 'strike':
      return sdmTextSchema.marks.strike;
    case 'color':
      return sdmTextSchema.marks.color;
    case 'highlight':
      return sdmTextSchema.marks.highlight;
    case 'letterSpacingPt':
      return sdmTextSchema.marks.letterSpacingPt;
  }
}

function markForStyle(
  key: keyof RunStyle,
  value: RunStyle[keyof RunStyle],
): Mark | undefined {
  if (value === undefined) {
    return undefined;
  }
  const type = markTypeForStyle(key);
  if (key === 'italic' || key === 'underline' || key === 'strike') {
    return type.create({ enabled: value });
  }
  if (key === 'highlight') {
    return type.create({ color: value });
  }

  return type.create({ [key]: value });
}

function updateStoredMark(
  marks: ReadonlyArray<Mark>,
  key: keyof RunStyle,
  value: RunStyle[keyof RunStyle],
): ReadonlyArray<Mark> {
  const type = markTypeForStyle(key);
  let next = type.removeFromSet([...marks]);
  const mark = markForStyle(key, value);
  if (mark !== undefined) {
    next = mark.addToSet(next);
  }

  return next;
}

export function setRunStyle(values: Partial<RunStyle>): Command {
  return (state, dispatch) => {
    if (dispatch === undefined) {
      return true;
    }
    const transaction = state.tr;
    const entries: Array<[keyof RunStyle, RunStyle[keyof RunStyle]]> = [];
    for (const key of RUN_STYLE_KEYS) {
      if (Object.hasOwn(values, key)) {
        entries.push([key, values[key]]);
      }
    }
    if (state.selection.empty) {
      const parent = state.selection.$from.parent;
      let marks = state.storedMarks ?? state.selection.$from.marks().slice();
      if (
        parent.type === sdmTextSchema.nodes.paragraph &&
        parent.content.size === 0 &&
        Value.Check(RunStyleSchema, parent.attrs.defaultRunStyle)
      ) {
        marks = marksFromRunStyle({
          ...parent.attrs.defaultRunStyle,
          ...runStyleFromMarks(marks),
        });
      }
      for (const [key, value] of entries) {
        marks = updateStoredMark(marks, key, value);
      }
      transaction.setStoredMarks(marks);
      if (
        parent.type === sdmTextSchema.nodes.paragraph &&
        parent.content.size === 0
      ) {
        const defaultRunStyle = defaultRunStyleAttr(runStyleFromMarks(marks));
        transaction.setNodeMarkup(state.selection.$from.before(), undefined, {
          ...parent.attrs,
          defaultRunStyle,
          // Serialization drops synthetic empty paragraphs, which would
          // discard the style just persisted for an empty text body.
          ...(defaultRunStyle === null ? {} : { synthetic: false }),
        });
      }
    } else {
      for (const [key, value] of entries) {
        const type = markTypeForStyle(key);
        transaction.removeMark(state.selection.from, state.selection.to, type);
        const mark = markForStyle(key, value);
        if (mark !== undefined) {
          transaction.addMark(state.selection.from, state.selection.to, mark);
        }
      }
      // Marks only reach inline content, so selected empty paragraphs carry
      // the change in their insertion default instead.
      for (const target of paragraphTargets(state)) {
        if (target.node.content.size !== 0) {
          continue;
        }
        const merged: RunStyle = Value.Check(
          RunStyleSchema,
          target.node.attrs.defaultRunStyle,
        )
          ? { ...target.node.attrs.defaultRunStyle }
          : {};
        for (const [key, value] of entries) {
          assignRunStyleValue(merged, key, value);
        }
        const defaultRunStyle = defaultRunStyleAttr(merged);
        transaction.setNodeMarkup(target.position, undefined, {
          ...target.node.attrs,
          defaultRunStyle,
          ...(defaultRunStyle === null ? {} : { synthetic: false }),
        });
      }
    }
    dispatch(transaction);

    return true;
  };
}

function assignRunStyleValue<K extends keyof RunStyle>(
  target: RunStyle,
  key: K,
  value: RunStyle[K],
): void {
  if (value === undefined) {
    delete target[key];
  } else {
    target[key] = value;
  }
}

function continuedBullet(value: unknown): unknown {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('kind' in value) ||
    value.kind !== 'number'
  ) {
    return value;
  }
  const style =
    'style' in value && typeof value.style === 'string'
      ? value.style
      : undefined;

  return { kind: 'number', ...(style === undefined ? {} : { style }) };
}

function withContinuedParagraphAttrs(
  transaction: Transaction,
  sourceAttrs: Record<string, unknown>,
  defaultRunStyle: RunStyle,
): Transaction {
  const target = transaction.selection.$from.parent;
  if (target.type !== sdmTextSchema.nodes.paragraph) {
    return transaction;
  }
  transaction.setNodeMarkup(transaction.selection.$from.before(), undefined, {
    ...target.attrs,
    ...sourceAttrs,
    bullet: continuedBullet(sourceAttrs.bullet),
    defaultRunStyle: defaultRunStyleAttr(defaultRunStyle),
    synthetic: false,
  });

  return transaction;
}

export const splitSdmParagraph: Command = (state, dispatch, view) => {
  const parent = state.selection.$from.parent;
  if (parent.type !== sdmTextSchema.nodes.paragraph) {
    return false;
  }
  const sourceAttrs: Record<string, unknown> = parent.attrs;
  const paragraph = paragraphFromPmAttrs(sourceAttrs);
  const effective = effectiveParagraph(paragraph);
  const bullet = effective.bullet;
  if (
    state.selection.empty &&
    parent.content.size === 0 &&
    (bullet?.kind === 'character' || bullet?.kind === 'number')
  ) {
    if (dispatch !== undefined) {
      const next =
        effective.level > 0
          ? shiftedParagraphAttrs(sourceAttrs, -1)
          : {
              ...sourceAttrs,
              bullet: null,
              hangingIndentPt: null,
              indentPt: null,
              level: null,
              markerStyle: null,
            };
      dispatch(
        state.tr.setNodeMarkup(state.selection.$from.before(), undefined, next),
      );
    }

    return true;
  }
  const marks = state.storedMarks ?? state.selection.$from.marks();
  const sourceDefault = Value.Check(RunStyleSchema, sourceAttrs.defaultRunStyle)
    ? sourceAttrs.defaultRunStyle
    : {};
  const defaultRunStyle = {
    ...sourceDefault,
    ...runStyleFromMarks(marks),
  };

  return splitBlockKeepMarks(
    state,
    dispatch === undefined
      ? undefined
      : (transaction) => {
          transaction.removeStoredMark(sdmTextSchema.marks.action);
          dispatch(
            withContinuedParagraphAttrs(
              transaction,
              sourceAttrs,
              defaultRunStyle,
            ),
          );
        },
    view,
  );
};
