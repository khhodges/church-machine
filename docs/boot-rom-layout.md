# Boot ROM Layout

**v1.1 — 2026-07-23**
**CONFIDENTIAL**

The Boot ROM and RAM are defined by the FPGA bitstream used to flash the FPGA. It is defined by the IDE under program control, size is defined in words (4 bytes each). The ROM is read-only instruction memory, carried from the IDE to the FPGA in `hardware/boot_rom.py` and instantiated as the `BootRom` class with the following three CLOOMC boot instructions: LOAD CR15, CHANGE that suspends the current thread and starts Boot.Thread, and CALL CR0, the programmer-selected lightning bolt slot in the IDE-defined namespace as Lazy Load.

The address bus is 10 bits wide (`addr[9:0]`), data bus is 32 bits (`data[31:0]`), and read latency is one clock cycle (registered output). Xilinx BRAM on 7-series has ECC built in — the block RAM primitives support single-error-correct, double-error-detect natively, and Yosys/nextpnr can infer and instantiate directly. That covers stored words.

The CR registers are the harder part, since they are LUT-based. Options in ascending cost: parity on each 32-bit GT word (one bit, detects single flips, cheap).

---

## IMEM Map

```
 Word Index      Byte Address     Region
─────────────────────────────────────────────────────────
 [  0 : 255 ]    0x000 – 0x3FC    3 Instruction BOOT_PROGRAM  (256 words, remainder zero-padded)
─────────────────────────────────────────────────────────
```

---

## 1. ROM BOOT_PROGRAM  `[0:255]`

Secure-boot firmware.  Three real instructions, remainder zero-padded to 256.

| Word | Instruction              | Comment                                                   |
|------|--------------------------|-----------------------------------------------------------|
| 0    | `LOAD CR15, Slot 0`      | Load Namespace from Slot 0 into CR15                      |
| 1    | `CHANGE CR12, CR15, #1`  | Start Boot.Thread at NS Slot 1 — thread save skipped at boot and on fault to prevent error loops |
| 2    | `CALL CR0`               | Enter IDE-selected first abstraction (lightning bolt); CR5 and CR14 inserted by IDE |

---

## 2. RAM `[256: LUMP size-1024 the NS table]`

The programmer takes control at this point; the hardwired Boot ends and software takes control.

## Namespace Header V2 boot-image contract

The Namespace allocation begins with a physical 16-word Header V2 block; it is
not synthesized display metadata and it is not a Thread header. Namespace
Header V2 Word 0 has
`magic=0x1F`, `typ=01` (Namespace/data), the Namespace n−13 size field, plain
13-bit `cw=slot_count` (0..8,191), and `cc=0`. The count describes fixed
four-word NS entries; `cc` is not part of the count. Word 1 is `0x4E534832` (`NSH2`); words 2,
3, and 4 respectively hold the allocation base byte address, table offset in
words, and boot-entry byte location. Word 3 is exactly
`capacity_words − 4×slot_count`; word 5 is the fixed future-seal boundary (6);
words 6..15 are zero until a separately versioned seal design is implemented.

The four-word NS table is physically tail-anchored. A loader rejects a
missing/unknown marker as legacy/unsupported rather
than treating raw table or Thread-at-zero layouts as V2. Cryptographic sealing
and composite-digest verification are deferred, but their reserved boundary is
already part of the binary contract.

---

## See Also

- [cloomc-foundation.md](cloomc-foundation.md) — **Authoritative architectural overview**: explains the heritage of this layout, the TSB principle, the old 6-region layout's problems, and the 3-LUMP model that supersedes it.
- [CM_LUMP_SPECIFICATION.md](CM_LUMP_SPECIFICATION.md) — Lump object structure, Header Word encoding, and zone layout

---
*Confidential — Kenneth Hamer-Hodges — July 2026*
