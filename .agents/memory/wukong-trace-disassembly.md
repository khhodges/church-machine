---
name: Wukong trace disassembly and source labels
description: Current trace packets carry NIA but no instruction word, so exact disassembly is source-map dependent
---

The current 12-byte Wukong trace packet contains NIA, event type, GT payload, flags, and fault bits, but not the fetched 32-bit instruction. Exact `pet-name.offset` and mnemonic display therefore require a matching source map (currently the fixed WukongCallHome reference program); unknown or uploaded code must be shown as unresolved rather than guessed.

**Why:** NIA alone identifies an address, not the instruction bytes at that address, and the FPGA can execute an uploaded boot image that differs from the workspace source.

**How to apply:** Keep source-derived labels backward-compatible in the bridge/server/UI. If arbitrary uploaded-code disassembly is required, add an explicitly versioned trace packet instruction-word field and reflash the board; do not infer it from event type.