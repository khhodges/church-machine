---
name: Wukong standalone boot — CALL/LOAD/retire fixes (v7)
description: The cluster of core bugs that blocked the standalone boot CALL into WukongCallHome, and the rules that fixed them
---

## Rules (all in hardware/core.py / load.py / call.py unless noted)

1. **Sync-BRAM fetch needs a settle bubble at the platform level.** The core's
   `imem_valid` input must be masked for one cycle after `imem_addr` changes
   (`imem_addr_prev != imem_addr`), or the core retires a stale decode right
   after every NIA jump and the instruction stream slides one slot (an
   instruction is silently skipped). Applied in `wukong_top.py` and the
   `BootRomHarness` in `test_boot_rom_no_false_halt.py`.
   **Why:** BRAM read data lags the address by 1 cycle; `instr_valid` was
   `imem_valid & boot_complete` with imem_valid held constant.

2. **One-cycle busy gaps on issue.** Wrapper FSMs (load, call) raise `busy`
   one sync cycle after `start`; the core's `any_unit_busy`/retire logic sees
   "not busy" during the gap and lets the NEXT instruction issue/retire.
   Fixes: `load_busy_shadow` (registered `load_start_sig`) ORed into
   busy_expr; `~call_start_sig` excluded from `retire_norm` AND the `nia+4`
   advance (CALL retires only via nia_set — otherwise it double-retires and
   nia_set shows the wrong retire_nia).

3. **Shared-bus subunits must latch operands at start.** `u_load` now latches
   cr_src/cr_dst/index at `load_start`; comb-wired decoder operands belong to
   the wrong instruction once the PC advances (observed LOAD CR3 running with
   dst=CR4).

4. **Decoder/perm comb faults must be gated on `~any_unit_busy`.** While a
   multi-cycle unit owns the shared DMEM bus, fetch data is garbage; the
   decoder decoded mload traffic as INVALID_OP and spuriously fault-retired
   the next instruction.

5. **`boot_retire_count` must reset on clear_all (FAULT_RST).** Otherwise
   pass-2 reboots run the 3 boot instructions without M-elevation and fault
   VERSION at the very first boot LOAD.

6. **rd_armed stale-valid guard pattern** (mload FETCH_GT, call unit direct
   reads, ns_gate): the shared `dmem_rd_valid` is a 1-cycle-delayed rd_en from
   ANY master; each FSM read state must wait one arming cycle before trusting
   valid/data. Cycle-stepped unit tests (e.g. test_outform_fault) must add
   one tick per guarded read state.

## Related layout facts
- WCH lump needs its own c-list (cc=8, c-list at lump tail); a called lump
  with cc=0 gets NULL CR6 (SET_CR6_BASE writes NULL). CR6.limit = cc-1 and
  mload bounds is strict `<`, so highest usable index is cc-2.
- N_INIT guards: `hardware/wukong_dmem_count.ref` (regen via
  `check_dmem_count.py --write`) + hardcoded expectations in
  `test_dmem_count_guard.py` + a mirrored dmem_init in
  `test_boot_sequence.py::test_wukong_boot_triggered` — all three must be
  updated together when boot_rom DMEM content changes.
