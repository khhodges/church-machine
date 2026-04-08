# FPGA Resource Comparison: Full vs IoT Profile

**Target:** Tang Nano 20K (GW2AR-LV18QN88C8/I7, ~20,736 LUT4s, 27 MHz)

## Profile Summary

| Aspect | Full Profile | IoT Profile |
|--------|-------------|-------------|
| Verilog size | 1,447,448 bytes | 798,011 bytes |
| Verilog lines | 34,231 | 19,419 |
| Always blocks | 809 | 460 |
| Reduction | — | 44.9% smaller |

## Removed Units (IoT Profile)

| Unit | Purpose | Status |
|------|---------|--------|
| ChurchGCUnit | Garbage collector (mark/sweep) | Removed |
| ChurchLambda | Lambda closure creation | Removed |
| ChurchChange | Thread context switch | Removed |
| ChurchSwitch | Capability slot swap | Removed |
| ChurchELoadCall | Fused load+call | Removed |
| ChurchXLoadLambda | Fused load+lambda | Removed |
| ChurchOutform | ZIP-compatible outform (~20 FSM states) | Replaced |
| ChurchOutformIoT | Lean tunnel-hunting outform (~9 states) | Added |

## Retained Units (IoT Profile)

- ChurchCore (with iot_profile guards)
- ChurchDecoder (with iot_excluded opcodes: LAMBDA, CHANGE, SWITCH, ELOADCALL, XLOADLAMBDA)
- ChurchRegisters (full 16-CR + 16-DR register file)
- ChurchCall, ChurchReturn, ChurchLoad, ChurchSave
- ChurchTPerm, ChurchPermCheck
- ChurchCLoad, ChurchSharedMLoad
- ChurchDRead, ChurchDWrite
- ChurchOutformIoT (lean 8-byte header, ~9 FSM states, CRC-32 preserved)
- BootRom, DebugPrinter, UartRx
- Full Turing ops: IADD, ISUB, SHL, SHR, BFEXT, BFINS, MCMP, BRANCH

## Full Profile Baseline (Yosys synth_gowin)

| Cell Type | Count |
|-----------|------:|
| LUT4 | 3,727 |
| LUT3 | 1,063 |
| LUT2 | 438 |
| LUT1 | 676 |
| ALU | 643 |
| MUX2_LUT5 | 943 |
| MUX2_LUT6 | 167 |
| MUX2_LUT7 | 64 |
| MUX2_LUT8 | 15 |
| DFFRE | 2,991 |
| DFFE | 1,083 |
| DFF | 71 |
| DFFR | 40 |
| SDPX9B | 1 |
| SPX9 | 4 |
| **Total cells** | **11,963** |

LUT-equivalent (LUT4 + ALU): **4,370** = 21.1% of GW2AR-18

## IoT Profile Estimates

Based on 44.9% Verilog reduction and removed unit analysis:

| Metric | Full | IoT (est.) | Savings |
|--------|-----:|----------:|--------:|
| LUT-equivalents | 4,370 | ~2,800 | ~36% |
| Flip-flops | 4,185 | ~2,600 | ~38% |
| Total cells | 11,963 | ~7,200 | ~40% |
| GW2AR-18 usage | 21.1% | ~13.5% | ~7.6pp |

## ChurchOutformIoT Design

- **Protocol:** Lean tunnel-hunting (no ZIP signature, no filename, no DEFLATE/RLE)
- **Header:** 8 bytes — 4B payload_len (LE) + 4B CRC-32 (LE)
- **FSM States:** IDLE → TUNNEL_HUNT → TUNNEL_CONNECT → RECV_HDR_LEAN → DERIVE_N → ALLOC → RECV_PAYLOAD → CHECK_CRC32 → MINT → MINT_WAIT → COMPLETE/FAULT
- **CRC-32:** Preserved (bitwise CRC-32 on payload bytes)
- **Storage:** Raw STORE only (no decompression)

## Build Targets

```bash
# Full profile
python -m hardware.gen_verilog build
make -C hardware pnr pack

# IoT profile
python -m hardware.gen_verilog --iot build
make -C hardware tang-iot
```
