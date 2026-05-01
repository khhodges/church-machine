# Method Access Control in CLOOMC

**v2.0 — 2026-05-01**
**CONFIDENTIAL**

**Status**: Architectural specification. April 27, 2026. Revised May 1, 2026 (hardware method-table dispatch).

## Vocabulary

| Structure   | Stride   | Term          |
|-------------|----------|---------------|
| NS table    | 4 words  | **slot**      |
| c-list      | 1 word   | **row**       |
| method table| 1 word   | **index**     |

## Overview

CLOOMC abstractions support two visibility qualifiers on method declarations:

```
public method Foo(args) { ... }
private method Bar(args) { ... }
```

Omitting the qualifier defaults to `public` — existing source files without qualifiers compile identically to before.

These qualifiers have a specific, structural meaning tied to the lump seal and the hardware method-table dispatch built into the CALL instruction. This document explains what they mean, how they are enforced, and why the design is sound.

---

## What `public` and `private` Mean

### `public`

A public method is externally callable. The compiler writes its lump-base-relative word offset into the method table at the word corresponding to its method index. Any caller holding a GT to this abstraction can invoke a public method by encoding its method index in the `CALL` instruction's imm15 field.

### `private`

A private method is an internal implementation detail. It is compiled into the lump binary at its assigned offset and is fully reachable from within the abstraction via a direct `BRANCH` instruction. However, its method table slot stores **0** (the FAULT sentinel). Because CALL with a zero method table entry raises PRIVATE_METHOD fault immediately, and the lump seal prevents modification of the code region from outside, private methods are **structurally unreachable** from external callers — not merely hidden by convention.

---

## Structural Enforcement: Why "Unreachable" Is the Right Word

The security property comes from two orthogonal mechanisms working together:

1. **Hardware table dispatch**: The CALL instruction reads `memory[lump_base + index×4]`. A zero entry raises PRIVATE_METHOD fault in hardware without executing a single instruction from the callee. There is no software dispatch loop that could be manipulated.

2. **Lump seal**: The lump is a sealed binary object. Once committed to the namespace, its code region cannot be patched or extended from outside. An attacker cannot write a non-zero entry to a private method's table slot.

Together these mean: a private method's byte offset exists in the lump binary, but every external access path raises a hardware FAULT before reaching it. No code executes. No side-effects occur.

---

## Why Not a Separate GT?

A natural alternative would be to give each method its own GT (capability token) so that private methods simply never have a GT issued. This was considered and rejected:

**NS table amplification**: Every new GT requires a namespace table entry. An abstraction with 20 methods would require 20 NS entries, growing the NS table and the trusted computing base.

**Trust boundary fragmentation**: Each GT creates a new security boundary with its own c-list. A 20-method abstraction would have 20 separate c-lists, each needing its own lump seal verification. The atomic simplicity of a single sealed lump is lost.

**LAMBDA semantics mismatch**: In this architecture, LAMBDA means a well-defined entry point *within* a sealed lump — not a separate GT with its own c-list. Introducing per-method GTs would require LAMBDA instructions to load GTs from a caller-supplied c-list, re-introducing the exact amplification problem that capability architectures are designed to avoid.

**The correct design**: Method dispatch is a hardware table read, not a software trust boundary. The method table is inside the existing lump seal. Private methods store 0 in the table. No new GT or NS entry is created.

This is the same design principle that makes OS kernels compile internal functions without exporting them from the symbol table: the security is provided by the binary boundary (the lump seal), not by the capability mechanism.

---

## Hardware Method-Table Dispatch

The compiler writes `N` lump-base-relative word offsets into the lump at words 1..N (immediately after the lump header at word 0). The CALL instruction carries the method index in imm15:

```
word 0  lump header
word 1  table[1] — lump-base-relative word offset of method 1 body (0 = private → FAULT)
word 2  table[2] — lump-base-relative word offset of method 2 body (0 = private → FAULT)
…
word N  table[N] — lump-base-relative word offset of method N body
word N+1  method 1 first instruction
…
```

Hardware CALL execution (after the lump is entered):

```
if method_index == 0:
    NIA = lump_base + 4   # single entry point, no method table
else:
    table_entry = memory[lump_base + method_index * 4]
    if table_entry == 0:
        FAULT(PERM)       # private method or out of bounds
    NIA = lump_base + table_entry * 4
```

No software loop executes. The dispatch is one memory read in hardware.

Private methods are compiled at their word offset in the lump binary — reachable from sibling methods via direct `BRANCH` — but their table entry is 0, making them unreachable from any external `CALL`.

No Dispatch method. No ISUB/IADD/MCMP/BRANCHEQ loop. No runtime overhead.

---

## Method Index Numbering

Methods are assigned indices in source order, starting at 1. Private methods receive an index but store 0 in the table. AliasOf methods share the entry (and index) of their target method.

| Method index | Method     | Visibility | Table entry |
|-------------|------------|------------|-------------|
| 1           | Create     | public     | offset(Create) |
| 2           | Revoke     | private    | 0 (→ FAULT)    |
| 3           | Transfer   | public     | offset(Transfer) |

---

## Worked Example: Mint

The `mint.cloomc` abstraction manages memory allocation and capability revocation:

```
abstraction Mint {
    capabilities { Memory }

    public method Create(size, perms) {
        result = call(Memory.Allocate(size))
        return(result)
    }

    private method Revoke(index) {
        var word2 = read(CR7, 2)
        var version = bfext(word2, 25, 7)
        var newVersion = version + 1
        bfins(word2, newVersion, 25, 7)
        write(CR7, 2, word2)
        return(newVersion)
    }

    public method Transfer(gt) {
        return(gt)
    }
}
```

### Why Revoke is private

`Revoke` modifies the version number embedded in a capability word. This operation is an internal bookkeeping step — it increments the version counter that a revocation check compares against. External callers must never trigger version bumps directly; doing so would allow them to revoke capabilities they don't own.

By marking `Revoke` as `private`, the lump seal guarantees that no external caller can reach `Revoke`. The version bump can only occur when `Create` internally calls it via a direct `BRANCH` to `Revoke`'s offset.

### Compiled lump layout

```
word 0   lump header           — magic + cw + cc + typ + n_minus_6
word 1   table[1] = N+1        — lump-base-relative word offset of Create body
word 2   table[2] = 0          — Revoke is private → FAULT
word 3   table[3] = N+1+len(Create) — lump-base-relative word offset of Transfer body
word 4   Create body (first instruction)
…        Revoke body
…        Transfer body
```

Callers use:
- `CALL CRsrc, #1` — invokes Create (reads word 1 → Create's body offset → direct jump)
- `CALL CRsrc, #2` — PRIVATE_METHOD FAULT (word 2 = 0)
- `CALL CRsrc, #3` — invokes Transfer (reads word 3 → Transfer's body offset → direct jump)

No linear scan. No MCMP loop. O(1) dispatch for every method.

---

## Backward Compatibility

Abstractions that use no visibility qualifiers (all `method Foo(...)` without prefix) compile identically to before. No method table is generated; CALL with index=0 goes to lump word 1 directly. The single-entry-point path is preserved unchanged.

---

## Summary

| Property | Value |
|----------|-------|
| Qualifier `public` | Compiler writes method's word offset into method table at lump words 1..N |
| Qualifier `private` | Compiler writes 0 into method table — hardware PRIVATE_METHOD FAULT on CALL |
| Default (no qualifier) | Treated as `public`; `CALL #0` (single entry point) still works |
| Enforcement mechanism | Hardware: CALL reads method table; zero entry = FAULT + lump seal prevents patching |
| GT count | Unchanged — one GT per abstraction, no per-method GTs |
| Method index | Compile-time immediate in CALL imm15 — cannot be runtime-manipulated |
| Dispatch overhead | O(1) — one memory read in hardware (no ISUB/IADD/MCMP loop) |
| Dispatch method | None — removed entirely |

---

## Worked Example: WordString

`WordString.cloomc` implements string operations for a UTF-8 lump object. It has 27 named methods: 13 externally callable and 14 internal helpers.

### Method table design

The compiler assigns method indices 1–27 (one per method in declaration order) and writes 0 into the table entries for the 14 private methods:

- **13 public** (indices 1–13, non-zero table entries): `GetWordCount`, `GetCharCount`, `GetByteCount`, `GetCharByte`, `IsUppercase`, `IsLowercase`, `ReturnFalse`, `IsDigit`, `IsAlpha`, `IsUpperExt`, `IsPunct`, `IsLowerExt`, `IsSymbol`.
- **14 private** (table entry = 0): `IsSpace`, `IsAlphaNum`, `ToUppercase`, `Stub`, `ToLowercase`, `StubExt`, `NormaliseDigit`, `IsHex`, `Offset`, `StringOp`, `CheckNonZero`, `CheckPositive`, `ComputeBase`, `Classify`.

The method table occupies words 1..27 of the lump (27 entries). The previous hand-written Dispatch method (41 words) is completely eliminated — saving 41 words of code and removing the runtime linear scan. CALL #1 → `GetWordCount` directly. Any index pointing to a private method → immediate FAULT.

---

## Language Target Notes

### Pet-name (`[pet name]`) sources

Pet-name abstractions are expression-oriented — they describe data-register naming aliases rather than method implementations. They do not use `method` declarations and therefore cannot carry `public`/`private` qualifiers. Pet-name compilation is unaffected by this change.

---

See also: [dispatch-styles.md](dispatch-styles.md) for how hardware method-table dispatch fits into the three existing dispatch styles.
---
*Confidential — Kenneth Hamer-Hodges — May 2026*
