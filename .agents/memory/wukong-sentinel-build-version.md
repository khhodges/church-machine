---
name: Wukong sentinel build version
description: Sentinel extended to 4 bytes including BUILD_VERSION; 'f' command re-arms sentinel; version display in IDE
---

## Sentinel format (current)

```
0xBC  N_INIT&0xFF  TU_VERSION  BUILD_VERSION   (4 bytes)
```

- `SENTINEL_V2_LEN = 4` in `hardware/wukong_bridge.py`
- `parse_boot_sentinel()` returns `build_version` key (None for V1 sentinels)
- Old bridges (SENTINEL_V2_LEN=3) will consume the BUILD_VERSION byte as next-packet data — harmless since BUILD_VERSION values stay < 0xAA (trace magic) by convention

## BUILD_VERSION location

`hardware/wukong_top.py` module level:
```python
WUKONG_BUILD_VERSION = 1   # ← bump this before each new synthesis run
```

**Why:** gives the bridge/IDE a single definitive number to confirm exactly which bitstream is on the board, without reprogramming.

**How to apply:** increment `WUKONG_BUILD_VERSION` before every `python3 -m hardware.gen_rtlil` + droplet build cycle.

## 'f' command — force sentinel retransmit

- FPGA receives `0x66` ('f') over UART RX → clears `sentinel_sent` → `sentinel_req` goes high → all 4 sentinel bytes re-sent
- Bridge dispatches `ser.write(b'f')` for cmd == 'f'
- Server allows 'f' in command validation
- FPGA status page has "↺ Reboot" button (sends `{"cmd":"f"}`)

**Why:** eliminates the timing race of "restart bridge at exactly the right moment after JTAG programming". Just click the button and the board re-announces its identity.

## IDE version

- `BUILD_VERSION = _git_short_hash()` already exists in `server/app.py` line ~102
- Added to `/hardware/wukong/status` response as `ide_version`
- Displayed in FPGA status page as "IDE version" row

## FPGA status page version rows

- "Board build version" — from `boot_info.build_version`, shows `vN`
- "IDE version"        — from `s.ide_version` (git hash or repl ID)
