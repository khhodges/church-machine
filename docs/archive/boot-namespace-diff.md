# IDE Boot Namespace vs Amaranth Hardware Boot Namespace

> **ARCHIVED / NON-AUTHORITATIVE.** Historical snapshot only. It may describe
> retired targets, stale layouts, or unshipped plans. Use current source,
> tests, `docs/HARDWARE.md`, and non-archive documentation for current behavior.

Historical diff produced 2026-06-30 by direct inspection of
`boot_rom.py → DEMO_NAMESPACE` (hardware) and `server/lumps/boot-image.bin`
(IDE simulator binary, patched to 23 slots same date).

Hardware source: `hardware/boot_rom.py` — `DEMO_NAMESPACE`, `NS_SLOT_COUNT = 23`
IDE binary source: `server/lumps/boot-image.bin` — NS table at word 12288

---

## Full Slot Table

| Slot | Name | HW non-null? | HW physAddr | IDE non-null? | IDE physAddr | Label match? | Notes |
|-----:|------|:---:|-------------|:---:|-------------|:---:|-------|
| 0 | Boot.NS | ✓ | `0x0000FD00` | ✓ | `0x00000000` | ✓ | physAddr differs (layouts differ — expected) |
| 1 | Boot.Thread | ✓ | `0x00000100` | ✓ | `0x00000040` | ✓ | physAddr differs |
| 2 | (freed) | — | — | — | — | ✓ | Both null |
| 3 | Boot.Abstr | — | null | ✓ | `0x00000140` | ⚠ | **Structural difference** — HW creates dynamically at boot; IDE pre-loads LED-flash demo |
| 4 | Salvation | ✓ | `0x000003FC` | ✓ | `0x00000180` | ✓ | physAddr differs |
| 5 | Navana | ✓ | `0x00000500` | ✓ | `0x000001C0` | ✓ | physAddr differs |
| 6 | Mint | ✓ | `0x00000600` | ✓ | `0x00000200` | ✓ | physAddr differs |
| 7 | Memory | ✓ | `0x00000700` | ✓ | `0x00000240` | ✓ | physAddr differs |
| 8 | Scheduler | ✓ | `0x00000800` | ✓ | `0x00000280` | ✓ | physAddr differs |
| 9 | Stack | ✓ | `0x00000900` | ✓ | `0x000002C0` | ✓ | physAddr differs |
| 10 | DijkstraFlag | ✓ | `0x00000A00` | ✓ | `0x00000300` | ✓ | physAddr differs |
| 11 | UART_DEV | ✓ | `0x40000014` | ✓ | `0x40000014` | ✓ | **Exact match** — MMIO address identical |
| 12 | LED_DEV | ✓ | `0x40000000` | ✓ | `0x40000000` | ✓ | **Exact match** — MMIO address identical |
| 13 | BTN_DEV | ✓ | `0x40000028` | ✓ | `0x40000028` | ✓ | **Exact match** — MMIO address identical |
| 14 | TIMER_DEV | ✓ | `0x4000002C` | ✓ | `0x4000002C` | ✓ | **Exact match** — MMIO address identical |
| 15 | Display | ✓ | `0x00000F00` | ✓ | `0x00000340` | ✓ | physAddr differs |
| 16 | SlideRule | ✓ | `0x000007FC` | ✓ | `0x00000380` | ✓ | physAddr differs |
| 17 | (unnamed) | ✓ | `0x00001100` | ✓ | `0x000003C0` | ✗ | **Label bug** — IDE catalog calls this "Abacus"; HW boot ROM has no name for slot 17, it is a generic INFORM RW placeholder |
| 18 | Constants | ✓ | `0x00001200` | ✓ | `0x00000400` | ✓ | physAddr differs |
| 19 | CR12 Port | ✓ | `0xFFFFFF0C` | ✓ | `0x00000440` | ✗ | **Content mismatch** — HW: S-perm port authority; IDE binary: math LUMP (Loader). Labels overridden in simulator.js `_HW_BOOT_LABELS` to show correct name. |
| 20 | CR13 Port | ✓ | `0xFFFFFF0D` | ✓ | `0x00000480` | ✗ | **Content mismatch** — HW: S-perm port authority; IDE binary: math LUMP (SUCC). Label overridden. |
| 21 | CR12 M-bit | ✓ | `0xFFFFFF1C` | ✓ | `0x000004C0` | ✗ | **Content mismatch** — HW: S-perm port authority; IDE binary: math LUMP (PRED). Label overridden. |
| 22 | CR13 M-bit | ✓ | `0xFFFFFF1D` | ✓ | `0x00000500` | ✗ | **Content mismatch** — HW: S-perm port authority; IDE binary: math LUMP (ADD). Label overridden. |

---

## Summary

| Category | Count | Verdict |
|----------|------:|---------|
| Total slots | 23 | ✓ both agree |
| Both null | 1 (slot 2) | ✓ |
| Both non-null, label ✓ | 17 slots | ✓ |
| physAddr differs (all non-null slots) | 21 slots | **Expected** — IDE uses compact lump packing; HW uses fixed hardware addresses |
| Slot 3 null vs non-null | 1 | Intentional design difference |
| Slot 17 label mismatch ("Abacus" vs unnamed) | 1 | **Genuine bug** |
| Slots 19–22 GT content mismatch | 4 | Labels overridden; underlying data wrong |

---

## Detailed Difference Notes

### physAddr differences (all slots) — expected, not a bug

The hardware boot ROM places lumps at fixed addresses defined in `boot_rom.py`
(`0x0100`, `0x0200`, …, `0xFD00` for Boot.NS). The IDE binary uses compacted
lump packing starting from `0x0040`. The two layouts are internally consistent
but numerically different. This is normal.

### Slot 3 — structural design difference

Hardware: `DEMO_NAMESPACE` loop treats slots 2 and 3 as `GT_TYPE_NULL`
(freed/empty). The Sapphire SoC firmware dynamically creates Boot.Abstr at
slot 3 during the boot sequence.

IDE binary: slot 3 is pre-populated with the LED-flash demo LUMP
(`loc=0x00000140`) so the simulator can jump straight to user code without
replaying the hardware boot sequence.

### Slot 17 — label bug

`boot_rom.py` has no `elif _i == 17` case. Slot 17 falls into the generic
`else` branch:

```python
_entry = _make_ns_entry(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W, 17, 0,
                        17 * 0x100, 64, ...)
```

This is a nameless INFORM RW placeholder — the hardware boot ROM reserves the
slot but assigns no abstraction to it.

The IDE simulator catalog (`simulator.js _getAbstractionCatalog()`, index 17)
calls it **"Abacus"**. Abacus does not appear in the hardware boot namespace.
Either:
- `boot_rom.py` should be updated to name slot 17 `Abacus`, or
- The IDE catalog should leave slot 17 null/unnamed to match hardware.

### Slots 19–22 — GT content mismatch

Hardware assigns S-perm port authority objects at slots 19–22:

| Slot | HW physAddr | Purpose |
|-----:|-------------|---------|
| 19 | `0xFFFFFF0C` | CHANGE CR12 authority |
| 20 | `0xFFFFFF0D` | CHANGE CR13 authority |
| 21 | `0xFFFFFF1C` | SET M-BIT CR12 authority |
| 22 | `0xFFFFFF1D` | SET M-BIT CR13 authority |

The IDE binary has math-abstraction LUMPs (Loader, SUCC, PRED, ADD) at these
slots. The display labels are corrected by the `_HW_BOOT_LABELS` override in
`simulator.js loadBootImage()`, but the underlying GT words point to the wrong
locations. The simulator cannot exercise CR12/CR13 port authority through
slots 19–22 the way hardware does.

---

## Files involved

| File | Role |
|------|------|
| `hardware/boot_rom.py` | Authoritative hardware boot namespace — `DEMO_NAMESPACE`, `NS_SLOT_COUNT` |
| `server/lumps/boot-image.bin` | IDE simulator binary — NS table patched 2026-06-30 to 23 slots |
| `simulator/simulator.js` | `_getAbstractionCatalog()` — IDE label catalog; `loadBootImage()` + `_HW_BOOT_LABELS` override |
| `server/boot_image.py` | `generate_boot_image()` — builds IDE binary from boot config |
