---
name: church_ti60f225 module name
description: Amaranth/Yosys always generates the CM top module as church_ti60f225 (no underscore); top.v must instantiate it without underscore
---

The Amaranth HDL generates `build/church_ti60_f225.v` but the module declaration inside is always:

```verilog
module church_ti60f225(clk, push_button, uart_tx, ...);
```

No underscore between `ti60` and `f225`. Yosys collapses the hierarchy separator.

**Rule:** `hardware/soc_combined/top.v` must instantiate `church_ti60f225 u_cm (` — never `church_ti60_f225`.

**Why:** When `top.v` uses `church_ti60_f225` (with underscore) and the generated module is `church_ti60f225` (no underscore), Efinity's `efx_map` hits a null-pointer during symbol resolution and hard-crashes with a bare STACK TRACE (identical addresses every run, no EFX-XXXX error code). The crash looks like a tool bug but is actually an unresolved instantiation.

**How to apply:** Any time `top.v` is edited or regenerated, grep-check: `grep "church_ti60" top.v | grep "u_cm"` — must show `church_ti60f225 u_cm`, not `church_ti60_f225 u_cm`.
