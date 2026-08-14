---
name: ELOADCALL frame-push full bounds
description: The full CALL-equivalent frame-push architecture for ChurchELoadCall, including required inputs and callee E-GT source.
---

# ELOADCALL frame-push full bounds

## The rule
`ChurchELoadCall` must mirror `ChurchCall`'s frame-push logic exactly, with:
1. **Inputs**: `thread_hdr` (Signal(32), LUMP_HEADER_LAYOUT) and `cr12_thread` (Signal(CAP_REG_LAYOUT)) required alongside the existing `cr5_heap` and `thread_base`.
2. **PUSH_CR5_CR12 state** before PUSH_ARM: validates CR5 is non-null with R-perm, and CR12 is non-null. Faults on any failure before touching the stack.
3. **Stack bounds from thread_hdr** in PUSH_BOUNDS (replaces old literal `STO < 2`):
   - `thr_lump_sz = 1 << (n_minus_6 + 6)`
   - `sp_max = thr_lump_sz - 12 - 1` (STO > sp_max → STACK_CORRUPT)
   - `sp_min = thr_lump_sz - 10 - cw` (STO < sp_min → STACK_OVERFLOW)
4. **callee_egt_latched from CALL_P1_DONE**: latch `CR6.word0_gt` in the CALL_P1_DONE state (after phase-1 mLoad writes to CR6). Use this in PUSH_EGT, NOT `loaded_cap.word0_gt` from phase-0.

## Why
ELOADCALL's 3-phase structure means phase-0 loads the lump cap into CR1 (not CR6), while phase-1 loads the c-list cap into CR6. The callee E-GT in the stack frame must be the phase-1 CR6 GT. Using the phase-0 GT misrepresents the callee for non-trivial c-lists.

The `STO < 2` literal guard was insufficient — CALL uses header-derived bounds. A corrupt STO pointer (above sp_max) could cause uncontrolled DMEM writes without the upper-bound check.

## How to apply
- In `hardware/fused_unit.py` ChurchELoadCall: wire `thread_hdr` and `cr12_thread` in `core.py` from `u_change.thread_hdr_out` and `u_regs.cr12_thread`.
- FSM order: `DISPATCH/FETCH_METHOD_ENTRY → PUSH_CR5_CR12 → PUSH_ARM → PUSH_READ_STO → PUSH_BOUNDS → PUSH_EGT → PUSH_FRAME → PUSH_STO → COMPLETE`.
- PUSH_EGT writes `callee_egt_latched` (latched from `View(CAP_REG_LAYOUT, self.cr_rd_data).word0_gt.as_value()` in CALL_P1_DONE).
- PUSH_STO writes full 32-bit `sto_latched - 2` (not partial Cat with zeroed upper bits).
- Tests in `tests/hardware/test_eloadcall_frame_push.py` use distinct GTs for phase-0 and phase-1 to verify callee_egt_latched sources from phase-1.
