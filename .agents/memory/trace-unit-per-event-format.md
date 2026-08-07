---
name: TraceUnit per-event packet format
description: 12-byte 0xAA packet format with event_type + payload; multi-event queue for LOAD/CHANGE/CALL/RETURN; trace_stall backpressure.
---

# TraceUnit per-event packet format

## Rule
Each retired instruction emits 1–3 12-byte packets (one per state-change event).
Packet layout (bytes, big-endian): `[0]=0xAA [1..4]=NIA [5]=ev_type [6..9]=GT-word0 [10]=NZCV-flags [11]=fault`.

Event counts per instruction:
- LOAD → 2 (LOAD_SHADOW + LOAD_NEW)
- CHANGE → 3 (CHANGE_PUSH + CHANGE_CR12 + CHANGE_CR5)
- CALL → 3 (CALL_CR6 + CALL_CR14 + CALL_PUSH)
- RETURN → 3 (RETURN_POP + RETURN_CR6 + RETURN_CR14)
- all others → 1 (RESULT)

**Why:** IDE slave mode requires one packet per observable state change; single-instruction packets force the IDE to infer CR changes, violating the slave principle.

## How to apply
- TRACE_EV_* constants 0x00–0x0B; defined in `wukong_top.py`, `wukong_bridge.py`, `docs/debug-packet-protocol.md` — keep them in sync.
- ELOADCALL (0b1000) and XLOADLAMBDA (0b1001) still emit RESULT (single packet); they need separate fix (task #2371).
- RETURN_CR14 payload is approximate (callee's CR14; cload updates after retire); task #2372 tracks the fix.

## Backpressure (no-drop)
`trace_stall` signal is asserted by TraceUnit FSM in SEND state. It is OR-ed into `core.halt_req | imem_valid` so CM cannot retire next instruction until queue drains.

## Core signals added
In `hardware/registers.py`: `trace_rd_addr` / `trace_rd_gt` second combinatorial read port.
In `hardware/core.py` (`__init__`): `retire_trace_load_shadow_gt`, `retire_trace_load_new_gt`, `retire_trace_cr5_gt`, `retire_trace_cr6_gt`, `retire_trace_cr12_gt`, `retire_trace_cr14_gt`.
In `hardware/core.py` (`elaborate`): load shadow latch at `load_start_sig`; `retire_trace_cr6_gt` muxed via `u_return.complete` → `u_return.cload_e_gt` (for RETURN) vs register file (for CALL).

## LOAD new GT
`View(CAP_REG_LAYOUT, u_shared_mload.cr_wr_data).word0_gt` is valid at LOAD retire_valid time because the LOAD FSM uses u_shared_mload as sub_start and the register file write + retire fire in the same cycle.

## Wiring point
opcode decoded from `core.retire_instr[27:31]` (4 bits) matching ChurchOpcode IntEnum values.
