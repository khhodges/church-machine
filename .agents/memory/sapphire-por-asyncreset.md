---
name: Sapphire SoC power-on-reset — io_asyncReset must be pulsed
description: Without a POR pulse on io_asyncReset, io_systemReset stays HIGH forever and the SoC never boots
---

**Symptom:** LED0 (= ~system_reset) stays OFF after flash. LED1 blinks (clock OK), LED2 solid (pins OK), but SoC stuck in reset.

**Root cause:** The Sapphire reset sequencer requires `io_asyncReset` to go HIGH then LOW to start its internal countdown. Tying `io_asyncReset = 1'b0` permanently means the sequencer never fires and `io_systemReset` stays HIGH.

**Fix:** Add an 8-bit shift-register POR circuit in top.v:

```verilog
(* keep = "true" *) reg [7:0] por_sr = 8'hFF;
always @(posedge clk) por_sr <= {por_sr[6:0], 1'b0};
wire por_reset = por_sr[7];   // HIGH 8 cycles (~320 ns), then LOW

// In Sapphire instantiation:
.io_asyncReset (por_reset),
```

Efinity efx_map on Titanium devices honours the `= 8'hFF` initial value for fabric FFs. The `(* keep = "true" *)` attribute prevents the synthesiser from optimising away the shift register.

**Why:** This design has no PLL (clock goes direct through CLKMUX), so there is no PLL-lock signal to derive asyncReset from. The POR shift register is the canonical fix. 8 cycles at 25 MHz = 320 ns — more than enough for the reset sequencer.

**How to apply:** Every top.v for this SoC must use `por_reset` not `1'b0` for `io_asyncReset`. Without it the board flashes successfully but never boots.
