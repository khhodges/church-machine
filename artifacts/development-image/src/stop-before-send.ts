import {request} from "./image-api";
import type {BoardStatus, Target} from "./image-api";

/** Only called after explicit replacement consent. Never resets or releases faults. */
export async function stopBeforeSend(target: Target, token: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const options = {signal: controller.signal};
    const checkTarget = (board: BoardStatus) => {
      const actual = board.physical_target;
      if (!actual?.live || actual.device_uid !== target.device_uid ||
          actual.session_id !== target.session_id)
        throw Error("Board connection changed. Nothing was uploaded. Reopen Send for the current board.");
    };
    checkTarget(await request<BoardStatus>("/hardware/wukong/status", options));
    const stop = await request<{id: number}>("/hardware/wukong/command", {
      ...options, method: "POST",
      headers: {"Content-Type": "application/json", Authorization: `Bearer ${token}`},
      body: JSON.stringify({cmd: "h", target_device_uid: target.device_uid,
        target_session_id: target.session_id}),
    });
    if (!Number.isInteger(stop.id)) throw Error("STOP response was invalid. Nothing was uploaded.");
    while (!controller.signal.aborted) {
      const board = await request<BoardStatus>("/hardware/wukong/status", options);
      checkTarget(board);
      const delivery = board.command_delivery;
      if (delivery?.id === stop.id) {
        if (delivery.write_ok === false)
          throw Error("The bridge could not deliver STOP. Nothing was uploaded. Check the bridge connection.");
        if (delivery.cmd === "h" && delivery.write_ok === true &&
            delivery.board_halt_confirmed === true &&
            delivery.target_device_uid === target.device_uid &&
            delivery.target_session_id === target.session_id &&
            delivery.board_halt_session === target.session_id &&
            typeof delivery.board_halt_ts === "number") return;
      } else if (typeof delivery?.id === "number" && delivery.id > stop.id) {
        throw Error("Another command interrupted STOP. Nothing was uploaded. Retry when the board is idle.");
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw Error("STOP timed out.");
  } catch (error) {
    if (controller.signal.aborted)
      throw Error("The board did not confirm STOP within 15 seconds. Nothing was uploaded; STOP may still be pending. Check board status before retrying.");
    throw error;
  } finally { clearTimeout(timeout); }
}
