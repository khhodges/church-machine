import type { Bullet, Paragraph, RunStyle } from '../schema';

export const SDM_DEFAULT_LIST_INDENT_PT = 36;
export const SDM_DEFAULT_MARKER_HANG_PT = 24;

export interface EffectiveParagraph
  extends Omit<
    Paragraph,
    | 'align'
    | 'bullet'
    | 'defaultRunStyle'
    | 'hangingIndentPt'
    | 'indentPt'
    | 'level'
    | 'lineHeight'
    | 'markerStyle'
    | 'spaceAfterPt'
    | 'spaceBeforePt'
  > {
  align: NonNullable<Paragraph['align']>;
  bullet: Bullet | undefined;
  defaultRunStyle: RunStyle;
  hangingIndentPt: number;
  indentPt: number;
  level: number;
  lineHeight: number;
  markerStyle: RunStyle;
  spaceAfterPt: number;
  spaceBeforePt: number;
}

export function effectiveParagraph(paragraph: Paragraph): EffectiveParagraph {
  const level = paragraph.level ?? 0;
  const bullet = paragraph.bullet;
  const hasMarker =
    bullet !== undefined &&
    (bullet.kind === 'character' || bullet.kind === 'number');
  const hangingIndentPt =
    paragraph.hangingIndentPt ?? (hasMarker ? SDM_DEFAULT_MARKER_HANG_PT : 0);
  const indentPt =
    paragraph.indentPt ?? level * SDM_DEFAULT_LIST_INDENT_PT + hangingIndentPt;

  return {
    ...paragraph,
    align: paragraph.align ?? 'left',
    bullet,
    defaultRunStyle: paragraph.defaultRunStyle ?? {},
    hangingIndentPt,
    indentPt,
    level,
    lineHeight: paragraph.lineHeight ?? 1.2,
    markerStyle: paragraph.markerStyle ?? {},
    spaceAfterPt: paragraph.spaceAfterPt ?? 0,
    spaceBeforePt: paragraph.spaceBeforePt ?? 0,
  };
}
