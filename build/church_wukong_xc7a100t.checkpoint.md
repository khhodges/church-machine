# Wukong Build Checkpoint

Generated : 2026-09-07T13:21:14Z

---

## Bitstream

| Field            | Value |
|------------------|-------|
| Flashed version  | v18 |
| Source version   | v20 (hardware/wukong_top.py) |
| TU_VERSION       | 0x02 |
| Built at         | 2026-08-31T19:15:58Z |
| .bit size        | 3,826,002 bytes |
| .bit md5         | 0646949fc5d500b0486d5c3cabd51d2a |
| .bit integrity   | ❌ md5 MISMATCH — bitstream may be corrupt |
| .mcs size        | 10,521,876 bytes |
| .mcs timestamp   | 2026-08-31T19:28:01Z |

> **Note:** "Flashed version" is what the board sentinel reports. "Source version" is
> what the next Vivado build will bake in. They differ when source has been updated
> but a new bitstream has not yet been synthesised.

---

## Boot Namespace  (14 slots)

NS_TABLE_BASE = 0x00000000

| Slot | Name              | Runtime location | Alloc | Perms | LUMP token   | Header word  | cw  | cc |
|------|-------------------|------------------|-------|-------|--------------|--------------|-----|----|
|  0   | Boot.NS (NS root) | 0x00000000       | 64    | R+W   | —            | —            | —   | —  |
|  1   | Boot.Thread       | 0x00008600       | 256   | R+W   | —            | (in ROM)     | —   | 12 |
|  2   | UART_DEV          | 0x40000014       | 3     | R+W   | —            | MMIO         | —   | —  |
|  3   | LED_DEV           | 0x40000000       | 5     | R+W   | —            | MMIO         | —   | —  |
|  4   | BTN_DEV           | 0x40000028       | 1     | R     | —            | MMIO         | —   | —  |
|  5   | TIMER_DEV         | 0x4000002C       | 5     | R+W   | —            | MMIO         | —   | —  |
|  6   | SelfTest ⚡        | 0x00000600       | 8192  | E     | ee750c1b   | 0xFB87CC02   | 499  | 2  |
|  7   | WukongCallHome    | 0x00008C00       | 128   | E     | 85fcac64      | 0xF8812408   | 73   | 8  |
|  10  | CapabilityTest    | 0x00008E00       | 512   | E     | 00000a00      | 0xF9806006   | 24  | 6  |
|  13  | M_BIT_DEV         | 0xFFFFFF1C       | 1     | R+W   | —            | MMIO         | —   | —  |

⚡ = default boot entry point (IDE-configurable via setBootEntrySlot)

---

## Server LUMP Registry

Registered abstractions in server/lumps/manifest.json:

| NS slot | Token    | Abstraction           | cw  | cc | Ver |
|---------|----------|-----------------------|-----|----|-----|
|  6      | ee750c1b | SelfTest              | 499 | 2  | 79 |
|  —      | 00000600 | SelfTest              | ?   | ?  | 76 |
|  —      | 00000700 | WukongCallHome        | ?   | ?  | 6 |
|  —      | 00000800 | Scheduler.IRQ         | ?   | ?  | 1 |
|  —      | 00000a00 | CapabilityTest        | ?   | ?  | 17 |
|  —      | 00001000 | SlideRule             | ?   | ?  | 2 |
|  —      | 00001001 | SlideRule.Haskell     | ?   | ?  | 0 |
|  —      | 00001200 | Constants             | ?   | ?  | 0 |
|  —      | 00001f00 | Tunnel                | ?   | ?  | 0 |
|  —      | 00002000 | Keystone              | ?   | ?  | 0 |
|  —      | 00003600 | Bank                  | ?   | ?  | 1 |
|  —      | 00130000 | Loader                | ?   | ?  | 1 |
|  —      | 00aa1234 | Adder                 | ?   | ?  | 321 |
|  —      | 00aa9999 | Legacy                | ?   | ?  | 90 |
|  —      | 04a720f8 | NoteG                 | ?   | ?  | 6 |
|  —      | 072454a8 | ide.testMbit          | ?   | ?  | 1 |
|  —      | 0ca567b5 | ide.Mallory           | ?   | ?  | — |
|  —      | 0f8ad81b | MyAbstraction         | ?   | ?  | 5 |
|  —      | 13812cdf | Church Machine Post-F | ?   | ?  | 3 |
|  —      | 19d3e599 | IntegerOps            | ?   | ?  | 5 |
|  —      | 1dcb7b09 | WukongCallHome.hw     | ?   | ?  | 1 |
|  —      | 1eec355e | ide.Alice             | ?   | ?  | — |
|  —      | 46738c7a | WukongCallHome        | ?   | ?  | 7 |
|  —      | 4ea370af | Abstraction:  NoteGAs | ?   | ?  | 2 |
|  —      | 501a76a0 | PostFlashSelftest     | ?   | ?  | 0 |
|  —      | 50ce4c64 | StringOps             | ?   | ?  | 1 |
|  —      | 55f1a32f | LEDFlash              | ?   | ?  | 3 |
|  —      | 56096905 | SelfTest              | ?   | ?  | 78 |
|  —      | 5a93ce79 | BernoulliNumbers      | ?   | ?  | 2 |
|  —      | 7c58f0f4 | Bank                  | ?   | ?  | — |
|  —      | 85fcac64 | WukongCallHome        | ?   | ?  | 8 |
|  —      | 8f7520e5 | WukongCallHome        | ?   | ?  | 7 |
|  —      | 97cc8047 | Human.Hand            | ?   | ?  | 13 |
|  —      | 9ce28c0b | CapabilityTest        | ?   | ?  | 11 |
|  —      | ab1e86af | WordString            | ?   | ?  | 0 |
|  —      | ab3de4fd | Salvation             | ?   | ?  | 1 |
|  —      | b169bba4 | Ethernet              | ?   | ?  | 0 |
|  —      | b3076308 | EventRouter           | ?   | ?  | 0 |
|  —      | c3963aed | Memory                | ?   | ?  | 1 |
|  —      | c7425d6c | CapabilityTest        | ?   | ?  | 1 |
|  —      | c7657c2d | CapabilityTest        | ?   | ?  | 12 |
|  —      | cb8739cf | GT.Encoding.v1.1.Hard | ?   | ?  | 1 |
|  —      | d74af54b | CapabilityTest        | 21  | 5  | 14 |
|  —      | d78f751b | MorseCmOk             | ?   | ?  | 4 |
|  —      | d9454529 | EnglishLoops          | ?   | ?  | 1 |
|  —      | e186c4ec | WukongCallHome        | ?   | ?  | 1 |
|  —      | fe9c6e42 | NoteGAssembly         | ?   | ?  | 1 |

---

## Approval Checklist

Before flashing, verify:

- [ ] Bitstream md5 verified (❌ md5 MISMATCH — bitstream may be corrupt)
- [ ] Flashed version matches expected (currently v18)
- [ ] Active SelfTest canonical artifact is resolved from ns-state + manifest  (SelfTest.79.eceee227.lump; header = 0xFB87CC02  cw=499  cc=2)
- [ ] WukongCallHome LUMP present and header valid  (header = 0xF8812408  cw=73  cc=8)
- [ ] NS slot count = 14 (slots 0–13)
- [ ] TU_VERSION = 0x02 (bridge must match or warn)
- [ ] Source version v20 Verilog regenerated and transferred to droplet
- [ ] MCS regenerated from same .bit (not stale)

---
*Generated by scripts/gen_build_checkpoint.py*
