---
name: Sapphire SoC power-on-reset — io_asyncReset must be pulsed HIGH then LOW
description: Without a POR pulse on io_asyncReset, io_systemReset stays HIGH forever and the SoC never boots
---

**Symptom:** LED0 (= ~system_reset) stays OFF after flash. LED1 blinks (clock OK), LED2 solid (pins OK), but SoC stuck in reset.

**Root cause:** The Sapphire reset sequencer (`systemCd_logic_holdingLogic_resetCounter`, a 6-bit synchronous counter) only starts counting when `systemCd_logic_inputResetTrigger` goes LOW. That trigger is the synchronised form of `io_asyncReset`. If `io_asyncReset` is never pulsed HIGH, the trigger stays LOW and the counter never reaches MSB — `io_systemReset` is stuck HIGH forever.

**Sapphire reset internals (confirmed from sapphire.v grep):**
- `systemCd` counter is 6-bit, purely synchronous (no `posedge io_asyncReset` sensitivity)
- Counter resets to 0 while `inputResetTrigger` HIGH; counts up when LOW
- `io_systemReset` deasserts when counter MSB (bit 5) sets = 32 cycles after trigger deasserts

**Correct POR circuit for Efinity Ti60 (FFs power up to 0, NOT to RTL initial value):**

```verilog
// Count UP from 0 (which Efinity actually initialises FFs to).
// por_reset = HIGH (reset asserted) until counter MSB sets, then LOW.
(* keep = "true" *) reg [7:0] por_cnt = 8'h00;
always @(posedge clk)
    if (!por_cnt[7]) por_cnt <= por_cnt + 1'b1;
wire por_reset = ~por_cnt[7];  // HIGH for 128 cycles (~5 µs at 25 MHz), then LOW forever

// In Sapphire instantiation:
.io_asyncReset (por_reset),
```

**Why the shift-register approach failed:** `reg [7:0] por_sr = 8'hFF` — Efinity Ti60 fabric FFs power up to 0 on real silicon, ignoring the RTL initial value. So `por_sr` was always 0x00, `por_sr[7]` was always 0, and `io_asyncReset` was permanently LOW = no reset pulse ever sent.

**Critical Efinity workflow trap:** After pulling or editing any source file, you MUST **close the project and reopen it** in Efinity before compiling. Efinity caches project state at open time and will silently compile the old cached version otherwise. Closing+reopening forces it to re-read all source files from disk.

**How to apply:** Every top.v for this SoC must use the counter-based `por_reset` for `io_asyncReset`. Without it the board flashes successfully but never boots.
