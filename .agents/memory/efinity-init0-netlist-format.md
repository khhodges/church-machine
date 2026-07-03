---
name: Efinity map.v INIT_0 attribute format varies by version
description: How to parse BRAM INIT_0 initial-content values out of efx_map's synthesized map.v — the textual shape changed between Efinity releases and broke a naive guard.
---

## Two confirmed shapes for the same attribute

Post-synthesis `outflow/<circuit>.map.v` encodes each `EFX_RAM10` instance's
initial BRAM content in an `INIT_0` attribute, but the literal syntax is not
stable across Efinity versions:

1. **Quoted hex string** (seen on older Efinity map output):
   `INIT_0("0000000000000000...")`
2. **Unquoted sized Verilog literal**, inside a long inline
   `/* verific EFX_ATTRIBUTE_CELL_NAME=EFX_RAM10, ..., INIT_0=256'h0000... */`
   comment (confirmed on Efinity 2026.1's `verific`-generated netlist).
   Radix letter (`'h`, `'b`, `'o`) immediately follows the tick; other
   attributes in the same comment (`WRITE_MODE="READ_FIRST"`, etc.) DO use
   quotes, so quote-presence alone cannot distinguish the two shapes.

**Why it matters:** a regex-based guard tuned only for shape 1 will find no
match at all against shape 2 and report "could not parse" — which reads
exactly like an all-zero BRAM failure, even when the firmware is correctly
embedded. This caused a real false-positive build abort after `run_efx_map.sh`
was pointed at Efinity 2026.1.

**How to apply:** any script that greps `map.v` (or other Efinity-generated
netlist/report files) for attribute values must try multiple known literal
shapes, not just one, and should be re-validated against a fresh real sample
whenever the Efinity version used for that stage changes — a version bump can
change comment/netlist text even when the CLI interface doesn't. See
`efinity-version-split.md` for the broader version-pinning history.
