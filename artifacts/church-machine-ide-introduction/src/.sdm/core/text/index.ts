/* oxlint-disable @replit/web/no-barrel-file -- package subpath entry: @replit/sdm-core/text is consumed as one module and mirrored file-by-file into the slides artifact */
export {
  formattingContinuityPlugin,
  initializeFormattingContinuity,
} from './formattingContinuity';
export {
  effectiveRunStyleCss,
  paragraphLayoutCss,
  paragraphMarkerCss,
  resolveTextColor,
  resolveTextFont,
  runStylePropertyCss,
  type SdmTextCssStyle,
} from './inlineStyles';
export {
  SDM_DEFAULT_LIST_INDENT_PT,
  SDM_DEFAULT_MARKER_HANG_PT,
  effectiveParagraph,
  type EffectiveParagraph,
} from './listStyles';
export {
  createParagraphMarkerPlugin,
  formatBulletNumber,
  paragraphMarkers,
} from './paragraphMarkers';
export {
  backspaceParagraphFormatting,
  indentParagraphs,
  outdentParagraphs,
  setBulletProperties,
  setParagraphAlignment,
  setParagraphSpacing,
  setRunStyle,
  splitSdmParagraph,
  toggleCharacterBullets,
  toggleNumberedBullets,
  type SdmBulletUpdate,
} from './pmCommands';
export {
  canonicalizeRunStyle,
  canonicalizeTextBody,
  docToTextBody,
  docToTextBodyWithReuse,
  marksFromRunStyle,
  runStyleFromMarks,
  runStyleFromRun,
  textBodyToDoc,
} from './pmDoc';
export { sdmTextSchema } from './pmSchema';
export { deepEqual, runStyleOverrides } from './styleUtils';
export {
  selectionFormatting,
  type SdmSelectionFormatting,
} from './selectionFormatting';
