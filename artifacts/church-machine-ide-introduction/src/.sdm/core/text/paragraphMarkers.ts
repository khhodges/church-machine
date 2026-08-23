import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

import { SDM_MAX_NUMBER_START_AT, type Paragraph, type Theme } from '../schema';
import { paragraphMarkerCss } from './inlineStyles';
import { effectiveParagraph, type EffectiveParagraph } from './listStyles';
import { paragraphFromPmAttrs, runStyleFromMarks } from './pmDoc';
import { sdmTextSchema } from './pmSchema';

// OOXML repeated-letter alphabetic numbering: 26 -> z, 27 -> aa, 53 -> aaa.
function alphaNumber(value: number, uppercase: boolean): string {
  const letter = String.fromCharCode(
    (uppercase ? 65 : 97) + ((value - 1) % 26),
  );

  return letter.repeat(Math.floor((value - 1) / 26) + 1);
}

function romanNumber(value: number, uppercase: boolean): string {
  const numerals: Array<[number, string]> = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ];
  let remaining = value;
  let result = '';
  for (const [amount, numeral] of numerals) {
    while (remaining >= amount) {
      result += numeral;
      remaining -= amount;
    }
  }

  return uppercase ? result.toUpperCase() : result;
}

const NUMBER_STYLE_ALIASES: Record<string, string> = {
  decimal: 'arabicPeriod',
  lowerAlpha: 'alphaLcPeriod',
  lowerLatin: 'alphaLcPeriod',
  lowerRoman: 'romanLcPeriod',
  upperAlpha: 'alphaUcPeriod',
  upperLatin: 'alphaUcPeriod',
  upperRoman: 'romanUcPeriod',
};

export function formatBulletNumber(style: string | undefined, value: number) {
  const scheme =
    NUMBER_STYLE_ALIASES[style ?? 'arabicPeriod'] ?? style ?? 'arabicPeriod';
  const count = Math.max(
    1,
    Math.min(SDM_MAX_NUMBER_START_AT, Math.trunc(value)),
  );
  let body: string;
  if (scheme.startsWith('alphaUc')) {
    body = alphaNumber(count, true);
  } else if (scheme.startsWith('alphaLc')) {
    body = alphaNumber(count, false);
  } else if (scheme.startsWith('romanUc')) {
    body = romanNumber(count, true);
  } else if (scheme.startsWith('romanLc')) {
    body = romanNumber(count, false);
  } else {
    body = String(count);
  }
  if (scheme.endsWith('ParenBoth')) {
    return `(${body})`;
  }
  if (scheme.endsWith('ParenR')) {
    return `${body})`;
  }
  if (scheme.endsWith('Plain')) {
    return body;
  }

  return `${body}.`;
}

/**
 * Paragraphs that carry runs with no text are transparent: they render no
 * marker and neither advance nor reset numbering. Omit `runs` to count a
 * paragraph unconditionally, which the live editor does for the caret's
 * empty line so typing previews its marker.
 */
export function paragraphMarkers(
  paragraphs: ReadonlyArray<
    Pick<Paragraph, 'bullet' | 'level'> & Partial<Pick<Paragraph, 'runs'>>
  >,
): Array<string> {
  const counters = new Map<number, number>();

  return paragraphs.map((paragraph) => {
    if (
      paragraph.runs !== undefined &&
      !paragraph.runs.some((run) => run.text !== '')
    ) {
      return '';
    }
    const level = paragraph.level ?? 0;
    if (paragraph.bullet?.kind === 'number') {
      const startAt = paragraph.bullet.startAt ?? 1;
      const restart = paragraph.bullet.startAt !== undefined;
      const count = restart
        ? startAt
        : (counters.get(level) ?? startAt - 1) + 1;
      counters.set(level, count);
      for (const counterLevel of counters.keys()) {
        if (counterLevel > level) {
          counters.delete(counterLevel);
        }
      }

      return `${formatBulletNumber(paragraph.bullet.style, count)} `;
    }
    for (const counterLevel of counters.keys()) {
      if (counterLevel >= level) {
        counters.delete(counterLevel);
      }
    }

    return paragraph.bullet?.kind === 'character'
      ? `${paragraph.bullet.character} `
      : '';
  });
}

function paragraphMetadata(doc: ProseMirrorNode): Array<EffectiveParagraph> {
  const paragraphs: Array<EffectiveParagraph> = [];
  doc.forEach((node) => {
    paragraphs.push(effectiveParagraph(paragraphForMarker(node)));
  });

  return paragraphs;
}

function paragraphForMarker(node: ProseMirrorNode): Paragraph {
  return {
    ...paragraphFromPmAttrs(node.attrs),
    runs: [
      {
        text: '',
        ...(node.firstChild === null
          ? {}
          : runStyleFromMarks(node.firstChild.marks)),
      },
    ],
  };
}

export function createParagraphMarkerPlugin(theme?: Theme): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const paragraphs = paragraphMetadata(state.doc);
        const { $head } = state.selection;
        const headIndex =
          $head.parent.type === sdmTextSchema.nodes.paragraph
            ? $head.index(0)
            : undefined;
        // Blank paragraphs stay markerless while editing, matching the
        // static render; only the caret's own empty line previews the
        // marker typing would produce.
        const markers = paragraphMarkers(
          paragraphs.map(({ bullet, level }, index) => ({
            bullet,
            level,
            ...(state.doc.child(index).content.size === 0 && index !== headIndex
              ? { runs: [] }
              : {}),
          })),
        );
        const decorations: Array<Decoration> = [];
        state.doc.forEach((node, position, index) => {
          const marker = markers[index];
          const paragraph = paragraphs[index];
          if (
            node.type !== sdmTextSchema.nodes.paragraph ||
            marker === undefined ||
            marker === '' ||
            paragraph === undefined
          ) {
            return;
          }
          decorations.push(
            Decoration.widget(
              position + 1,
              () => {
                const span = document.createElement('span');
                span.contentEditable = 'false';
                span.dataset.sdmTextMarker = '';
                span.textContent = marker;
                Object.assign(span.style, paragraphMarkerCss(paragraph, theme));

                return span;
              },
              { side: -1 },
            ),
          );
        });

        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}
