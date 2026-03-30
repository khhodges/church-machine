# Simulator ↔ Hardware Mismatch Report

**Status**: ✅ FIXED — All GT type names corrected to match hardware definitions  
**Date**: March 29, 2026 (fixed March 30, 2026)  
**Files**: `simulator/simulator.js` vs `hardware/hw_types.py`

---

## CRITICAL ISSUE: GT Type Mapping

### Hardware Definition (hw_types.py)
```python
GT_TYPE_NULL     = 0b00  # 0
GT_TYPE_INFORM   = 0b01  # 1
GT_TYPE_OUTFORM  = 0b10  # 2
GT_TYPE_ABSTRACT = 0b11  # 3
```

### Fixed Simulator Definition (simulator.js, line ~157)
```javascript
typeName: ['NULL','Inform','Outform','Abstract'][type & 3],
```

Canonical mapping:
- type=0 → 'NULL' ✅
- type=1 → 'Inform' ✅ (concrete NS entry reference)
- type=2 → 'Outform' ✅ (remote/abstract-library reference)
- type=3 → 'Abstract' ✅ (PassKey/unforgeable value)

### Type Encoding (all sources now aligned)

| Type | Hardware (hw_types.py) | Simulator (simulator.js) | Status |
|------|------------------------|--------------------------|--------|
| 0 | GT_TYPE_NULL | 'NULL' | ✅ |
| 1 | GT_TYPE_INFORM | 'Inform' | ✅ Fixed |
| 2 | GT_TYPE_OUTFORM | 'Outform' | ✅ Fixed |
| 3 | GT_TYPE_ABSTRACT | 'Abstract' | ✅ Fixed |

---

## Type Comparisons in Simulator — ✅ FIXED

**Location**: `simulator/simulator.js`

```javascript
// Inform GT with X permission — code reference for XLOADLAMBDA:
if (cr7Parsed.type === 1 && cr7Parsed.permissions.X) {
    // Load code GT from c-list
}

// CALL type check — Inform or Abstract only:
if (srcParsed.type !== 1 && srcParsed.type !== 3) {
    this.fault('TYPE', `CALL: must be Inform or Abstract`);
}
```

---

## Testing to Verify Fix (all passing)

After fixing, verify:

1. **Boot ROM**: Loads type 3 (Abstract) PassKeys for SWITCH
   - Should NOT show '???' in GT display
   - Should correctly validate Abstract GT gates

2. **Tutorials**: All GT_TYPE_INFORM usage (type 1)
   - Should show 'Inform' in UI, not 'Real'
   - Should behave correctly in CALL/LOAD operations

3. **Device abstractions**: Any type 2 (Outform) usage
   - Should show 'Outform' in UI
   - Should verify it's NOT being treated as Abstract

4. **Simulator console**: `parseGT()` output
   - Should display correct type names for all 4 types

---

## Risk Assessment

| Risk | Severity | Likelihood | Impact |
|------|----------|-----------|--------|
| Boot ROM fails on Abstract GT (type 3) | **CRITICAL** | HIGH | Cannot boot FPGA |
| Tutorial GTs (type 1) misbehave | **HIGH** | MEDIUM | Student confusion, wrong results |
| Outform handling (type 2) broken | **MEDIUM** | MEDIUM | Device I/O may not work |
| UI display shows '???' | **LOW** | CERTAIN | Cosmetic, but confusing |

---

## Root Cause

Simulator was written before complete GT type system was defined. It used placeholder "Real" and "Abstract" without the full 4-type taxonomy. Now that hardware defines all 4 types, simulator is out of sync.

---

## Files Updated

- [x] `simulator/simulator.js` — Fixed typeName array and type comparisons
- [x] `simulator/app.js` — Fixed all typeNames arrays and boot text strings
- [x] `simulator/assembler.js` — Fixed TPERM preset map (LE/SE/LSE) and disassembly names
- [x] `simulator/secure_boot_tutorial.js` — All GT type references updated to Inform
- [x] `simulator/system_abstractions.js` — Type guard and error messages fixed
- [x] `simulator/sliderule_tutorial.js` / `namespace_tutorial.js` — Type table updated
- [x] `hardware/boot_rom.py` — Comment cross-refs updated to Inform
- [x] `verilog/ctmm_pkg.sv` — GT_TYPE_REAL renamed to GT_TYPE_INFORM; type table corrected
- [x] `verilog/ctmm_core.sv` / `ctmm_tb.sv` — GT_TYPE_REAL → GT_TYPE_INFORM
- [x] `docs/CM_LUMP_SPECIFICATION.md` / `isa_encoding.md` — Type descriptions updated

---

## Recommendation

**Priority**: Fix before Week 1 hardware deployment (FPGA needs correct type handling).

**Approach**:
1. Update `simulator/simulator.js` typeName array (1 line)
2. Review and fix any type comparisons (likely 3-5 locations)
3. Re-run boot ROM simulator to verify Abstract GT (type 3) PassKeys work
4. Commit with message: "Fix simulator GT type mapping: type 1=Inform, type 2=Outform, type 3=Abstract"
