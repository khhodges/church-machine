# C3 — Fix DEMO_NAMESPACE Containing Ti60-Specific Absolute Addresses

## Priority
**Critical** — On the Wukong, NS slot 0 (Boot.NS) stores `word0_location = 0x1FC00`
(the Ti60's NS_TABLE_BASE). The Wukong's NS lives at **byte 0** of DMEM. Any program
that accesses the Boot.NS lump directly will fetch from an address 128 KB beyond the
top of the Wukong's 64 KB DMEM.

## Root Cause
`hardware/boot_rom.py` builds `DEMO_NAMESPACE` using `NS_TABLE_BASE = 0x1FC00`
(defined in `hardware/hw_types.py`, line 105). Every call to `_make_ns_entry` for
slot 0 embeds this byte address as `word0_location` in the NS entry binary.

`hardware/wukong_top.py` then does:
```python
dmem_init = list(DEMO_NAMESPACE)   # words 0-31, byte-addresses baked in
```

On the Wukong, `CR15.word1_location = 0` (boot FSM). The NS table therefore lives at
DMEM byte 0. Slot 0's `word0_location = 0x1FC00` is wrong — it should be `0` (the
byte address of the NS table itself).

### Slots affected

| Slot | Name | Current word0_location | Correct for Wukong |
|------|------|------------------------|---------------------|
| 0 | Boot.NS | `0x1FC00` | `0x0000` |
| 1 | Boot.Thread | `0x0000` | `0x0000` ✓ |
| 2 | UART_DEV | `0x40000014` | `0x40000014` ✓ (MMIO) |
| 3 | LED_DEV | `0x40000000` | `0x40000000` ✓ (MMIO) |
| 4 | BTN_DEV | `0x40000028` | `0x40000028` ✓ (MMIO) |
| 5 | TIMER_DEV | `0x4000002C` | `0x4000002C` ✓ (MMIO) |
| 6 | SelfTest | `0x0600` | `0x0600` ✓ (lazy lump) |
| 7 | null | — | — |

Only slot 0 is wrong. MMIO addresses are target-independent. Slot 1 (Boot.Thread)
already uses `0x0000`, which is correct for Wukong.

## The Deeper Issue: `NS_TABLE_BASE` is Ti60-Specific
`hw_types.py` defines `NS_TABLE_BASE = 0x1FC00` as a module-level constant, and
`boot_rom.py` uses it when building `DEMO_NAMESPACE`. This constant is Ti60-specific
(the Ti60 places NS at the top of its DMEM; the Wukong places NS at byte 0).

The fix must not break the Ti60 path.

## Proposed Fix

### Option A — Per-target `ns_table_base` argument (preferred)
Add an `ns_table_base` parameter to `build_demo_namespace(ns_table_base)` in
`boot_rom.py`. The default value remains `NS_TABLE_BASE` (for Ti60 compatibility).
`wukong_top.py` calls it with `ns_table_base=0`.

```python
# boot_rom.py
def build_demo_namespace(ns_table_base=NS_TABLE_BASE):
    return _make_demo_namespace(ns_table_base)

# Existing DEMO_NAMESPACE (Ti60 default — unchanged)
DEMO_NAMESPACE = build_demo_namespace()

# wukong_top.py
from .boot_rom import build_demo_namespace, DEMO_CLIST, NUC_PROGRAM
WUKONG_DEMO_NAMESPACE = build_demo_namespace(ns_table_base=0)
...
dmem_init = list(WUKONG_DEMO_NAMESPACE)
```

### Option B — Dedicated Wukong constants in `boot_rom.py`
Add `WUKONG_NS_TABLE_BASE = 0` and `WUKONG_DEMO_NAMESPACE` to `boot_rom.py` and
export them. `wukong_top.py` imports `WUKONG_DEMO_NAMESPACE` instead of
`DEMO_NAMESPACE`.

Option A is preferred because it avoids duplicating the entire namespace-building
logic and makes the ti60 vs wukong split explicit at the call site.

## Files to Change

| File | Change |
|------|--------|
| `hardware/boot_rom.py` | Refactor `_make_demo_namespace` into a function accepting `ns_table_base`; keep `DEMO_NAMESPACE` as the Ti60 default |
| `hardware/wukong_top.py` | Import and use `WUKONG_DEMO_NAMESPACE` (ns_table_base=0); update `dmem_init` |
| `hardware/test_wukong_ns.py` | New: verify `WUKONG_DEMO_NAMESPACE[0:4]` contains `word0_location = 0` (not `0x1FC00`) |

## NS Entry Word Layout (for reference)

Each NS entry is 4 words (16 bytes):
```
word0: word0_location (byte address of lump in DMEM)
word1: GT word for the entry (gt_type, gt_seq, slot_id, perm, dom)
word2: WORD2_LAYOUT (limit_offset, g_bit, f_flag, integrity32 seal)
word3: abstract_gt (GT word for the abstract capability)
```

The fix must rebuild `word2` (the integrity seal) after changing `word0`. The
`_make_ns_entry` function already calls `integrity32()` on the entry; the refactored
function will produce the correct seal automatically once `location` is correct.

## Integrity Seal Impact
`integrity32` seals words 0–2 of each NS entry. Changing `word0_location` from
`0x1FC00` to `0x0000` for slot 0 will produce a **different seal in word2**. The
hardware NS gate will reject the old seal and produce `SEAL_FAULT` if the wrong
`DEMO_NAMESPACE` is used on Wukong. After the fix, the new seal must match what the
hardware produces when it reads DMEM.

The hw_init sequencer writes `WUKONG_DEMO_NAMESPACE` (via `dmem_init`) to DMEM before
boot, so the new seal will be written consistently — no mismatches.

## Acceptance Criteria
1. `WUKONG_DEMO_NAMESPACE[0]` (the `word0_location` of slot 0) equals `0`, not
   `0x1FC00`.
2. `build_demo_namespace(ns_table_base=NS_TABLE_BASE)` still produces the same bit-for-
   bit result as the current `DEMO_NAMESPACE` (Ti60 path unchanged).
3. Amaranth simulation with `WUKONG_DEMO_NAMESPACE` in DMEM: `LOAD CR15, CR15[0]`
   (from BOOT_PROGRAM) passes the NS gate integrity check without `SEAL_FAULT`.
4. `hardware/test_wukong_ns.py` passes.

## Risks
- **Seal recomputation**: if `_make_ns_entry` or `integrity32` has a bug, the new seal
  will be wrong and the NS gate will fault on every NS access. Validate with the
  existing `tests/lump/test_lump_consistency.py` pattern.
- **Ti60 regression**: the Ti60 build must continue to use the original `DEMO_NAMESPACE`
  constant without any change to its byte values. Add a regression test that the
  Ti60-default `DEMO_NAMESPACE[0]` equals `0x1FC00 / 4` (word-addressed).

## Depends On
Independent of C1 and C2. Can be developed and tested in simulation without hardware.
