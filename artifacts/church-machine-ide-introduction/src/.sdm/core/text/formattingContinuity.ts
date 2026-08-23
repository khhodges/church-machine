import type { Mark, Node as ProseMirrorNode } from 'prosemirror-model';
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from 'prosemirror-state';
import { Mapping } from 'prosemirror-transform';

import type { RunStyle } from '../schema';
import { effectiveParagraph } from './listStyles';
import {
  canonicalizeRunStyle,
  defaultRunStyleAttr,
  marksFromRunStyle,
  paragraphFromPmAttrs,
  runStyleFromMarks,
} from './pmDoc';
import { sdmTextSchema } from './pmSchema';

const formattingContinuityKey = new PluginKey('sdmFormattingContinuity');

interface ParagraphEntry {
  node: ProseMirrorNode;
  position: number;
}

function paragraphEntries(doc: ProseMirrorNode): Array<ParagraphEntry> {
  const entries: Array<ParagraphEntry> = [];
  doc.forEach((node, position) => {
    if (node.type === sdmTextSchema.nodes.paragraph) {
      entries.push({ node, position });
    }
  });

  return entries;
}

function defaultStyleOf(node: ProseMirrorNode): RunStyle {
  const paragraph = paragraphFromPmAttrs(node.attrs);

  return effectiveParagraph(paragraph).defaultRunStyle;
}

const LIST_IDENTITY_ATTRS = [
  'align',
  'bullet',
  'defaultRunStyle',
  'hangingIndentPt',
  'indentPt',
  'level',
  'lineHeight',
  'markerStyle',
  'spaceAfterPt',
  'spaceBeforePt',
] as const;

function listIdentityAttrs(node: ProseMirrorNode): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  for (const key of LIST_IDENTITY_ATTRS) {
    attrs[key] = node.attrs[key];
  }

  return attrs;
}

function styleAtEnd(node: ProseMirrorNode): RunStyle {
  if (node.childCount === 0) {
    return defaultStyleOf(node);
  }
  const child = node.child(node.childCount - 1);

  return canonicalizeRunStyle({
    ...defaultStyleOf(node),
    ...runStyleFromMarks(child.marks),
  });
}

function styleFromOldSelection(
  oldState: EditorState,
  paragraphPosition: number,
): RunStyle | undefined {
  if (
    oldState.selection.$from.parent.type !== sdmTextSchema.nodes.paragraph ||
    oldState.selection.$from.before() !== paragraphPosition
  ) {
    return undefined;
  }
  const marks = oldState.storedMarks ?? oldState.selection.$from.marks();
  const style = runStyleFromMarks(marks);

  return Object.keys(style).length === 0 ? undefined : style;
}

function styleFromSelectionHead(state: EditorState): RunStyle {
  const parent = state.selection.$head.parent;
  if (parent.type !== sdmTextSchema.nodes.paragraph) {
    // Select All uses AllSelection, whose head resolves at the doc boundary;
    // read the departing style from the end of the last paragraph instead.
    const entries = paragraphEntries(state.doc);
    const last = entries[entries.length - 1];

    return last === undefined ? {} : styleAtEnd(last.node);
  }
  const marks = state.storedMarks ?? state.selection.$head.marks();

  return canonicalizeRunStyle({
    ...defaultStyleOf(parent),
    ...runStyleFromMarks(marks),
  });
}

function mappedParagraphs(
  transactions: ReadonlyArray<Transaction>,
  oldState: EditorState,
  newState: EditorState,
): Array<{ current: ParagraphEntry; previous: ParagraphEntry }> {
  const mapping = new Mapping();
  for (const transaction of transactions) {
    mapping.appendMapping(transaction.mapping);
  }
  const currentByPosition = new Map(
    paragraphEntries(newState.doc).map((entry) => [entry.position, entry]),
  );
  const pairs: Array<{
    current: ParagraphEntry;
    previous: ParagraphEntry;
  }> = [];
  for (const previous of paragraphEntries(oldState.doc)) {
    const start = mapping.mapResult(previous.position, 1);
    const end = mapping.mapResult(
      previous.position + previous.node.nodeSize,
      -1,
    );
    if (start.deletedAcross || end.deletedAcross || end.pos <= start.pos) {
      continue;
    }
    const current = currentByPosition.get(start.pos);
    if (
      current !== undefined &&
      current.position + current.node.nodeSize === end.pos
    ) {
      pairs.push({ current, previous });
    }
  }

  return pairs;
}

function seedTransaction(state: EditorState): Transaction | undefined {
  const parent = state.selection.$from.parent;
  if (
    parent.type !== sdmTextSchema.nodes.paragraph ||
    parent.content.size !== 0 ||
    state.storedMarks !== null
  ) {
    return undefined;
  }
  const style = defaultStyleOf(parent);
  if (Object.keys(style).length === 0) {
    return undefined;
  }
  const marks = marksFromRunStyle(style);
  if (marks.length === 0) {
    return undefined;
  }

  return state.tr.setStoredMarks(marks);
}

export function initializeFormattingContinuity(
  state: EditorState,
): EditorState {
  const transaction = seedTransaction(state);

  return transaction === undefined ? state : state.apply(transaction);
}

export const formattingContinuityPlugin = new Plugin({
  key: formattingContinuityKey,
  props: {
    handleTextInput(view, from, to, text) {
      const parent = view.state.selection.$from.parent;
      if (
        parent.type !== sdmTextSchema.nodes.paragraph ||
        parent.content.size !== 0
      ) {
        return false;
      }
      const style = defaultStyleOf(parent);
      const marks = view.state.storedMarks ?? marksFromRunStyle(style);
      if (marks.length === 0) {
        return false;
      }
      view.dispatch(
        view.state.tr
          .replaceWith(from, to, sdmTextSchema.text(text, marks))
          .setStoredMarks(marks),
      );

      return true;
    },
  },
  appendTransaction(transactions, oldState, newState) {
    let transaction: Transaction | undefined;
    let capturedSelectionStyle: RunStyle | undefined;
    if (transactions.some((candidate) => candidate.docChanged)) {
      const clearedWholeSelection =
        oldState.selection.from <= 1 &&
        oldState.selection.to >= oldState.doc.content.size - 1 &&
        oldState.doc.textContent !== '' &&
        newState.doc.textContent === '';
      const selectionParagraphPosition =
        newState.selection.$from.parent.type === sdmTextSchema.nodes.paragraph
          ? newState.selection.$from.before()
          : undefined;
      for (const { current, previous } of clearedWholeSelection
        ? []
        : mappedParagraphs(transactions, oldState, newState)) {
        if (current.node.content.size !== 0) {
          continue;
        }
        if (previous.node.content.size === 0) {
          continue;
        }
        const style = canonicalizeRunStyle({
          ...defaultStyleOf(current.node),
          ...(styleFromOldSelection(oldState, previous.position) ??
            styleAtEnd(previous.node)),
        });
        if (Object.keys(style).length === 0) {
          continue;
        }
        transaction ??= newState.tr;
        transaction.setNodeMarkup(current.position, undefined, {
          ...current.node.attrs,
          defaultRunStyle: defaultRunStyleAttr(style),
        });
        if (selectionParagraphPosition === current.position) {
          capturedSelectionStyle = style;
        }
      }
      const currentParagraph = newState.selection.$from.parent;
      if (
        clearedWholeSelection &&
        currentParagraph.type === sdmTextSchema.nodes.paragraph &&
        currentParagraph.content.size === 0
      ) {
        // Clearing everything must not erase what the text box was: the
        // replacement paragraph takes over the first paragraph's bullet,
        // level, marker style, spacing, and geometry, and the caret
        // continues in the departing head style or that paragraph's default.
        const source = paragraphEntries(oldState.doc)[0];
        const style = styleFromSelectionHead(oldState);
        const nextAttrs = {
          ...currentParagraph.attrs,
          ...(source === undefined ? {} : listIdentityAttrs(source.node)),
          ...(Object.keys(style).length === 0
            ? {}
            : { defaultRunStyle: defaultRunStyleAttr(style) }),
        };
        if (
          JSON.stringify(nextAttrs) !== JSON.stringify(currentParagraph.attrs)
        ) {
          transaction ??= newState.tr;
          transaction.setNodeMarkup(
            newState.selection.$from.before(),
            undefined,
            nextAttrs,
          );
        }
        let continuationStyle = style;
        if (
          Object.keys(continuationStyle).length === 0 &&
          source !== undefined
        ) {
          continuationStyle = defaultStyleOf(source.node);
        }
        if (Object.keys(continuationStyle).length > 0) {
          capturedSelectionStyle = continuationStyle;
        }
      }
    }

    const seed = seedTransaction(newState);
    // The captured style wins: seedTransaction reads the pre-append document,
    // so its marks can reflect a stale default this transaction replaces.
    const seedMarks: ReadonlyArray<Mark> | undefined =
      capturedSelectionStyle === undefined
        ? (seed?.storedMarks ?? undefined)
        : marksFromRunStyle(capturedSelectionStyle);
    if (seedMarks === undefined || seedMarks.length === 0) {
      return transaction ?? null;
    }
    if (transaction === undefined) {
      return seed ?? newState.tr.setStoredMarks(seedMarks);
    }
    transaction.setStoredMarks(seedMarks);

    return transaction;
  },
});
