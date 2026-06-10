---
name: Sapphire SoC as Trusted Security Base
description: APB3 bridge register map, hidden firmware capabilities, keystore role, FAULT_RST gap, FP verdict, SHA32 commissioning impact
---

## Rule
The Sapphire SoC RISC-V core is the hardware TSB for CM_MSG. Its private RAM (0xF9004000–0xF9007FFF) is inaccessible to the CM core. K_enc/K_mac keys derived by HKDF must live here — never in CM-accessible BRAM.

**Why:** The APB3 bus only carries what the firmware explicitly writes through the bridge registers. The CM core has no read path to RISC-V RAM. This is the physical enforcement of the TSB boundary described in docs/cm-msg-protocol.md Section 1.

**How to apply:** When implementing T0.4 (key derivation), store the derived keys in a static array in RISC-V firmware RAM. Never copy them to the shared BRAM region. Pass only encrypted payloads through any shared memory.

## APB3 bridge register map
File: `hardware/soc_combined/apb3_cm_bridge.v` (203 lines)

| Offset | Name | Access | Notes |
|---|---|---|---|
| 0x00 | CTRL | R/W | bit[0] = CM push_button (0=pressed, 1=released) |
| 0x04 | STATUS | RO | bit[0]=boot_complete, bit[1]=fault_valid, bit[2]=fault_latched |
| 0x08 | NIA | RO | Live CM program counter |
| 0x0C | FAULT | RO | Fault code [4:0] |
| 0x10 | UID_LO | R/W | Lower 32 bits of device UID |
| 0x14 | UID_HI | R/W | Upper 32 bits of device UID |
| 0x18 | FAULT_GT | RO | GT word0 at fault (Track 4-C; reads 0 on older bitstreams) |
| 0x1C | FAULT_INSTR | RO | Instruction word at fault NIA |
| 0x20 | FAULT_CR14 | RO | Active abstraction slot at fault (reserved=0 currently) |
| 0x24 | FAULT_STAGE | RO | Pipeline stage [3:0] |

## Key gap: fault_latched is not software-clearable
`fault_latched` (STATUS bit[2]) is sticky until hardware reset. Only way to clear it is pulse CTRL=0 for ≥1s (full CM reboot). Adding a FAULT_RST register (write-1-to-clear, ~10 lines Verilog) completes hardware 3-tier recovery without a reboot.

## Five capabilities usable now (no FPGA changes)
1. **Hung-program watchdog** — poll NIA every 100ms; if unchanged for 3s, emit HUNG CALLHOME + pulse CTRL reset
2. **Full fault telemetry** — FAULT_GT/INSTR/CR14/STAGE are latched but uart_emit_callhome() never reads them; ~20 lines fix this
3. **NIA trace for free** — sample NIA at 10 Hz → emit TRACE JSON → feeds IDE Pipeline view (T2.3 at zero hardware cost)
4. **Remote CM reset** — bridge sends RESET\r\n → firmware writes CTRL=0 for 1s → CM reboots cleanly
5. **Keystore** — K_enc/K_mac stored in RISC-V RAM after HKDF; CM core cannot read them

## FP coprocessor verdict
Not needed for Ti60 starter kit. SHA-256 is integer-only. SlideRule trig is a CLOOMC abstraction on the CM core, not RISC-V firmware. Software CORDIC fits in ~500 bytes if firmware ever needs a float. Hardware FPU requires Sapphire SoC regeneration (rv32imf), full resynthesis, ABI change — unjustified.

## ROM budget (measured)
- ROM: 16 KB. Current firmware: ~1.6 KB (9% used).
- SHA32+HMAC+HKDF adds ~3 KB → total ~4.6 KB (28%). 72% free.
- Stack per sha32() call: ~400 bytes. RAM: 16 KB. Fine.

## SHA32 commissioning impact
Bitstream unchanged. Same make/flash/bridge commands. Boot adds ~100ms (9× SHA256). CALLHOME JSON grows ~700 chars (+120ms at 57600 baud). No new manual steps. Bridge cross-checks token_32 values on first CALLHOME — misconfigured firmware detected before any key derivation.
