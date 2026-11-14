import { useEffect, useRef, useState } from "react";
import type { CatalogEntry, Inspection } from "./image-api";
import { inspectChoice } from "./latest-image";

export type InspectionState =
  | {status: "unassigned"} | {status: "loading"} | {status: "error"; message: string}
  | {status: "ready"; inspection: Inspection};

export type InspectionOptions = {planning?: boolean; catalogLoading?: boolean};

/** Read-only inspection of one exact saved Namespace; stale responses are dropped.
 *  `planning` asks the server for latest-verified LUMP sizes (Next Bitstream only). */
export function useNamespaceInspection(ref: string, entries: CatalogEntry[], options: InspectionOptions = {}) {
  const {planning = false, catalogLoading = false} = options;
  const [slot, setSlot] = useState<{key: string; state: InspectionState}>({key: "", state: {status: "unassigned"}});
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const exactId = entries.find(entry => entry.selection_key === ref)?.id ?? "";
  const key = `${ref}|${exactId}|${planning}`;
  const setState = (next: InspectionState) => setSlot({key, state: next});
  useEffect(() => {
    const mine = ++generation.current;
    if (!ref) { setState({status: "unassigned"}); return; }
    if (!exactId) {
      setState(catalogLoading ? {status: "loading"}
        : {status: "error", message: "The selected Namespace is not available in the saved catalog. Choose another or retry the catalog."});
      return;
    }
    const controller = new AbortController();
    setState({status: "loading"});
    inspectChoice(exactId, controller.signal, planning)
      .then(inspection => { if (!controller.signal.aborted && mine === generation.current) setState({status: "ready", inspection}); })
      .catch(cause => { if (!controller.signal.aborted && mine === generation.current) setState({status: "error", message: cause instanceof Error ? cause.message : String(cause)}); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, exactId, retry, planning, catalogLoading]);
  // Never expose a ready result that belongs to a previous selection.
  const state = slot.state;
  const fresh: InspectionState = slot.key === key ? state : {status: "loading"};
  return {state: ref ? fresh : {status: "unassigned"} as InspectionState, retry: () => setRetry(v => v + 1)};
}
