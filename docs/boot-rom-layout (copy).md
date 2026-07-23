# Boot ROM Layout

**v1.1 — 2026-07-23**
**CONFIDENTIAL**

The Boot ROM and RAM are defined by the FPGA bitstream used to flash the FPGA. It is defined by the IDE under program control, size is defined in word. (4 Bytes). The ROM is read-only instruction memory, carried from the IDE to the FPGS in `hardware/boot_rom.py` and instantiated as the `BootRom` class with the following three CLOOMC boot instructions, LOAD CR15, Second Half of CHANGE that loads and Starts the Thread, and CALL CR0, the programmer selected lightning bolt slot in the IDE defined namespace as Lazy Load. 
The address bus is 10 bits wide (`addr[9:0]`), data bus is 32 bits (`data[31:0]`), and read latency is one clock cycle (registered output) and Xilinx BRAM on 7-series has ECC built in — the block RAM primitives support single-error-correct, double-error-detect natively, and Yosys/nextpnr can infer to instantiate directly. That covers stored words.

The CR registers are the harder part, since they're LUT-based. Options in ascending cost: parity on each 32-bit GT word (one bit, detects single flips, cheap).

---

## IMEM Map

```
 Word Index      Byte Address     Region
─────────────────────────────────────────────────────────
 [  0 : 255 ]    0x000 – 0x3FC    3 Instruction BOOT_PROGRAM  (256 words)(unused reserved, zero-filled)
 REMOVE [256 : 511 ]    0x400 – 0x7FC    NUC_PROGRAM   (256 words)
 REMOVE [512 : 680 ]    0x800 – 0xAA4    SLIDERULE_CODE (169 words)
 REMOVE [681 : 1023]    0xAA8 – 0xFFC    
─────────────────────────────────────────────────────────
```

---

## 1. ROM BOOT_PROGRAM  `[0:255]`

Secure-boot firmware.  Three real instructions, remainder zero-padded to 256.

| Word | Instruction            | Comment                                             |
|------|------------------------|-----------------------------------------------------|
| 0 | `LOAD CR15, Slot 0        | Load Namespace from top of memory Slot 0            |
| 1 | `START CR12, CR15 Slot 1  | Secong half of CHANGE                               |
| 2 | `CALL CR0                 | Create Lazy Load CR6, (CR5 and CR14 inserted by IDE |

---

## 2. RAM `[256: LUMP size-1024 the NS table]`

The programmer takes control at this point the hardwired Boot ends and software takes control

---

## See Also

- [cloomc-foundation.md](cloomc-foundation.md) — **Authoritative architectural overview**: explains the heritage of this layout, the TSB principle, the old 6-region layout's problems, and the 3-LUMP model that supersedes it.
- [Lump-Architecture.md](Lump-Architecture.md) — Lump object structure, Header Word encoding, and zone layout
---
*Confidential — Kenneth Hamer-Hodges — April 2026*
