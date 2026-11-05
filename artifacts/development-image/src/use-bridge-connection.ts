import {useEffect, useState} from "react";
import {request} from "./image-api";
import type {BoardStatus} from "./image-api";

export type ConnectionCheck = {
  connected: boolean; failures: number; issue: "bridge" | "server" | null;
};
export function checkedConnection(previous: ConnectionCheck, board?: BoardStatus): ConnectionCheck {
  const target = board?.physical_target;
  const connected = !!(target?.live && target.device_uid && target.session_id);
  return {connected, failures: connected ? 0 : previous.failures + 1,
    issue: connected ? null : board ? "bridge" : "server"};
}

// Read-only recovery: retry transient requests and observe the bridge's own
// reconnect attempts. Never approve credentials, reset the board or send images.
export function useBridgeConnection() {
  const [state, setState] = useState<ConnectionCheck>({connected: false, failures: 0, issue: null});
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    let current: ConnectionCheck = {connected: false, failures: 0, issue: null};
    setState(current);
    const check = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 5000);
      let board: BoardStatus | undefined;
      try {
        board = await request<BoardStatus>("/hardware/wukong/status", {signal: controller.signal});
      } catch { /* A failed request cannot preserve a previous live target. */ }
      finally { clearTimeout(timeout); }
      if (!active) return;
      current = checkedConnection(current, board);
      setState(current);
      timer = setTimeout(check, current.failures >= 4 ? 10000 : 3000);
    };
    void check();
    return () => { active = false; clearTimeout(timer); controller?.abort(); };
  }, [generation]);
  return {...state, needsHelp: state.failures >= 4, retry: () => setGeneration(n => n + 1)};
}
