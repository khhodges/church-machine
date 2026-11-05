import type {BoardStatus} from "./image-api";

export const reconnectHelp = "If the bridge terminal reports HTTP 401/403 for registration or snapshots, server authorization was rejected — not a UART diagnosis. Check the intended --ide server and securely configure its REPORT_TOKEN in the bridge terminal, then restart the bridge. Never paste credentials into logs, URLs or chat. Wait for accepted registration and a fresh identified session. A remembered UID does not authorize hardware actions.";

export function connectionStatus(board?: BoardStatus): string {
  const fresh = typeof board?.bridge_poll_age === "number" &&
    board.bridge_poll_age >= 0 && board.bridge_poll_age < 3;
  const trace = typeof board?.last_trace_age === "number" &&
    board.last_trace_age >= 0 && board.last_trace_age < 3;
  const target = board?.physical_target;
  return [
    `UART: ${trace && fresh ? "recent board trace received by server; not proof of continued health" : "current reception unconfirmed; old log output is historical evidence only"}.`,
    `Bridge server authorization: ${fresh ? "recent command poll accepted" : "unconfirmed; inspect the bridge terminal for HTTP 401/403"}.`,
    `Live session: ${target?.live && target.device_uid && target.session_id ? "identified target reported live" : "no live identified target confirmed"}.`,
  ].join(" ");
}
