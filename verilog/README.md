# CM Verilog — Implementation A (Active Synthesis Target)

This directory contains the synthesizable Verilog output for the Church Machine (CM)
capability-based architecture, generated from the Amaranth HDL source in `hardware/`.

## Active Pipeline

```
hardware/*.py  →  gen_verilog.py  →  verilog/church_core.v
```

`church_core.v` and `church_tang_nano_20k.v` are the only files in this directory
that participate in synthesis.  They are generated artifacts — do not edit them by
hand.  Re-run `gen_verilog.py` to regenerate after changing the Amaranth source.

## Files

```
verilog/
├── church_core.v            # Generated CM core (Amaranth → Verilog, v2.0 32-bit GTs, integrity32)
├── church_tang_nano_20k.v   # Tang Nano 20K top-level wrapper
└── README.md                # This file
```

## GT Format (v2.0, active)

The active implementation uses **32-bit Golden Tokens** with the following layout:

```
[31]     b_flag  — Bind flag (cleared on CALL)
[30:29]  gt_type — 00=NULL, 01=INFORM, 10=OUTFORM, 11=ABSTRACT
[28]     dom     — 0=Turing, 1=Church
[27:25]  perm    — 3-bit permission field (meaning depends on dom)
[24:16]  gt_seq  — 9-bit version sequence (wraps; mismatch → VERSION fault)
[15:0]   slot_id — Namespace table index
```

Integrity is checked via **integrity32** (ROL-XOR), not CRC-16.  The Amaranth
source is the sole authoritative description; see `hardware/` for details.

## Removed Prototype

A hand-written SystemVerilog prototype (`ctmm_*.sv`, 18 files) previously existed
in this directory.  It used an incompatible v1.0 format: 64-bit GTs and CRC-16
integrity.  It was dead code — never part of the active synthesis pipeline — and
has been removed to avoid confusion during audits.  It is preserved in git history
if needed for reference.

## Regenerating church_core.v

```bash
python gen_verilog.py --ti60
```

See `docs/cloomc-foundation.md` for the full architectural overview, and
`docs/HARDWARE.md` for Ti60 F225 board-specific synthesis steps.
