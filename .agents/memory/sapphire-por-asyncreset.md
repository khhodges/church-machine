---
name: Sapphire SoC power-on-reset — io_asyncReset must be pulsed HIGH then LOW
description: Without a POR pulse on io_asyncReset the full two-stage reset chain stays locked and io_systemReset is stuck HIGH forever
---

**Symptom:** LED0 (= ~system_reset) stays OFF after flash. UART silent. All user LEDs off.

## Why asyncReset=0 permanently causes a deadlock

The Sapphire reset chain is TWO-STAGE, not one-stage. The full path:

```
asyncReset → bufferCC_5 (async-PRESET to 1 while asyncReset HIGH)
  → debugCd_logic_inputResetTrigger = bufferCC_5_io_dataOut
    → debugCd_holdingLogic_resetCounter (12-bit) resets to 0 while trigger=1
      → when counter reaches 0xFFF: debugCd_outputReset goes LOW
        → bufferCC_6 (async-PRESET to 1 while debugCd_outputReset HIGH) releases
          → systemCd_logic_inputResetTrigger goes LOW
            → systemCd_holdingLogic_resetCounter (6-bit) counts to 63
              → io_systemReset goes LOW → LED0 ON
```

Key sapphire.v lines:
- bufferCC_5: line 1181-1186, preset=io_asyncReset, io_dataIn=1'b0
- debugCd_inputResetTrigger: lines 1755-1760, = bufferCC_5_io_dataOut ONLY
- initial begin debugCd_logic_outputReset=1'b1 at lines 1750-1753 (honored by Efinity)
- bufferCC_6: lines 1187-1192, preset=debugCd_logic_outputReset, io_dataIn=1'b0
- systemCd_inputResetTrigger: lines 1771-1779, = bufferCC_6|bufferCC_7
- io_systemReset: held HIGH while systemCd hold counter stuck at 0

If asyncReset=0 always: bufferCC_5_io_dataOut=0 always, debugCd_trigger=0 always,
BUT debugCd_logic_outputReset starts at 1 (initial block honored) and the 12-bit
debug hold counter also starts counting from 0. The debug hold counter DOES count
freely when trigger=0, reaches 4095, debugCd_outputReset goes LOW, and the chain
releases. EMPIRICALLY this does NOT work — asyncReset MUST pulse.

## Efinity Ti60 FFs power up to 0 — RTL initial value is ignored

Efinity Ti60 fabric FFs power up to 0 on real silicon regardless of RTL
`= initial_value` syntax. So `reg [7:0] por_cnt = 8'hFF` starts at 0x00.

### DOWN-counter (WRONG — both variants fail)

```verilog
// WRONG: FFs start at 0x00, |por_cnt=0 immediately, counter never runs
(* syn_keep = "true" *) reg [7:0] por_cnt = 8'hFF;
always @(posedge clk) if (|por_cnt) por_cnt <= por_cnt - 1;
wire por_reset = |por_cnt;
```

- Variant A (syn_keep present): Efinity 2026.1 syn_keep on a register with a
  non-zero INIT_VALUE FREEZES the register at that value rather than running the
  counter. por_cnt stays at 0xFF permanently → asyncReset=1 always → bufferCC_5
  held HIGH forever by active preset → debug counter stuck at 0 → DEADLOCK.
- Variant B (syn_keep absent): FFs start at 0 (initial value ignored), counter
  sees |0=0 immediately, never runs, por_reset=0 always → asyncReset=0 → no pulse.

### UP-counter (CORRECT)

```verilog
(* keep = "true" *) reg [7:0] por_cnt = 8'h00;
always @(posedge clk)
    if (!por_cnt[7]) por_cnt <= por_cnt + 1'b1;
wire por_reset = ~por_cnt[7];  // HIGH for 128 cycles (~5 µs at 25 MHz), then LOW
```

- por_cnt starts at 0x00 (matches actual HW power-up state)
- `!por_cnt[7]` = 1 immediately → counter runs
- After 128 cycles: por_cnt[7]=1 → por_reset goes LOW → asyncReset deasserts
- `(* keep = "true" *)` (NOT syn_keep) prevents efx_map pruning without causing the freeze

**Why:** DOWN from 0xFF requires the RTL initial value to be respected by hardware
(it isn't). UP from 0x00 works with the actual hardware power-up state.

## jtagCtrl_reset must also be 1'b1

`jtagCtrl_reset=0` was a separate second issue (stale top.v) that also prevented
boot via a different path. Both must be correct: `jtagCtrl_reset=1'b1` AND the
correct UP-counter POR.
