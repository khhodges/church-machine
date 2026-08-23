import type { EditorState } from 'prosemirror-state';

import type { Bullet, Paragraph, RunStyle } from '../schema';
import { effectiveParagraph } from './listStyles';
import {
  canonicalizeRunStyle,
  paragraphFromPmAttrs,
  runStyleFromMarks,
} from './pmDoc';
import { sdmTextSchema } from './pmSchema';

export interface SdmSelectionFormatting {
  align: NonNullable<Paragraph['align']>;
  bullet: Bullet | null;
  level: number;
  lineHeight: number;
  runStyle: RunStyle;
  spaceAfterPt: number;
  spaceBeforePt: number;
}

/**
 * Effective formatting at the selection head: the paragraph's default run
 * style overlaid with the marks at the caret (stored marks win while typing),
 * plus the paragraph attributes formatting controls reflect.
 */
export function selectionFormatting(
  state: EditorState,
): SdmSelectionFormatting {
  const { $head } = state.selection;
  // AllSelection resolves its head at the doc boundary; fall back to the
  // adjacent paragraph — attributes and inline marks alike — so Select All
  // reports real formatting state.
  let parent = $head.parent;
  let marks = state.storedMarks ?? $head.marks();
  if (parent.type !== sdmTextSchema.nodes.paragraph) {
    const before = $head.nodeBefore;
    const candidate = before ?? $head.nodeAfter;
    if (candidate?.type === sdmTextSchema.nodes.paragraph) {
      parent = candidate;
      const edge = before === null ? candidate.firstChild : candidate.lastChild;
      marks = state.storedMarks ?? edge?.marks ?? [];
    }
  }
  const paragraph: Paragraph =
    parent.type === sdmTextSchema.nodes.paragraph
      ? paragraphFromPmAttrs(parent.attrs)
      : { runs: [] };
  const effective = effectiveParagraph(paragraph);
  const markStyle = runStyleFromMarks(marks);

  return {
    align: effective.align,
    bullet: effective.bullet ?? null,
    level: effective.level,
    lineHeight: effective.lineHeight,
    runStyle: canonicalizeRunStyle({
      ...effective.defaultRunStyle,
      ...markStyle,
    }),
    spaceAfterPt: effective.spaceAfterPt,
    spaceBeforePt: effective.spaceBeforePt,
  };
}
