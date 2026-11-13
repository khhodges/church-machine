import { useEffect, useRef, useState } from "react";
import type { CatalogEntry, Inspection } from "./image-api";
import { inspectChoice } from "./latest-image";

export type InspectionState =
  | {status: "unassigned"} | {status: "loading"} | {status: "error"; message: string}
  | {status: "ready"; inspection: Inspection};

/** Read-only inspection of one exact saved Namespace; stale responses are dropped. */
export function useNamespaceInspection(ref: string, entries: CatalogEntry[]) {
  const [state, setState] = useState<InspectionState>({status: "unassigned"});
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const exactId = entries.find(entry => entry.selection_key === ref)?.id ?? "";
  useEffect(() => {
    const mine = ++generation.current;
    if (!ref) { setState({status: "unassigned"}); return; }
    if (!exactId) { setState({status: "loading"}); return; }
    const controller = new AbortController();
    setState({status: "loading"});
    inspectChoice(exactId, controller.signal)
      .then(inspection => { if (!controller.signal.aborted && mine === generation.current) setState({status: "ready", inspection}); })
      .catch(cause => { if (!controller.signal.aborted && mine === generation.current) setState({status: "error", message: cause instanceof Error ? cause.message : String(cause)}); });
    return () => controller.abort();
  }, [ref, exactId, retry]);
  return {state, retry: () => setRetry(v => v + 1)};
}
