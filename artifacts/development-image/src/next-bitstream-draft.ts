import type { DraftInputs } from "./next-bitstream";

export type PlanningDraft = {refA: string; refB: string; draft: DraftInputs};
type DraftHost = Window & {__nextBitstreamPlanningDraft?: PlanningDraft};

// The IDE can reload its embedded frame when a Namespace selection changes.
// Keep only this unsaved planning draft in the parent tab's memory, not a
// saved Namespace, browser storage, or a hardware image.
function host(): DraftHost {
  try {
    if (window.parent !== window && window.parent.document.getElementById("developmentImageFrame"))
      return window.parent as DraftHost;
  } catch { /* Standalone/cross-origin frames own their own draft. */ }
  return window as DraftHost;
}
export function readPlanningDraft(): PlanningDraft {
  const saved = host().__nextBitstreamPlanningDraft;
  return saved ? {...saved, draft: {...saved.draft}} :
    {refA: "", refB: "", draft: {total: "", namespaceA: "", namespaceB: "", lumpZone: ""}};
}
export function rememberPlanningDraft(value: PlanningDraft) {
  host().__nextBitstreamPlanningDraft = {...value, draft: {...value.draft}};
}
