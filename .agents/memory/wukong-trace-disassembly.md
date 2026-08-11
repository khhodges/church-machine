---
name: Wukong trace disassembly and source labels
description: Current trace packets carry NIA but no instruction word, so exact disassembly is source-map dependent
---

The current 12-byte Wukong trace packet contains NIA, event type, GT payload, flags, and fault bits, but not the fetched 32-bit instruction. Exact `pet-name.offset` and mnemonic display therefore require a matching source map (currently the fixed WukongCallHome reference program); unknown or uploaded code must be shown as unresolved rather than guessed.

TraceUnit opcode dispatch must use the full five-bit instruction field `[31:27]`. Using `[30:27]` aliases Turing DREAD (opcode 16, `10000b`) to Church LOAD (opcode 0), producing spurious `LOAD.shadow`/`LOAD.new` packets. The Wukong LUMP header occupies byte `0x700`; executable word 0 begins at `0x704`, so source-map offsets must account for that header.

**Why:** NIA alone identifies an address, not the instruction bytes at that address, and the FPGA can execute an uploaded boot image that differs from the workspace source.

**How to apply:** Keep source-derived labels backward-compatible in the bridge/server/UI. Audit every TraceUnit opcode selector against the five-bit ISA field and keep the LUMP header offset in source maps. The live trace identity must outrank a cached uploaded code map when selecting the FPGA workspace listing; if the trace says WukongCallHome, do not render an overlapping SelfTest map. If arbitrary uploaded-code disassembly is required, add an explicitly versioned trace packet instruction-word field and reflash the board; do not infer it from event type.