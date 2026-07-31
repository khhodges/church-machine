---
name: Wukong standalone boot — three cooperating bugs and their fixes
description: Three hardware bugs caused an infinite fault loop in pysim. All fixed; NUC program now runs clean to UART TX polling.
---

## Background

`WUKONG_NUC_PROGRAM[0] = LOAD CR3, CR6[5]` (LED_DEV) loads a capability from
the boot c-list via CR6.  Three cooperating bugs prevented this from succeeding.

---

## Bug 1 — u_perm fires NULL_CAP while mLoad is in-flight

**Location:** `hardware/core.py` line ~481

```python
# BUG:
u_perm.check_valid.eq(cond_exec_enable & is_church_op)

# FIX:
u_perm.check_valid.eq(cond_exec_enable & is_church_op & ~any_unit_busy)
```

**Root cause:** `retire_norm = u_decoder.instr_valid & ~any_unit_busy` fires for
NUC[0] at boot_complete (no unit busy yet). NIA advances to 4. ChurchLoad starts
for NUC[0]. Two cycles later mLoad is in CHECK_L and `cr_rd_addr` falls to 0
(CR0=NULL) via the mux. Meanwhile `u_perm.check_valid` was STILL asserted for
NUC[1] (decoded with `cond_exec_enable=True`, without `~any_unit_busy` gate).
u_perm reads CR0=NULL → NULL_CAP fault. This appeared as NIA=4 faulting in a
tight loop every ~9 cycles.

**Why:** perm check must only run at instruction-dispatch time (any_unit_busy=0),
not while a prior instruction's unit is still executing.

---

## Bug 2 — CR6 GT had S+E perm instead of L+E

**Location:** `hardware/core.py` `BootState.INIT_CLIST` line ~918

```python
# BUG (perm=0b110 = S+E, no L):
C(0x6A000002, 32),

# FIX (perm=0b101 = L+E):
C(0x5A000002, 32),
```

**v2.0 GT perm layout (Church domain, bits[30:28]):**
- bit 28 = perm[0] = L
- bit 29 = perm[1] = S
- bit 30 = perm[2] = E

`0x6A = 0b0110_1010` → perm bits[30:28] = 0b011 → perm[0]=L=1, perm[1]=S=1,
perm[2]=E=0 → S+L (NOT L+E).  Wait — recalculate:

`0x6A000002 = 0110 1010 ...`: bit30=1(E), bit29=1(S), bit28=0 → E+S, NO L.
`0x5A000002 = 0101 1010 ...`: bit30=1(E), bit29=0,    bit28=1 → E+L. ✓

mLoad `CHECK_L` computes `has_l_perm = dom & perm[0]` = 1 & 0 = 0 → PERM_L fault
even after Bug 1 fix.

**Why:** Comments in the code claimed 0x6A000002 was "L+E" but the bit layout
says otherwise. Always verify by computing `(value >> 28) & 0x7` and checking
bit 0 (L), bit 1 (S), bit 2 (E) against the Church perm layout.

---

## Bug 3 — Spurious BRAM dmem_rd_valid on NS gate state transitions

**Location:** `hardware/wukong_top.py` dmem_rd_valid logic (was ~line 409)

```python
# BUG (fires spurious valid when address changes):
_dmem_rd_valid_r = Signal()
m.d.sync += _dmem_rd_valid_r.eq(core.dmem_rd_en & ~is_mmio)
m.d.comb += core.dmem_rd_valid.eq(_dmem_rd_valid_r | is_mmio_read)

# FIX (suppress valid if address just changed):
_dmem_rd_valid_r = Signal()
_prev_mem_addr   = Signal(14)
m.d.sync += _dmem_rd_valid_r.eq(core.dmem_rd_en & ~is_mmio)
m.d.sync += _prev_mem_addr.eq(mem_addr)
m.d.comb += core.dmem_rd_valid.eq(
    (_dmem_rd_valid_r & (_prev_mem_addr == mem_addr)) | is_mmio_read
)
```

**Root cause:** The BRAM sync read port has 1-cycle latency. `_dmem_rd_valid_r`
is a registered copy of `dmem_rd_en`, so it fires on the first cycle of EVERY
state that follows another state with `rd_en=1`. In the NS gate:

  FETCH_LOC → FETCH_W1 → FETCH_W2 → FETCH_W3

Each state drives `rd_en=1` continuously. When FETCH_W1 starts, `_dmem_rd_valid_r=1`
(from FETCH_LOC's rd_en), but BRAM data is STILL from FETCH_LOC's address. NS gate
latches NS_W0 (location=0x40000000) into `raw_w2_reg` instead of NS_W1
(authority=0x00000004). integrity32(0x40000000, 0x40000000) ≠ stored seal → SEAL fault.

**Fix:** Only assert `dmem_rd_valid` when the BRAM address has been stable for
two consecutive cycles (i.e., `_prev_mem_addr == mem_addr`). This guarantees the
BRAM output corresponds to the requested address and suppresses the stale-data
spurious valid.

**Impact:** Each FETCH state in the NS gate now takes 2 cycles instead of 1 for
the data to arrive (still correct — the first cycle presents the new address,
the second cycle the data is valid). No change needed in ns_gate.py itself.

---

## Result

After all three fixes: NUC program executes 2M+ cycles with zero faults.
NIA 0x00..0x4C all retire OK; UART TX polling loop runs indefinitely.

Vivado synthesis succeeded (EXIT_0, 0 errors, bitstream ~3.8 MB).

---

## How to apply

- Any `core.py` perm change: re-examine u_perm.check_valid for ~any_unit_busy.
- Any `core.py` INIT_CLIST GT: verify `(gt >> 28) & 7` has bit0=1 for L-perm.
- Any `wukong_top.py` BRAM read path: the address-stability guard must stay;
  removing it re-introduces the SEAL fault in the NS gate.
- After any hardware change: run pysim first, then `python3 -m hardware.gen_rtlil`
  and synthesise on the droplet.
