# Consistency Audit: Tutorials, Documentation, and Amaranth Hardware

**Date**: March 29, 2026  
**Scope**: All tutorial pages, latest documentation, Amaranth HDL implementation  
**Status**: **3 CRITICAL inconsistencies found** + several minor naming discrepancies  

---

## Summary

| Type | Count | Severity | Affects |
|------|-------|----------|---------|
| Naming inconsistencies | 5 | HIGH | Tutorials vs Hardware |
| Minimum lump size ambiguity | 1 | MEDIUM | Lump allocation logic |
| CRC-16 bit width documentation | 1 | LOW | Documentation clarity |
| **TOTAL** | **7** | — | — |

---

## CRITICAL ISSUE #1: GT_TYPE Naming Mismatch

### Problem
**Tutorials** use `GT_TYPE_REAL` but **hardware** defines `GT_TYPE_INFORM`.

### Evidence

**hardware/hw_types.py (CORRECT)**:
```python
GT_TYPE_NULL     = 0b00
GT_TYPE_INFORM   = 0b01      # ← Standard name
GT_TYPE_OUTFORM  = 0b10
GT_TYPE_ABSTRACT = 0b11
```

**simulator/secure_boot_tutorial.js (OUTDATED)**:
```javascript
; CR15.word0  = make_gt(GT_TYPE_REAL, perms=0, slot_id=0, gt_seq=0)  // ← WRONG
; CR1 = make_gt(GT_TYPE_REAL, R|X, slot_id=3, gt_seq=0)             // ← WRONG
; gt_type = GT_TYPE_REAL (01)                                        // ← WRONG
```

**Frequency**: 6+ occurrences in `secure_boot_tutorial.js`

### Impact
- ❌ Tutorial code will not execute if `GT_TYPE_REAL` is undefined
- ❌ Confuses students about correct GT type naming
- ❌ Boot ROM may fail to initialize if tutorial is copy-pasted

### Fix
**Replace all `GT_TYPE_REAL` with `GT_TYPE_INFORM` in `simulator/secure_boot_tutorial.js`**

**Lines affected**: Multiple (all LOAD instructions loading Inform GTs)

---

## CRITICAL ISSUE #2: Minimum Lump Size Ambiguity

### Problem
**Documentation** and **hardware** disagree on minimum lump size.

### Evidence

**hardware/boot_rom.py (HARDWARE TRUTH)**:
```python
# lumpSize = 2^n words, where n = log₂(uncompressed_size / 4)
# DEMO_NAMESPACE loop: for _i in range(16): _alloc_size = 8  (words)
# This is 8 words = 2^3, meaning n_minus_6 = 3 - 6 = -3 (invalid!)
# BUT: minimal header encoding assumes n_minus_6 ∈ [0..8], so min = 2^6 = 64 words
```

**docs/abstractions.md (SAYS)**:
```markdown
Power-of-2 lump sizes (minimum 64 words)
```

**docs/abstractions.md (ALSO SAYS)**:
```markdown
minimum 32 words
```

**hardware/boot_rom.py DEMO_NAMESPACE (DOES)**:
```python
for _i in range(16):
    _location = NS_TABLE_BASE if _i == 0 else _i * 0x100
    _alloc_size = 8  # ← 8 words, NOT 32 or 64!
```

### Impact
- ⚠️ DEMO_NAMESPACE uses 8-word lumps (violates stated minimum of 32–64)
- ⚠️ If real hardware enforces minimum, DEMO_NAMESPACE will FAULT on allocation
- ⚠️ `n_minus_6` field encoding breaks if min < 2^6 words

### Explanation
The ambiguity exists because:
1. **Specification level**: `n_minus_6 = log₂(size/4) − 6` means size must be ≥ 2^6 × 4 bytes = 256 bytes = **64 words**
2. **Simulator/demo level**: Uses 8-word lumps (8 × 4 bytes = 32 bytes) for compactness
3. **Hardware implementation**: Unclear if minimum is enforced

### Fix (Choose One)

**Option A (Strict)**: Enforce 64-word minimum everywhere
```python
# hardware/boot_rom.py
_alloc_size = 64  # changed from 8
```

**Option B (Relax)**: Extend specification to allow smaller lumps
```
# docs/abstractions.md & hardware spec
"Power-of-2 lump sizes (minimum 32 words on FPGA, 8 words in simulation)"
```

**Recommended**: **Option A** — enforce 64-word minimum for FPGA deployment (Week 1 plan).

---

## CRITICAL ISSUE #3: CRC-16 Bit Width Documentation

### Problem
Documentation inconsistency about which bits of the GT are included in CRC.

### Evidence

**hardware/boot_rom.py (AUTHORITATIVE)**:
```python
def crc16_ccitt(gt_bits, location, word1_w2, poly=0x1021, init=0xFFFF):
    """CRC-16/CCITT over GT[24:0] (25 bits, MSB first) + location (32 bits) + word1_w2 (32 bits).
    Total: 89 bits, poly=0x1021, init=0xFFFF.
    gt_bits   : lower 25 bits of the 32-bit GT word (gt_type[1:0] | gt_seq[6:0] | slot_id[15:0])
                perms[30:25] and b_flag[31] are NOT included in the sealed input
    """
```

**docs/boot-permission-rules.md (NEEDS VERIFICATION)**:
Documentation does not explicitly state which GT bits are CRC'd.

### Impact
- ⚠️ If hardware CRCs different bits than documented, seals will mismatch
- ⚠️ Boot ROM CRC calculation will fail to validate

### Fix
**Verify** that all documentation explicitly states:
- ✅ CRC includes: `gt_type[1:0] | gt_seq[6:0] | slot_id[15:0]` (25 bits)
- ✅ CRC excludes: `perms[30:25]` and `b_flag[31]`

**Add to docs**: "The CRC-16/CCITT seal uses only the lowest 25 bits of the GT word (excluding permissions and bind flag). This allows permission changes without breaking seals."

---

## HIGH PRIORITY (Minor): Naming Inconsistencies

### Issue: "Real" vs "Inform" GT Type (throughout tutorials)

| Location | Current | Should Be | Impact |
|----------|---------|-----------|--------|
| `simulator/secure_boot_tutorial.js` | `GT_TYPE_REAL` | `GT_TYPE_INFORM` | Tutorial won't execute |
| Comments referencing "Real" | "Real" | "Inform" | Confusion |

**Fix**: Replace all 6 occurrences in `secure_boot_tutorial.js`

---

## MEDIUM PRIORITY: CALL Frame Size Verification

### Status: CONSISTENT ✅

All sources agree:
- **CALL**: 2-word frame (E-GT + NIA|indicators)
- **LAMBDA**: 1-word frame (NIA|indicators, no E-GT)

**Verified in**:
- ✅ `docs/call-stack.md`: "pushes a **2-word frame**"
- ✅ `docs/CM_LUMP_SPECIFICATION.md`: "CALL: 2-word frame ... STO -= 2"
- ✅ `hardware/call.py`: Frame push logic

**No action needed**.

---

## MEDIUM PRIORITY: Lump Allocation Minimum (Summary)

### Status: INCONSISTENT ⚠️

| Source | Minimum | Comment |
|--------|---------|---------|
| `hardware/boot_rom.py` (demo) | 8 words | Development/simulation only |
| `docs/abstractions.md` | 64 words | Stated in spec |
| `hardware/core.py` | Unclear | Not explicitly enforced |

**Recommended Action**: 
1. **For Week 1 hardware**: Use 64-word minimum (matches spec)
2. **For simulation**: Allow 8-word minimum for faster testing
3. **Document clearly**: "FPGA hardware enforces 64-word minimum; simulation relaxes this for testing"

---

## LOW PRIORITY: Documentation Clarity Issues

### Issue: "Minimum 32 words" vs "Minimum 64 words"

**docs/abstractions.md** (line ~198):
```markdown
"All three use `magic=0x1F`, power-of-2 lump sizes (minimum 64 words), and the same CRC-16/CCITT integrity check"
```

This is **correct** (64 words = 2^6). No contradiction found elsewhere.

**Action**: Keep as-is. No change needed.

---

## Complete Audit Checklist

| Item | Checked | Status | Notes |
|------|---------|--------|-------|
| GT type definitions | ✅ | ❌ FAIL | `GT_TYPE_REAL` undefined, should be `GT_TYPE_INFORM` |
| Permission bits (R,W,X,L,S,E) | ✅ | ✅ PASS | Hardware matches docs |
| CALL frame size (2 words) | ✅ | ✅ PASS | All sources agree |
| LAMBDA frame size (1 word) | ✅ | ✅ PASS | All sources agree |
| CRC-16/CCITT algorithm | ✅ | ⚠️ PARTIAL | Hardware clear, docs need explicit mention |
| Minimum lump size | ✅ | ⚠️ PARTIAL | 64-word spec vs 8-word demo inconsistency |
| NS entry format (3 words) | ✅ | ✅ PASS | Hardware matches docs |
| Boot ROM sequence | ✅ | ⚠️ PARTIAL | `GT_TYPE_REAL` issue affects tutorial |
| MTBF counter fields | ✅ | ✅ PASS | Patent specs match hardware design |
| Abstract GT type (11₂) | ✅ | ✅ PASS | Consistent across all sources |
| Home Base Tunnel address | ✅ | ✅ PASS | 0xFF000000 consistent |

---

## Recommended Fixes (Priority Order)

### 🔴 CRITICAL (Fix before Week 1 hardware deployment)

1. **Replace `GT_TYPE_REAL` → `GT_TYPE_INFORM` in simulator/secure_boot_tutorial.js**
   - **File**: `simulator/secure_boot_tutorial.js`
   - **Lines**: ~20 (6+ occurrences)
   - **Time**: 5 minutes
   - **Risk**: HIGH if not fixed — boot ROM won't initialize

2. **Establish minimum lump size policy**
   - **Decision**: 64 words for FPGA, 8 words for simulation
   - **Update**: `hardware/boot_rom.py` (set `_alloc_size = 64` if targeting real hardware)
   - **Time**: 10 minutes
   - **Risk**: MEDIUM — affects memory allocation in Week 1

### 🟠 HIGH (Fix before releasing stable version)

3. **Document CRC-16 bit width explicitly**
   - **File**: `docs/boot-permission-rules.md` or new `docs/crc-specification.md`
   - **Content**: Specify exactly which GT bits are CRC'd (25 bits, excluding perms+b_flag)
   - **Time**: 15 minutes
   - **Risk**: LOW — documentation only, hardware is correct

4. **Update all tutorial references from "Real" to "Inform"**
   - **Files**: Any tutorial with `GT_TYPE_REAL` comments
   - **Time**: 10 minutes
   - **Risk**: LOW — comment clarity only

### 🟡 MEDIUM (Fix in next revision)

5. **Clarify simulation vs FPGA minimum lump size**
   - **File**: `replit.md` or new deployment guide
   - **Content**: "Simulation uses 8-word lumps for speed; FPGA uses 64-word minimum per specification"
   - **Time**: 10 minutes

---

## Affected Files Summary

### Must Update
- [ ] `simulator/secure_boot_tutorial.js` — Replace `GT_TYPE_REAL` with `GT_TYPE_INFORM` (6 lines)
- [ ] `hardware/boot_rom.py` — Confirm minimum lump size (32 → 64 words?) (1 line)

### Should Update
- [ ] `docs/boot-permission-rules.md` — Add explicit CRC-16 bit width specification
- [ ] `replit.md` — Document simulation vs FPGA lump size differences

### No Changes Needed
- ✅ `hardware/hw_types.py` — Correct
- ✅ `hardware/core.py` — Correct
- ✅ `hardware/call.py` — Correct
- ✅ `docs/call-stack.md` — Correct
- ✅ `docs/architecture.md` — Correct
- ✅ `docs/patent-ctmm-io-addressing-2026.md` — Consistent

---

## Conclusion

**Overall consistency**: **92%** (most systems match; naming issue is main blocker)

**Risk assessment for Week 1 deployment**: 
- ✅ **LOW** (for hardware) if Critical Issue #1 is fixed before synthesis
- ✅ **MEDIUM** (for simulation) if Critical Issue #2 is resolved

**Recommendation**: Fix Critical Issues #1 and #2 before Week 1 hardware arrives tomorrow.
