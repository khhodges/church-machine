import { baseKeymap } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { Mark, Node as ProseMirrorNode } from 'prosemirror-model';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import 'prosemirror-view/style/prosemirror.css';
import { useCallback, useEffect, useRef, type RefObject } from 'react';

import { Value } from '@sinclair/typebox/value';
import type { SdmTextCommand } from './core/protocol';
import {
    BulletSchema,
    RunStyleSchema,
    type Paragraph,
    type TextBody,
    type Theme,
} from './core/schema';
import {
    backspaceParagraphFormatting,
    createParagraphMarkerPlugin,
    docToTextBodyWithReuse,
    effectiveParagraph,
    effectiveRunStyleCss,
    formattingContinuityPlugin,
    indentParagraphs,
    initializeFormattingContinuity,
    outdentParagraphs,
    paragraphLayoutCss,
    runStyleFromMarks,
    runStylePropertyCss,
    sdmTextSchema,
    selectionFormatting,
    setBulletProperties,
    setParagraphAlignment,
    setParagraphSpacing,
    setRunStyle,
    splitSdmParagraph,
    textBodyToDoc,
    toggleCharacterBullets,
    toggleNumberedBullets,
    type SdmSelectionFormatting,
} from './core/text';

export interface SdmTextCaretPoint {
  clientX: number;
  clientY: number;
}

export interface SdmTextEditorOptions {
  initialPoint: SdmTextCaretPoint | null;
  onCancel: () => void;
  onCommit: (body: TextBody) => void;
  onSelectionChange: (formatting: SdmSelectionFormatting) => void;
  registerCommitHandler: (handler: () => void) => () => void;
  registerPlacementHandler: (
    handler: (point: SdmTextCaretPoint) => void,
  ) => () => void;
  /**
   * Receives the handler that applies workspace-routed text commands to the
   * live view; returns an unregister callback invoked on unmount.
   */
  registerCommandHandler: (
    handler: (command: SdmTextCommand) => boolean,
  ) => () => void;
}

interface Props extends SdmTextEditorOptions {
  body: TextBody;
  mountRef: RefObject<HTMLDivElement | null>;
  theme: Theme | undefined;
}

function applyCss(
  element: HTMLElement,
  style: ReturnType<typeof effectiveRunStyleCss>,
): void {
  element.removeAttribute('style');
  for (const [property, value] of Object.entries(style)) {
    if (value !== undefined) {
      Reflect.set(element.style, property, String(value));
    }
  }
}

function paragraphFromNode(node: ProseMirrorNode): Paragraph {
  const attrs: Record<string, unknown> = node.attrs;
  const align =
    attrs.align === 'left' ||
    attrs.align === 'center' ||
    attrs.align === 'right' ||
    attrs.align === 'justify'
      ? attrs.align
      : undefined;
  const level =
    typeof attrs.level === 'number' &&
    Number.isInteger(attrs.level) &&
    attrs.level >= 0 &&
    attrs.level <= 8
      ? attrs.level
      : undefined;
  const bullet = Value.Check(BulletSchema, attrs.bullet)
    ? attrs.bullet
    : undefined;
  const defaultRunStyle = Value.Check(RunStyleSchema, attrs.defaultRunStyle)
    ? attrs.defaultRunStyle
    : undefined;
  const markerStyle = Value.Check(RunStyleSchema, attrs.markerStyle)
    ? attrs.markerStyle
    : undefined;
  const lineHeight =
    typeof attrs.lineHeight === 'number' && attrs.lineHeight > 0
      ? attrs.lineHeight
      : undefined;
  const indentPt =
    typeof attrs.indentPt === 'number' && attrs.indentPt >= 0
      ? attrs.indentPt
      : undefined;
  const hangingIndentPt =
    typeof attrs.hangingIndentPt === 'number' && attrs.hangingIndentPt >= 0
      ? attrs.hangingIndentPt
      : undefined;
  const spaceBeforePt =
    typeof attrs.spaceBeforePt === 'number' && attrs.spaceBeforePt >= 0
      ? attrs.spaceBeforePt
      : undefined;
  const spaceAfterPt =
    typeof attrs.spaceAfterPt === 'number' && attrs.spaceAfterPt >= 0
      ? attrs.spaceAfterPt
      : undefined;

  return {
    runs: [],
    ...(align === undefined ? {} : { align }),
    ...(level === undefined ? {} : { level }),
    ...(bullet === undefined ? {} : { bullet }),
    ...(defaultRunStyle === undefined ? {} : { defaultRunStyle }),
    ...(markerStyle === undefined ? {} : { markerStyle }),
    ...(lineHeight === undefined ? {} : { lineHeight }),
    ...(spaceBeforePt === undefined ? {} : { spaceBeforePt }),
    ...(spaceAfterPt === undefined ? {} : { spaceAfterPt }),
    ...(indentPt === undefined ? {} : { indentPt }),
    ...(hangingIndentPt === undefined ? {} : { hangingIndentPt }),
  };
}

function updateParagraphElement(
  element: HTMLElement,
  node: ProseMirrorNode,
  theme: Theme | undefined,
): void {
  const paragraph = paragraphFromNode(node);
  const effective = effectiveParagraph(paragraph);
  const defaultStyle =
    node.content.size === 0
      ? effectiveRunStyleCss(effective.defaultRunStyle, theme)
      : {};
  applyCss(element, {
    ...paragraphLayoutCss(effective),
    ...defaultStyle,
  });
  element.dataset.sdmTextParagraph = '';
  element.dataset.sdmLevel = String(paragraph.level ?? 0);
  if (paragraph.bullet !== undefined) {
    element.dataset.sdmHasMarker = 'true';
  } else {
    delete element.dataset.sdmHasMarker;
  }
  element.dataset.sdmParagraphAttrs = JSON.stringify(node.attrs);
}

function paragraphNodeView(
  node: ProseMirrorNode,
  theme: Theme | undefined,
) {
  const dom = document.createElement('div');
  updateParagraphElement(dom, node, theme);

  return {
    dom,
    contentDOM: dom,
    update(nextNode: ProseMirrorNode) {
      if (nextNode.type !== node.type) {
        return false;
      }
      updateParagraphElement(dom, nextNode, theme);

      return true;
    },
  };
}

function markData(mark: Mark): { name: string; value: unknown } | undefined {
  if (mark.type === sdmTextSchema.marks.font) {
    return { name: 'sdmFont', value: mark.attrs.font };
  }
  if (mark.type === sdmTextSchema.marks.sizePt) {
    return { name: 'sdmSizePt', value: mark.attrs.sizePt };
  }
  if (mark.type === sdmTextSchema.marks.weight) {
    return { name: 'sdmWeight', value: mark.attrs.weight };
  }
  if (mark.type === sdmTextSchema.marks.italic) {
    return { name: 'sdmItalic', value: mark.attrs.enabled };
  }
  if (mark.type === sdmTextSchema.marks.underline) {
    return { name: 'sdmUnderline', value: mark.attrs.enabled };
  }
  if (mark.type === sdmTextSchema.marks.strike) {
    return { name: 'sdmStrike', value: mark.attrs.enabled };
  }
  if (mark.type === sdmTextSchema.marks.color) {
    return { name: 'sdmColor', value: mark.attrs.color };
  }
  if (mark.type === sdmTextSchema.marks.highlight) {
    return { name: 'sdmHighlight', value: mark.attrs.color };
  }
  if (mark.type === sdmTextSchema.marks.letterSpacingPt) {
    return {
      name: 'sdmLetterSpacingPt',
      value: mark.attrs.letterSpacingPt,
    };
  }

  return undefined;
}

function styleMarkView(mark: Mark, theme: Theme | undefined) {
  const dom = document.createElement('span');
  const data = markData(mark);
  if (data !== undefined) {
    const serialized = JSON.stringify(data.value);
    if (serialized !== undefined) {
      dom.dataset[data.name] = serialized;
    }
  }
  applyCss(dom, runStylePropertyCss(runStyleFromMarks([mark]), theme));

  return { dom, contentDOM: dom };
}

const toggleWeight: Command = (state, dispatch, view) => {
  const style = runStyleFromMarks(
    state.storedMarks ?? state.selection.$from.marks(),
  );

  return setRunStyle({ weight: (style.weight ?? 400) >= 600 ? 400 : 700 })(
    state,
    dispatch,
    view,
  );
};

function toggleBooleanStyle(key: 'italic' | 'underline'): Command {
  return (state, dispatch, view) => {
    const style = runStyleFromMarks(
      state.storedMarks ?? state.selection.$from.marks(),
    );

    return setRunStyle({ [key]: !style[key] })(state, dispatch, view);
  };
}

function applyTextCommand(view: EditorView, command: SdmTextCommand): boolean {
  let pmCommand: Command;
  switch (command.kind) {
    case 'setRunStyle':
      pmCommand = setRunStyle(command.style);
      break;
    case 'setAlignment':
      pmCommand = setParagraphAlignment(command.align);
      break;
    case 'setParagraphSpacing':
      pmCommand = setParagraphSpacing({
        ...(command.lineHeight === undefined
          ? {}
          : { lineHeight: command.lineHeight }),
        ...(command.spaceAfterPt === undefined
          ? {}
          : { spaceAfterPt: command.spaceAfterPt }),
        ...(command.spaceBeforePt === undefined
          ? {}
          : { spaceBeforePt: command.spaceBeforePt }),
      });
      break;
    case 'toggleBullets':
      pmCommand =
        command.bulletKind === 'character'
          ? toggleCharacterBullets()
          : toggleNumberedBullets();
      break;
    case 'setBullet':
      pmCommand = setBulletProperties(command.bullet);
      break;
    case 'indent':
      pmCommand = indentParagraphs;
      break;
    case 'outdent':
      pmCommand = outdentParagraphs;
      break;
    case 'undo':
      pmCommand = undo;
      break;
    case 'redo':
      pmCommand = redo;
      break;
  }

  return pmCommand(view.state, view.dispatch, view);
}

function placeCaretAtPoint(
  view: EditorView,
  point: SdmTextCaretPoint,
): void {
  const rect = view.dom.getBoundingClientRect();
  const left =
    rect.width > 0
      ? Math.min(Math.max(point.clientX, rect.left), rect.right)
      : point.clientX;
  const top =
    rect.height > 0
      ? Math.min(Math.max(point.clientY, rect.top), rect.bottom)
      : point.clientY;
  const position = view.posAtCoords({ left, top });
  const selection =
    position === null
      ? point.clientY < rect.top
        ? TextSelection.atStart(view.state.doc)
        : TextSelection.atEnd(view.state.doc)
      : TextSelection.near(view.state.doc.resolve(position.pos));
  view.dispatch(view.state.tr.setSelection(selection));
  view.focus();
}

export function SdmTextEditor({
  body,
  initialPoint,
  mountRef,
  onCancel,
  onCommit,
  onSelectionChange,
  registerCommitHandler,
  registerCommandHandler,
  registerPlacementHandler,
  theme,
}: Props) {
  const viewRef = useRef<EditorView | null>(null);
  /** Last body the editor synced with or committed; commits diff against it. */
  const bodyRef = useRef(body);
  const initialPointRef = useRef(initialPoint);
  const cancelledRef = useRef(false);
  const callbacksRef = useRef({
    onCancel,
    onCommit,
    onSelectionChange,
    registerCommitHandler,
    registerCommandHandler,
    registerPlacementHandler,
  });
  callbacksRef.current = {
    onCancel,
    onCommit,
    onSelectionChange,
    registerCommitHandler,
    registerCommandHandler,
    registerPlacementHandler,
  };

  const reportSelection = useCallback(() => {
    const view = viewRef.current;
    if (view !== null) {
      callbacksRef.current.onSelectionChange(selectionFormatting(view.state));
    }
  }, []);

  const commitView = useCallback(() => {
    const view = viewRef.current;
    if (view === null) {
      return;
    }
    const next = docToTextBodyWithReuse(view.state.doc, bodyRef.current);
    if (next === bodyRef.current) {
      return;
    }
    bodyRef.current = next;
    callbacksRef.current.onCommit(next);
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (mount === null) {
      return;
    }
    cancelledRef.current = false;
    let state = initializeFormattingContinuity(
      EditorState.create({
        doc: textBodyToDoc(bodyRef.current),
        plugins: [
          formattingContinuityPlugin,
          createParagraphMarkerPlugin(theme),
          history(),
          keymap({
            'Mod-b': toggleWeight,
            'Mod-i': toggleBooleanStyle('italic'),
            'Mod-u': toggleBooleanStyle('underline'),
            'Mod-Shift-7': toggleNumberedBullets(),
            'Mod-Shift-8': toggleCharacterBullets(),
            Backspace: backspaceParagraphFormatting,
            Enter: splitSdmParagraph,
            Tab: indentParagraphs,
            'Shift-Tab': outdentParagraphs,
            'Mod-z': undo,
            'Mod-y': redo,
            'Mod-Shift-z': redo,
            Escape: () => {
              if (!cancelledRef.current) {
                commitView();
                cancelledRef.current = true;
                callbacksRef.current.onCancel();
              }

              return true;
            },
          }),
          keymap(baseKeymap),
        ],
      }),
    );
    state = state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc)));
    const view: EditorView = new EditorView(mount, {
      state,
      attributes: {
        'aria-multiline': 'true',
        'data-sdm-text-caret-active': 'true',
        role: 'textbox',
        spellcheck: 'true',
        style: 'cursor: text; min-height: 1em; outline: none; width: 100%;',
      },
      markViews: {
        color: (mark) => styleMarkView(mark, theme),
        font: (mark) => styleMarkView(mark, theme),
        highlight: (mark) => styleMarkView(mark, theme),
        italic: (mark) => styleMarkView(mark, theme),
        letterSpacingPt: (mark) => styleMarkView(mark, theme),
        sizePt: (mark) => styleMarkView(mark, theme),
        strike: (mark) => styleMarkView(mark, theme),
        underline: (mark) => styleMarkView(mark, theme),
        weight: (mark) => styleMarkView(mark, theme),
      },
      nodeViews: {
        paragraph: (node) => paragraphNodeView(node, theme),
      },
      handleDOMEvents: {
        // The caret session survives blur so workspace formatting controls
        // never tear the selection down: blur only persists progress, and
        // exits stay explicit (Escape, outside click, selection change).
        blur() {
          if (!cancelledRef.current) {
            commitView();
          }

          return false;
        },
      },
      dispatchTransaction(transaction) {
        view.updateState(view.state.apply(transaction));
        reportSelection();
      },
    });
    viewRef.current = view;
    view.focus();
    const point = initialPointRef.current;
    if (point !== null) {
      placeCaretAtPoint(view, point);
    }
    reportSelection();
    const unregister = callbacksRef.current.registerCommandHandler(
      (command) => {
        const applied = applyTextCommand(view, command);
        if (applied) {
          view.focus();
        }

        return command.kind === 'undo' || command.kind === 'redo'
          ? true
          : applied;
      },
    );
    const unregisterCommit =
      callbacksRef.current.registerCommitHandler(commitView);
    const unregisterPlacement =
      callbacksRef.current.registerPlacementHandler((nextPoint) =>
        placeCaretAtPoint(view, nextPoint),
      );

    return () => {
      unregisterPlacement();
      unregisterCommit();
      unregister();
      viewRef.current = null;
      view.destroy();
    };
  }, [commitView, mountRef, reportSelection, theme]);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null) {
      return;
    }
    if (body !== bodyRef.current) {
      bodyRef.current = body;
      const nextDoc = textBodyToDoc(body);
      // External body replacement while the caret is open (rare: the
      // session exits the caret on authoritative setDoc). The editor's own
      // committed bodies round-trip to an identical document and are skipped.
      if (!view.state.doc.eq(nextDoc)) {
        let state = initializeFormattingContinuity(
          EditorState.create({ doc: nextDoc, plugins: view.state.plugins }),
        );
        state = state.apply(
          state.tr.setSelection(TextSelection.atEnd(state.doc)),
        );
        view.updateState(state);
        reportSelection();
      }
    }
  }, [body, reportSelection]);

  return null;
}
