---
name: Wukong sentinel_phase reset on 'f' command
description: The 'f' (force sentinel) command must reset sentinel_phase to 0, not just sentinel_sent — otherwise the re-fired sentinel starts mid-sequence
---

## The bug

`hardware/wukong_top.py` Case 0x66 ('f') originally only cleared `sentinel_sent`:
```python
m.d.sync += sentinel_sent.eq(0)
```

`sentinel_phase` latches at 3 after the initial boot sentinel completes. When 'f' clears
only `sentinel_sent`, `sentinel_req` goes high with `sentinel_phase=3` — so only
`BUILD_VERSION` (e.g. `0x02`) is sent, not the full sequence starting with `0xBC`.
The bridge sees a single non-magic byte and ignores it. Result: bridge prints nothing,
user sees nothing.

## The fix

```python
m.d.sync += [sentinel_sent.eq(0), sentinel_phase.eq(0)]
```

Both must be reset together. This was the root cause of "nothing" from ↺ Reboot
after JTAG programming — the fix landed in BUILD_VERSION=2.

**Why:** sentinel_phase is a retained register that records which byte is next to send.
Resetting only sentinel_sent without resetting sentinel_phase leaves the FSM mid-stream.

**How to apply:** any time you add a new sentinel byte or change sentinel_phase logic,
verify the 'f' handler resets ALL sentinel state signals, not just sentinel_sent.
