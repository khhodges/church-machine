# Simulator ↔ Hardware Gaps Report

**Date**: March 29, 2026  
**Status**: CRITICAL GAPS FOUND

---

## CRITICAL GAP #1: CALL Type Validation is Wrong

### Problem
**Simulator line 1089** allows types 1 and 2, rejects type 3:
```javascript
if (srcParsed.type !== 1 && srcParsed.type !== 2) {
    this.fault('TYPE', `CALL: CR${d.crDst} GT type is ${srcParsed.typeName}, must be Real or Abstract`);
}
```

**But the error message says "must be Real or Abstract"**, which would be:
- Type 1 = **Inform** (formerly "Real")
- Type 3 = **Abstract** (PassKeys)

**The code allows type 2 (Outform)** — which is WRONG for CALL!

### Current Logic
```
Allows: type 1 (Inform) OR type 2 (Outform)
Rejects: type 0 (NULL), type 3 (Abstract ← **WRONG!**)
```

### Correct Logic
```
Allows: type 1 (Inform) OR type 3 (Abstract)
Rejects: type 0 (NULL), type 2 (Outform)
```

### Impact
🔴 **CRITICAL**: PassKeys (Abstract GTs, type 3) **CANNOT be used in CALL** — they will fault with TYPE error instead of working.

### Fix Required
```javascript
// OLD (WRONG):
if (srcParsed.type !== 1 && srcParsed.type !== 2) {

// NEW (CORRECT):
if (srcParsed.type !== 1 && srcParsed.type !== 3) {
```

**Line**: simulator.js line 1089

---

## SECONDARY GAP #2: Wrong Type Checks in XLOADLAMBDA Path

### Problem
**Simulator line 1580** also checks for types 1 and 2:
```javascript
if (cr7Parsed.type === 1 || cr7Parsed.type === 2) {
    // Load code GT from c-list
}
```

This code path loads a code reference from the c-list (for code chaining). It should only accept **Inform (type 1)**, not Outform (type 2).

### Fix Required
```javascript
// Should be specific to Inform GTs:
if (cr7Parsed.type === 1) {
```

**Line**: simulator.js line 1580

---

## DOCUMENTATION GAP #3: Type Comments are Outdated

### Problem
**Lines 231, 234, 281** have wrong type comments:
```javascript
// WRONG:
// GT type semantics: 0=NULL, 1=Real (concrete lump in memory), 2=Abstract (user-uploaded/PassKey), 3=reserved
// Abstract (type=2) GTs are only created by Navana.Abstraction.Add (user uploads) and Navana.MintPassKey.
// type=2 (Abstract) GTs are only created at runtime by Navana.Abstraction.Add and Navana.MintPassKey.

// CORRECT:
// GT type semantics: 0=NULL, 1=Inform (concrete lump in memory), 2=Outform (remote), 3=Abstract (PassKey/value)
// Abstract (type=3) GTs are only created by Navana.Abstraction.Add (user uploads) and Navana.MintPassKey.
// type=3 (Abstract) GTs are only created at runtime by Navana.Abstraction.Add and Navana.MintPassKey.
```

**Lines**: simulator.js 231, 234, 281

---

## Hardware Check Required

Need to verify if **hardware/call.py** has the same type validation bug:
- Does hardware allow types 1 and 2? (WRONG)
- Or types 1 and 3? (CORRECT)

**File**: hardware/call.py (likely around mLoad gate implementation)

---

## Summary of Fixes Needed

| Issue | File | Line | Severity | Fix |
|-------|------|------|----------|-----|
| CALL allows type 2 instead of type 3 | simulator.js | 1089 | 🔴 CRITICAL | Change `!== 1 && !== 2` to `!== 1 && !== 3` |
| XLOADLAMBDA allows type 2 | simulator.js | 1580 | 🟠 HIGH | Change `=== 1 \|\| === 2` to `=== 1` only |
| Type comments say 2=Abstract | simulator.js | 231,234,281 | 🟡 MEDIUM | Update comments to say 3=Abstract |
| **Hardware type check** | hardware/call.py | ? | 🔴 CRITICAL | **Verify and fix if needed** |

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
