# Simulator ↔ Hardware Gaps Report

> **HISTORICAL DOCUMENT — SUPERSEDED**
> This report reflects the gap state as of March 2026. The majority of gaps listed have since been
> closed via tasks #873, #887, #888, #890, and associated hardware deviations. The remaining open
> SWITCH's current authority contract is the destination-M-gated special LOAD
> described in `isa_reference.md`; the PassKey material below is retained only
> as historical context and is not normative.
> Do not use this document as a live gap reference — consult `HARDWARE-DEVIATIONS.md`.

**v1.0 — 2026-04-29**
**CONFIDENTIAL**

**Date**: March 29, 2026 (updated March 30, 2026)  
**Status**: ALL CRITICAL GAPS FIXED

---

## GAP #1: CALL Type Validation — ✅ FIXED

### Problem (historical)
Simulator previously allowed types 1 (Inform) and 2 (Outform), rejecting type 3 (Abstract).
The fault message said "must be Inform or Abstract" but the code was wrong.

### Correct Logic (now implemented)
```
Allows: type 1 (Inform) OR type 3 (Abstract)
Rejects: type 0 (NULL), type 2 (Outform)
```

### Fix Applied
```javascript
// simulator.js — CALL type check (line 1089):
if (srcParsed.type !== 1 && srcParsed.type !== 3) {
    this.fault('TYPE', `CALL: CR${d.crDst} GT type is ${srcParsed.typeName}, must be Inform or Abstract`);
}
```

---

## GAP #2: Wrong Type Check in XLOADLAMBDA Path — ✅ FIXED

### Problem (historical)
Simulator previously checked `cr7Parsed.type === 1 || cr7Parsed.type === 2` for XLOADLAMBDA code chaining.
Type 2 is Outform — only Inform (type 1) is valid for code loading.

### Fix Applied
```javascript
// simulator.js — XLOADLAMBDA code GT check:
if (cr7Parsed.type === 1) {  // Inform only
    // Load code GT from c-list
}
```

---

## GAP #3: Type Comments Outdated — ✅ FIXED

### Problem (historical)
Type comments used old names. Canonical GT type encoding:
```javascript
// GT type semantics: 0=NULL, 1=Inform (concrete lump), 2=Outform (remote), 3=Abstract (PassKey/value)
// Abstract (type=3) GTs are only created by Navana.Abstraction.Add and Navana.MintPassKey.
```

**Status**: All type comments in simulator.js updated (lines 231, 234, 281).

---

## GAP #4: Hardware CLOAD Rejects Abstract GTs — ✅ FIXED (April 8, 2026)

### Problem (historical)
**hardware/cload.py line 170** only accepted Inform (type 1):
```python
with m.If(e_gt_view.gt_type != GT_TYPE_INFORM):
    m.d.sync += fault_type_reg.eq(FaultType.PERM_E)  # FAULT
```
This meant any CALL targeting a PassKey or Navana-minted Abstract GT (type 3)
would fault on real hardware but succeed in the simulator.

### Correct Logic (now implemented)
```
Allows: type 1 (Inform) OR type 3 (Abstract)
Rejects: type 0 (NULL), type 2 (Outform)
```
Matches simulator.js lines 1616-1619:
```javascript
if (srcParsed.type !== 1 && srcParsed.type !== 3) { fault }
```

### Fix Applied
```python
# hardware/cload.py — CHECK_TYPE state:
is_valid_type = (
    (e_gt_view.gt_type == GT_TYPE_INFORM) |
    (e_gt_view.gt_type == GT_TYPE_ABSTRACT)
)
with m.If(~is_valid_type):
    m.d.sync += fault_type_reg.eq(FaultType.PERM_E)
    m.next = "FAULT"
```

SystemVerilog equivalent created in `verilog/ctmm_cload.sv` with matching
type acceptance matrix.

---

## Summary of Fixes (All Applied)

| Issue | File | Line | Severity | Status |
|-------|------|------|----------|--------|
| CALL allows type 2 instead of type 3 | simulator.js | 1089 | 🔴 CRITICAL | ✅ FIXED |
| XLOADLAMBDA allows type 2 | simulator.js | 1580 | 🟠 HIGH | ✅ FIXED |
| Type comments say 2=Abstract | simulator.js | 231,234,281 | 🟡 MEDIUM | ✅ FIXED |
| TPERM presets 10-12 wrong (W vs LE/SE/LSE) | simulator.js, assembler.js | — | 🔴 CRITICAL | ✅ FIXED |
| TPERM presets 11-14 wrongly null | simulator.js, assembler.js | — | 🟠 HIGH | ✅ FIXED |
| GT type naming (Inform/Outform/Abstract) not consistently applied | all JS + docs | many | 🟡 MEDIUM | ✅ FIXED |
| isa_encoding.md preset table wrong (W at 0x0A) | docs/isa_encoding.md | — | 🟡 MEDIUM | ✅ FIXED |
| CLOAD rejects Abstract GTs (type 3) for CALL targets | cload.py, ctmm_cload.sv | 170 | 🔴 CRITICAL | ✅ FIXED |

---

## Impact Assessment

**Broken Features** (all now fixed):
- ✅ CALL with Abstract GTs (PassKeys) — was FAULTing with TYPE error, now accepts type 3
- Historical PassKey-era SWITCH behavior (superseded by destination-M gating)
- ✅ Navana.ValidatePassKey — now executes without TYPE fault

**Risk Level**: ✅ **ALL CRITICAL GAPS RESOLVED**

---

## Testing Plan

After fixes:
1. Boot simulator
2. Verify CR1 (PassKey, type 3) can be used in CALL (SWITCH context)
3. Verify Navana.ValidatePassKey executes without TYPE fault
4. Verify Outform (type 2) is REJECTED in CALL (should fault)
---
*Confidential — Kenneth Hamer-Hodges — April 2026*
