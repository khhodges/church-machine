---
name: Ti60F225 hardware facts
description: Physical board constraints and top.v wiring bugs that were fixed
---

## Ti60F225 devkit — exactly 3 user LEDs

The board has **3** user LEDs, not 4:
- LED0 → GPIOR_P_07 (ball R7)
- LED1 → GPIOR_P_08 (ball P8)
- LED2 → GPIOR_P_09 (ball P9)

A 4th signal (led3 / GPIOR_P_10 or GPIOR_N_07) does not have a physical LED. Any top.v or peri.xml that declares `led3` maps to a floating pin and the signal is silently unobservable.

**Why:** The soc_combined design had led3 in both top.v and peri.xml. Removing it is required or the port list doesn't match the board.

## top.v CM debug port bug (fixed)

church_ti60f225 has output ports dbg_boot_complete, dbg_nia, dbg_fault [3:0], dbg_fault_valid. These were left unconnected in top.v; instead:
- cm_boot_complete was wired to cm_led1 (the halted-heartbeat — blinks while waiting, goes LOW when free-run starts → firmware never saw boot_complete=1)
- cm_nia was 32'b0 (CALLHOME always showed nia=0x00000000)
- cm_fault_valid was 1'b0, cm_fault was 5'b0 (fault detection broken)

**Fix:** Wire the debug ports directly. dbg_fault is [3:0] — zero-extend to [4:0] for the APB3 bridge: `assign cm_fault = {1'b0, cm_dbg_fault}`.

## CM boot sequence timing

- boot_start fires 15 cycles after FPGA reset (automatic, no firmware needed)
- dbg_boot_complete asserts in < 1 ms (sticky forever after)
- CM debug FSM counts ~3 s (startup_ctr = 75,620,543 cycles @ 25 MHz)
- After 3 s: FSM sends banner → banner_ever_sent=1 → LED2 turns ON
- FSM fires free_run_start (NIA=0) → CM executes → LED2 stays ON

## CM fault recovery (correct path)

boot_triggered latch prevents boot_start from re-firing. The only recovery path is:
hold push_button LOW for ≥ 1 s → btn_hold_done → FSM state 0x0b → 0x02 → 0x07 (free_run_start).
A 5 ms pulse does nothing. Firmware must hold for 1.5 s (with margin).
