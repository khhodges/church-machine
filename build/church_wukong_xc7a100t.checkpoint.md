# Wukong Build Checkpoint

Generated : 2026-08-27T17:32:59Z

---

## Bitstream

| Field            | Value |
|------------------|-------|
| Flashed version  | v18 |
| Source version   | v18 (hardware/wukong_top.py) |
| TU_VERSION       | 0x02 |
| Built at         | 2026-08-27T17:32:01Z |
| .bit size        | 3,826,002 bytes |
| .bit md5         | 07535ead784805d94f2a7c4af0398a46 |
| .bit integrity   | ✅ md5 verified |
| .mcs size        | 10,521,876 bytes |
| .mcs timestamp   | 2026-08-27T17:32:04Z |

> **Note:** "Flashed version" is what the board sentinel reports. "Source version" is
> what the next Vivado build will bake in. They differ when source has been updated
> but a new bitstream has not yet been synthesised.

---

## Boot Namespace  (8 slots)

NS_TABLE_BASE = 0x1FC00

| Slot | Name              | Location   | Perms | LUMP token   | Header word  | cw  | cc |
|------|-------------------|------------|-------|--------------|--------------|-----|----|
|  0   | Boot.NS (NS root) | 0x1FC00  | R+W   | —            | —            | —   | —  |
|  1   | Boot.Thread       | 0xe00      | R+W   | —            | (in ROM)     | —   | —  |
|  2   | UART_DEV          | 0x40000014  | R+W   | —            | MMIO         | —   | —  |
|  3   | LED_DEV           | 0x40000000  | R+W   | —            | MMIO         | —   | —  |
|  4   | BTN_DEV           | 0x40000028  | R     | —            | MMIO         | —   | —  |
|  5   | TIMER_DEV         | 0x4000002C  | R+W   | —            | MMIO         | —   | —  |
|  6   | SelfTest ⚡        | 0x0600      | E     | 00000600   | 0xF987CC02   | 499  | 2  |
|  7   | WukongCallHome    | 0x1200    | E     | e186c4ec      | 0xF9812803   | 74   | 3  |

⚡ = default boot entry point (IDE-configurable via setBootEntrySlot)

---

## Server LUMP Registry

Registered abstractions in server/lumps/manifest.json:

| NS slot | Token    | Abstraction           | cw  | cc | Ver |
|---------|----------|-----------------------|-----|----|-----|
|  6      | 00000600 | SelfTest              | 499 | 2  | 76 |
|  7      | 00000700 | WukongCallHome        | 73  | 2  | 6 |
|  7      | 1dcb7b09 | WukongCallHome.hw     | 73  | 2  | 1 |
|  7      | 46738c7a | WukongCallHome        | 74  | 3  | 7 |
|  7      | 8f7520e5 | WukongCallHome        | 74  | 3  | 7 |
|  7      | e186c4ec | WukongCallHome        | 3   | 2  | 1 |
| 10      | 00000a00 | CapabilityTest        | 23  | 5  | 2 |
| 10      | 9ce28c0b | CapabilityTest        | 21  | 5  | 7 |
| 10      | c7425d6c | CapabilityTest        | 23  | 5  | 1 |
| None      | 00000800 | Scheduler.IRQ         | 1   | 0  | 1 |
| None      | 00001000 | SlideRule             | 2602 | 1  | 2 |
| None      | 00001001 | SlideRule.Haskell     | 137 | 1  | 0 |
| None      | 00001200 | Constants             | 23  | 2  | 0 |
| None      | 00001f00 | Tunnel                | 37  | 1  | 0 |
| None      | 00002000 | Keystone              | 22  | 2  | 0 |
|  —      | 00003600 | Bank                  | 32  | 1  | 1 |
| None      | 00130000 | Loader                | 1   | 1  | 1 |
|  —      | 00aa1234 | Adder                 | 4   | 1  | 130 |
|  —      | 00aa9999 | Legacy                | 1   | 1  | 43 |
| None      | 04a720f8 | NoteG                 | 38  | 1  | 6 |
| None      | 0ca567b5 | ide.Mallory           | 5   | 2  | — |
|  —      | 0f8ad81b | MyAbstraction         | 2   | 1  | 5 |
|  —      | 13812cdf | Church Machine Post-F | 500 | 5  | 2 |
| None      | 19d3e599 | IntegerOps            | 20  | 0  | 5 |
| None      | 1eec355e | ide.Alice             | 9   | 2  | — |
|  —      | 4ea370af | Abstraction:  NoteGAs | 141 | 1  | 2 |
| None      | 501a76a0 | PostFlashSelftest     | 499 | 2  | 0 |
| None      | 50ce4c64 | StringOps             | 315 | 0  | 1 |
| None      | 55f1a32f | LEDFlash              | 1   | 1  | 3 |
|  —      | 56096905 | SelfTest              | 500 | 5  | 78 |
| None      | 5a93ce79 | BernoulliNumbers      | 15  | 1  | 2 |
| None      | 7c58f0f4 | Bank                  | 31  | 1  | — |
| None      | 97cc8047 | Human.Hand            | 7   | 1  | 13 |
| None      | ab1e86af | WordString            | 294 | 0  | 0 |
| None      | ab3de4fd | Salvation             | 141 | 0  | 1 |
| None      | b169bba4 | Ethernet              | 13  | 1  | 0 |
| None      | b3076308 | EventRouter           | 19  | 0  | 0 |
| None      | c3963aed | Memory                | 19  | 0  | 1 |
| None      | cb8739cf | GT.Encoding.v1.1.Hard | 26  | 8  | 1 |
| None      | d78f751b | MorseCmOk             | 363 | 1  | 4 |
| None      | d9454529 | EnglishLoops          | 35  | 0  | 1 |
|  —      | fe9c6e42 | NoteGAssembly         | 141 | 1  | 1 |

---

## Approval Checklist

Before flashing, verify:

- [ ] Bitstream md5 verified (✅ md5 verified)
- [ ] Flashed version matches expected (currently v18)
- [ ] SelfTest LUMP token matches boot ROM assertion  (00000600.lump header = 0xF987CC02  cw=499  cc=2)
- [ ] WukongCallHome LUMP present and header valid  (header = 0xF9812803  cw=74  cc=3)
- [ ] NS slot count = 8 (slots 0–7)
- [ ] TU_VERSION = 0x02 (bridge must match or warn)
- [ ] Source version v18 Verilog regenerated and transferred to droplet
- [ ] MCS regenerated from same .bit (not stale)

---
*Generated by scripts/gen_build_checkpoint.py*
