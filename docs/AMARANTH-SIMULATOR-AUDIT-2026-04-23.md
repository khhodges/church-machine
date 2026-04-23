# Amaranth ↔ Simulator Audit
**Date**: April 23, 2026  
**Scope**: `simulator/simulator.js` (reference model) vs `hardware/` (Amaranth/Tang Nano 20K target) vs `ctmm_cap_amaranth/` (CAP research branch) vs `verilog/` (generated Verilog)

---

## Verilog Status — STALE

`verilog/church_core.v` and `verilog/church_tang_nano_20k.v` are both stale.  
Task #440 added `m_set_dr15` / `m_dr15` to `hardware/` but the Verilog files were not regenerated.

```
python3 -m hardware.gen_verilog verilog
```

Must be run to get current output. Until then, treat the two `.v` files in `verilog/` as unreliable for auditing purposes. The build-time copies in `build/` may be more recent (check `build/_last_board.txt`).

---

## GAP-01 — SWITCH Instruction: completely different semantics  
**Severity**: CRITICAL  
**Files**: `simulator/simulator.js` `_execSwitch` vs `hardware/switch.py`

### Simulator
Simple register swap: `CR[src] ↔ CR[imm & 0x7]`.  
Null-checks source GT, then swaps all four words of the two CR slots.

```javascript
const temp = { ...this.cr[d.crSrc] };
this.cr[d.crSrc] = { ...this.cr[target] };
this.cr[target] = temp;
```

### Hardware (`hardware/switch.py`)
Significantly more complex:
- Validates source GT is an **Abstract (PassKey) GT** (type=3).
- Validates that the PassKey slot ID resolves to a hardware-sentinel address range (`0xFFFFFF00`).
- Uses a `ChurchMLoad` sub-unit to "upgrade" the PassKey into a concrete capability in the **hidden `CR8–CR11` bank** (not the visible `CR0–CR7` range).

### Impact
The simulator SWITCH does not enforce the PassKey type requirement and writes into the visible CR bank, not the hidden one. Programs that rely on SWITCH for hardware PassKey authentication will behave differently in simulation vs silicon.

---

## GAP-02 — CLOAD Opcode: present in hardware, absent from simulator opcode table  
**Severity**: SIGNIFICANT  
**Files**: `simulator/simulator.js` line 2002 vs `hardware/cload.py` / `verilog/ctmm_cload.sv`

### Simulator
Opcode table at line 2002:
```javascript
['LOAD','SAVE','CALL','RETURN','CHANGE','SWITCH','TPERM','LAMBDA',
 'ELOADCALL','XLOADLAMBDA','DREAD','DWRITE','BFEXT','BFINS',
 'MCMP','IADD','ISUB','BRANCH','SHL','SHR']
```
**CLOAD is absent.** The simulator rebuilds CR14 (code cap) and CR6 (c-list cap) as internal state inside `_execCall` — it never exposes CLOAD as a user-visible instruction.

### Hardware (`hardware/cload.py`)
CLOAD is a discrete hardware instruction that:
1. Takes an Mint-issued E-GT (Word 0).
2. Validates it against the NS table via `ChurchNSGate` (3-word CRC integrity check).
3. Writes transient CR14 (X-only, M=1) and CR6 (c-list, E-only).
4. Accepts both **Inform (type=1)** and **Abstract (type=3)** GTs (fixed in GAP #4 of the March 2026 audit).

A `verilog/ctmm_cload.sv` SystemVerilog companion exists and matches this behavior.

### Impact
Assembler programs that emit CLOAD will fault or be rejected by the simulator. The simulator's internal CALL implementation implicitly does what CLOAD does but as a non-addressable side effect. If any abstraction layer ever uses CLOAD directly (e.g., from CLoOmC-compiled code), it will not run in simulation.

---

## GAP-03 — M-Window Writeback on RETURN: simulator drops it  
**Severity**: SIGNIFICANT  
**Files**: `simulator/simulator.js` `_clearMWindow` vs `hardware/ret.py` (Task #440)

### Simulator
`_clearMWindow(crIdx, writeBack = true)` is the mechanism.  
**RETURN calls it with `writeBack = false` at every exit path** (lines 3522–3720).  
This means: DR11–DR15 values accumulated during the call scope are **silently discarded** on RETURN.

```javascript
_clearMWindow(crIdx, writeBack = true) {
    const cr = this.cr[crIdx];
    if (writeBack) {
        cr.word0 = this.dr[11] >>> 0;  // 5-word shadow
        cr.word1 = this.dr[12] >>> 0;
        cr.word2 = this.dr[13] >>> 0;
        cr.word3 = this.dr[14] >>> 0;
        cr.word4 = this.dr[15] >>> 0;
    }
    cr.m = 0;  // always clear M
}
```

### Hardware (Task #440 — `hardware/ret.py`)
Task #440 added `m_set_dr15` and the 5-word M-window shadow. The hardware performs a **validated mLoad-style writeback** of DR11–DR15 back to the capability's NS entry before clearing the M-bit. This writeback is integrity-checked before the scope closes.

### Impact
The simulator is currently one step behind Task #440 on RETURN semantics. Writes to DR11–DR15 during a call scope persist in hardware (written back through the NS gate) but are dropped in the simulator. This gap exists in any call that intentionally mutates the M-window and relies on those mutations surviving the RETURN.

---

## GAP-04 — GC G-bit: hardware auto-clears in mLoad; simulator uses JS sweep  
**Severity**: MODERATE  
**Files**: `hardware/mload.py` `RESET_GBIT` state vs `simulator/simulator.js` `runGC()`

### Hardware
The `ChurchMLoad` FSM includes a `RESET_GBIT` state that runs on every successful load.  
It clears bit 28 of NS Word 1 (the G-bit / GC liveness marker) in the namespace table:
```python
gbit_cleared_w1 = Signal(32)
m.d.comb += gbit_cleared_w1.eq(ns_w1_saved & ~(1 << 28))
# writes this back to DMEM
```
This means any lump that is reachable (i.e., mLoad'd during execution) has its G-bit cleared automatically — deterministic mark-on-load.

### Simulator
`runGC()` is a high-level JS object sweep. It has no concept of the G-bit in NS memory words. It sweeps `this.nsTable` entries using JS references, not memory-backed bit manipulation.

### Impact
GC correctness is qualitatively equivalent (reachable = not collected), but the mechanism differs. Any test that inspects raw NS memory word 1 bit 28 after an mLoad will see different results in simulation vs hardware.

---

## GAP-05 — OUTFORM_TIMEOUT Fault: hardware only  
**Severity**: LOW  
**Files**: `hardware/hw_types.py` line 244 vs `simulator/simulator.js`

### Hardware
```python
OUTFORM_TIMEOUT = 0x19  # Outform download: server stopped sending bytes (watchdog expired)
```

### Simulator
Has `OUTFORM_CRC` (0x15) and `OUTFORM_ALLOC` (0x16) but no `OUTFORM_TIMEOUT`.  
The simulator resolves Outform fetches synchronously (JS fetch to Flask server) — timeout is impossible in simulation.

### Impact
Any error-handling code that catches fault 0x19 will never be triggered in simulation. Not a correctness issue for functional programs, but any fault-handler test specifically for timeout will be dead code in the simulator.

---

## GAP-06 — CHANGE M-flag Persistence: hardware saves to thread lump; simulator does not  
**Severity**: MODERATE  
**Files**: `hardware/change.py` vs `simulator/simulator.js` `_execChange`

### Hardware (`hardware/change.py`)
During a CHANGE (context switch), the hardware saves the **M-flag state** to the thread lump at a fixed word offset (`thread_base + 72`). On resume (next CHANGE into the same thread), the M-flag is restored from that offset.

### Simulator (`_execChange`)
The simulator snaps the current thread into `_threadContextMap` as a JS object that includes `CR0–CR11`, `CR14`, `CR15`, `DR0–DR15`, `STO`, `PC+1`, and `FLAGS`, but does **not** explicitly save `mElevation` or per-CR M-bits to the thread lump memory. M-elevation is cleared on every CALL/RETURN/CHANGE boundary regardless.

### Impact
If a thread was mid-M-elevation when CHANGE was called and is then resumed, the simulator will not restore that M state, whereas hardware would. In practice this shouldn't occur (M-elevation is boot-only), but the memory layout diverges.

---

## GAP-07 — Boot Sequence Abstraction  
**Severity**: LOW (intentional, documented)  
**Files**: `simulator/simulator.js` `_bootStep` vs `hardware/boot_rom.py` `BOOT_PROGRAM`

| | Simulator | Hardware |
|---|---|---|
| Style | Procedural JS (B:00–B:05 state machine) | 13 Church Machine instructions in ROM |
| Validation | Explicit JS type/perm checks | Hardware integrity32 CRC-16 at LAMBDA/CALL |
| Sentinel frame | Manually pushed (returnPC = 0x7FFF) | Epilogue ROM code catches final RETURN |
| NS slot order | Slot 0→CR15, Slot 1→CR12, bootEntrySlot→CR6 | Slot 0→CR15, Slot 1→CR8, Slot 4→CALL |
| Security enforcement | Permissive during mElevation=true | Cryptographic at every LAMBDA/CALL boundary |

This is intentional: the simulator is a high-level behavioral model; the hardware is a firmware-on-ROM bootstrap. Functional programs running post-boot are unaffected.

---

## GAP-08 — ctmm_cap_amaranth vs hardware/: divergent RETURN restore scope  
**Severity**: MODERATE (internal between the two Amaranth targets)  
**Files**: `ctmm_cap_amaranth/ret.py` vs `hardware/ret.py`

| | hardware/ret.py | ctmm_cap_amaranth/ret.py |
|---|---|---|
| Registers restored via mLoad | CR5 (Heap) only | CR5 + CR6 + CR7 (Triple-restore) |
| GT seq revocation check | CR5 only | CR5, CR6, CR7 all checked |
| E-perm check on saved CR6 | Not performed | Yes (`saved_cr6_has_e`) |
| Stack frame model | 2-word (Frame word + E-GT) | `return_cap` view descriptor |

The CAP branch is significantly more rigorous (matches a full trust re-establishment on every RETURN). The main hardware branch only re-validates the heap cap.

---

## GAP-09 — NS Word Fetch Count: 3 words (hardware) vs 4 words (ctmm_cap_amaranth)  
**Severity**: LOW (internal divergence)  
**Files**: `hardware/call.py` M_FETCH states vs `ctmm_cap_amaranth/call.py`

- `hardware/call.py`: reads 3 words (NS0–NS2: location, authority, integrity) for Abstract GT M-gate dispatch.
- `ctmm_cap_amaranth/call.py`: reads all 4 words, including `ns_seal_lat` (Word 3 advisory seals).

The 4-word variant is strictly more complete. The 3-word variant skips advisory seal loading into the M-window, meaning DR14 (M-window word 3) may differ between targets.

---

## GAP-10 — Lump Size Minimum: 8 words (simulation) vs 64 words (hardware spec)  
**Severity**: MODERATE (already documented in HARDWARE-DEVIATIONS.md)

`hardware/boot_rom.py` DEMO_NAMESPACE allocates 8-word lumps.  
Hardware field encoding `n_minus_6 = log₂(size/4) − 6` requires `size ≥ 2^6 × 4 = 256 bytes = 64 words`.  
8-word lumps produce `n_minus_6 = -3`, which is out of range.

Status: **open, documented, no fix decided**. See HARDWARE-DEVIATIONS.md.

---

## What IS Aligned ✅

These areas are confirmed consistent between simulator and hardware:

| Area | Status |
|---|---|
| GT type encoding (NULL=0, Inform=1, Outform=2, Abstract=3) | ✅ Aligned (fixed March 2026) |
| CALL type validation: Inform or Abstract only | ✅ Aligned (fixed March 2026) |
| CLOAD Abstract GT acceptance (type=1 or type=3) | ✅ Aligned (fixed April 2026) |
| TPERM preset masks + X⊕LSE domain-purity check | ✅ Aligned |
| IADD, ISUB, SHL, SHR, BFEXT, BFINS, MCMP, BRANCH | ✅ Aligned |
| Stack frame format (Frame word + E-GT, 2-word CALL / 1-word LAMBDA) | ✅ Aligned |
| mLoad Phase 1+2 for CALL (NS gate, version, seal, perm checks) | ✅ Aligned |
| Abstract GT bypass in CALL (type=3 skips mLoad Phase 1+2) | ✅ Aligned |
| DREAD/DWRITE CR range + privilege fence (CR12–CR15) | ✅ Aligned |
| ELOADCALL / XLOADLAMBDA absent-lump intercept semantics | ✅ Aligned |
| M-window population on CALL (DR11–DR15 from NS words 0–4) | ✅ Aligned |
| LAMBDA 1-word fast-path stack frame | ✅ Aligned |
| GC reachability (mark-sweep on NS table entries) | ✅ Qualitatively aligned |
| OUTFORM CRC-32 algorithm (CRC-32/ISO-HDLC) | ✅ Aligned |
| Null-mask application on CALL (imm clears non-preserved CRs) | ✅ Aligned |
| B-flag clear on preserved CRs at CALL boundary | ✅ Aligned |

---

## Priority Action Items

| # | Gap | Action | Priority |
|---|---|---|---|
| 1 | Stale Verilog (missing m_set_dr15) | `python3 -m hardware.gen_verilog verilog` | **NOW** |
| 2 | RETURN M-window writeback: simulator drops it | Implement `writeBack=true` path in simulator RETURN, matching hardware Task #440 validated writeback | **HIGH** |
| 3 | SWITCH semantics: simple swap vs PassKey+mLoad upgrade | Decide: is simulator SWITCH intentionally simplified? Document or fix | **HIGH** |
| 4 | GC G-bit: hardware auto-clears in mLoad | Add G-bit clear to simulator `_mLoad` on successful load | **MEDIUM** |
| 5 | CLOAD missing from simulator opcode table | Add CLOAD opcode to simulator (or explicitly document as "handled implicitly by CALL") | **MEDIUM** |
| 6 | CHANGE M-flag save to thread lump | Add per-thread M-state save to `_threadContextMap` + lump memory | **LOW** |
| 7 | ctmm_cap_amaranth RETURN triple-restore | Decide if main hardware/ret.py should also triple-restore | **LOW** |
| 8 | OUTFORM_TIMEOUT fault code | Add to simulator as unreachable (stub fault for completeness) | **LOW** |
| 9 | Lump size minimum (8 vs 64 words) | Choose Option A (strict) or Option B (relax spec) | **OPEN** |
