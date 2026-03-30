# Simulator ↔ Hardware Gaps Report

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

## Hardware Type Validation Found

**hardware/cload.py line 168** enforces:
```python
with m.If(e_gt_view.gt_type != GT_TYPE_INFORM):
    m.d.sync += fault_type_reg.eq(FaultType.PERM_E)  # FAULT
```

**This means CLOAD (code loading) ONLY accepts Inform (type 1)** — rejects Outform(2) and Abstract(3).

### Issue
- ✅ CLOAD correctly rejects non-Inform types for code loading
- ❓ **BUT**: Does CALL instruction pre-validate GT types before invoking CLOAD?
  - If CALL passes Abstract (type 3) to CLOAD directly → CLOAD will FAULT incorrectly
  - **Need to verify**: Does CALL bypass CLOAD for Abstract GTs, or validate type first?

**Files to check**: `hardware/call.py` (instruction decode path before CLOAD invocation)

---

## Summary of Fixes (All Applied)

| Issue | File | Line | Severity | Status |
|-------|------|------|----------|--------|
| CALL allows type 2 instead of type 3 | simulator.js | 1089 | 🔴 CRITICAL | ✅ FIXED |
| XLOADLAMBDA allows type 2 | simulator.js | 1580 | 🟠 HIGH | ✅ FIXED |
| Type comments say 2=Abstract | simulator.js | 231,234,281 | 🟡 MEDIUM | ✅ FIXED |
| TPERM presets 10-12 wrong (W vs LE/SE/LSE) | simulator.js, assembler.js | — | 🔴 CRITICAL | ✅ FIXED |
| TPERM presets 11-14 wrongly null | simulator.js, assembler.js | — | 🟠 HIGH | ✅ FIXED |
| "Real" GT type name throughout simulator/docs | all JS + docs | many | 🟡 MEDIUM | ✅ FIXED |
| isa_encoding.md preset table wrong (W at 0x0A) | docs/isa_encoding.md | — | 🟡 MEDIUM | ✅ FIXED |

---

## Impact Assessment

**Broken Features**:
- ❌ CALL with Abstract GTs (PassKeys) — will FAULT with TYPE error
- ❌ SWITCH with PassKeys — cannot work because CALL fails
- ❌ Navana.ValidatePassKey — depends on CALL working

**Risk Level**: 🔴 **CRITICAL** — PassKey architecture is broken until fixed

---

## Testing Plan

After fixes:
1. Boot simulator
2. Verify CR1 (PassKey, type 3) can be used in CALL (SWITCH context)
3. Verify Navana.ValidatePassKey executes without TYPE fault
4. Verify Outform (type 2) is REJECTED in CALL (should fault)
