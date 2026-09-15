# CLOOMC++ Petname Execution Model — Phase 1

**Status:** Proposal for review and approval  
**Date:** 2026-09-15  
**Scope:** Programmer-visible petnames, Church register identity, and symbolic CALL/LAMBDA dispatch

---

## 1. Purpose

Phase 1 establishes a programmer model in which CLOOMC++ source names
abstractions, methods, and Golden Tokens by petname. Register allocation,
c-list rows, method selectors, and instruction selection are compiler
responsibilities.

The programmer writes:

```cpp
Scheduler.pause();
a = b + c;
```

The programmer does not select capability registers, data registers, c-list
rows, or machine instructions. CLOOMC++ resolves the vocabulary and generates
those details.

This phase follows the Church/Turing split:

- Church capability registers receive symbolic GT identities.
- Turing data registers remain numeric and value-only.

Phase 1 does not attempt source-variable tracking for data registers.

---

## 2. Programmer-visible vocabulary

### 2.1 Petnames are the interface

A complete method petname such as:

```text
Scheduler.pause
```

is all the programmer needs to supply.

CLOOMC++ resolves it into:

1. the caller's private c-list row for `Scheduler`;
2. the public method selector for `pause`;
3. the required CALL form;
4. any internal register allocation;
5. the resulting machine instruction.

Neither the row number nor the method selector appears in CLOOMC++ source.

### 2.2 Expressions remain source-level expressions

For:

```cpp
a = b + c;
```

CLOOMC++ determines:

- the identities and types of `a`, `b`, and `c`;
- the abstraction and public method implementing `+`;
- the capabilities required by that operation;
- temporary data-register allocation;
- the Church and Turing instructions;
- the final destination of the result.

Phase 1 does not require the IDE or hardware to name the temporary DR values.

---

## 3. Relative context petnames

The following names are reserved:

| Petname | Meaning |
|---|---|
| `Self` | The currently executing abstraction |
| `Self.Thread` | The currently executing protected Thread |
| `Self.Namespace` | The Namespace in which `Self` resolves petnames |

These are relative identities. Their resolved GTs can change when execution
context changes.

### 3.1 `Self`

`Self` is the canonical name for the current abstraction. Do not display
`CurrentAbstraction`.

C-list row zero is the advisory `Self` row:

```text
c-list[0] = Self
```

Although row zero could mechanically be described as `Child[0]`, it must be
shown as `Self`. The current abstraction is not conceptually its own child.

### 3.2 `Self.Thread`

`Self.Thread` identifies the GT for the active protected Thread. It is not a
name for an address inside Thread storage.

### 3.3 `Self.Namespace`

`Self.Namespace` identifies the GT for the Namespace governing the current
petname vocabulary. It is not a name for a raw Namespace-table address.

### 3.4 Context changes

- CALL changes `Self` to the callee.
- RETURN restores the caller as `Self`.
- LAMBDA changes the active reduction context without exposing a private
  c-list GT.
- CHANGE may replace `Self.Thread`, `Self.Namespace`, and `Self`.

---

## 4. Parent, caller, and child terminology

The capability graph is not a tree. Abstractions may be shared, delegated,
called by several abstractions, or called recursively.

Therefore:

- `Parent` is not a permanent petname.
- `Child[n]` is not a preferred identity.
- `Caller` may be shown as a dynamic call-stack relationship when it is
  derived from a validated protected CALL frame.
- A known GT is always shown by its real petname.
- `Child[n]` may be used only as an explicit fallback for a valid, unnamed
  nonzero c-list row.

Examples:

```text
Self:    ChurchMemory
Caller:  Scheduler
```

and, only when no declared petname is available:

```text
CR2: Child[4] (petname unresolved)
```

The IDE must not guess an identity from a row number.

---

## 5. Church and Turing register presentation

### 5.1 Capability registers

Every valid GT currently held in a Church capability register should be
resolved to a petname when sufficient identity evidence exists.

Example:

```text
CR0  Scheduler
CR1  ChurchMemory
CR6  Self             c-list view
CR12 Self.Thread
CR14 Self             code view
CR15 Self.Namespace
```

The register number remains visible for machine diagnosis, but the petname is
the primary human-readable identity.

CR6 and CR14 may both display `Self` because they are two protected views of
the same executing abstraction. The UI may annotate their roles as
`c-list view` and `code view`; those role labels are not separate petnames.

### 5.2 Data registers

Turing data registers remain unnamed in Phase 1:

```text
DR0  0x00000000
DR1  0x0000002A
DR2  0x00000011
```

The IDE may show numeric interpretations, but it does not claim that a DR
currently represents source variable `a`, `b`, or `c`.

Source-variable names for DRs require compiler lifetime and debug-location
metadata and are deferred beyond Phase 1.

### 5.3 Unresolved identity

If a GT cannot be resolved safely, the IDE must show:

- the CR number;
- the raw GT;
- an explicit unresolved or invalid state.

It must not reuse a stale petname from the register's previous value.

---

## 6. Private c-list authority

An abstraction must remain private. Its entry authority must not also grant
ordinary c-list traversal.

The intended rules are:

- An abstraction entry GT carries E authority, not L+E authority.
- No architectural L permission is added to the abstraction merely to make
  CALL or LAMBDA convenient.
- CR6 traversal by CALL or LAMBDA is authorized internally by microcode's
  virtual M state.
- The fetched E-GT or X-GT remains an internal pipeline value.
- Indexed CALL or LAMBDA does not materialize that fetched GT in a
  programmer-visible CR.
- CR6 remains unchanged by the lookup itself.

Virtual M is a processor mechanism, not a permission that CLOOMC++ programmers
request or manipulate.

---

## 7. Extended CALL

CALL has two machine-level forms, but CLOOMC++ normally selects the form
without exposing it.

### 7.1 Petname/indexed form

Source:

```cpp
Scheduler.pause();
```

Conceptual execution:

```text
row    := resolve caller petname "Scheduler"
method := resolve public method "pause"
E-GT   := virtual-M-read CR6[row]
validate E-GT
enter E-GT at method
```

CR6 is implicit in indexed mode. It is not selected by the programmer and
need not be encoded as a general c-list source register.

The machine instruction must encode both:

- the c-list row;
- the method selector.

The strings `Scheduler` and `pause` are not stored in the instruction.

### 7.2 Direct-GT form

If CLOOMC++ already has the required E-GT in a capability register, it may emit
the direct form:

```text
validate E-GT in selected CR
enter E-GT at encoded method
```

This is an internal compiler choice. A high-level programmer still writes the
petname expression.

### 7.3 Encoding requirement

The final 32-bit encoding must provide:

- CALL opcode;
- condition;
- indexed versus direct mode;
- c-list row in indexed mode or source CR in direct mode;
- method selector in both modes.

The exact bit allocation is intentionally left for approval. The previous
four-bit row proposal is insufficient for a full c-list, and a design that
removes or materially reduces the existing method range must not be adopted
without an explicit architectural decision.

---

## 8. Extended LAMBDA

LAMBDA follows the same private-resolution principle:

### 8.1 Petname/indexed form

```text
X-GT := virtual-M-read CR6[row]
validate X-GT
apply X-GT internally
```

CR6 is implicit, the X-GT remains internal, and CR6 is not overwritten.

### 8.2 Direct-GT form

When CLOOMC++ already has the X-GT in a capability register, LAMBDA may consume
that GT directly.

The direct versus indexed choice remains a compiler concern rather than a
source-language burden.

---

## 9. Obsolete fused instructions

Under this model, ELOADCALL and XLOADLAMBDA provide no separate authority.

Their LOAD terminology also suggests that a private c-list GT is first
materialized in a general capability register. That is not the intended
indexed CALL/LAMBDA behavior.

Phase 1 therefore proposes:

- extended CALL replaces ELOADCALL;
- extended LAMBDA replaces XLOADLAMBDA;
- indexed resolution consumes the fetched GT internally under virtual M;
- direct resolution consumes an E-GT or X-GT already selected by CLOOMC++;
- opcodes 8 and 9 become unassigned or reserved after compatibility and
  migration requirements are approved.

---

## 10. Compiler responsibilities

CLOOMC++ owns:

- petname and method resolution;
- c-list construction and row assignment;
- capability-register allocation;
- data-register allocation;
- selection of indexed or direct CALL/LAMBDA;
- instruction encoding;
- relocation and destination binding;
- emission of GT identity metadata used by the IDE.

These responsibilities must not leak into normal CLOOMC++ source syntax.

Symbolic assembly may expose forms such as:

```asm
CALL Scheduler.pause
```

for diagnostics and low-level development, but raw row, register, and method
forms are machine-tool interfaces rather than the primary programming model.

---

## 11. Hardware and metadata boundary

Hardware registers continue to store only machine values and GTs. Petname
strings are not stored in the processor register file.

The IDE resolves a CR-held GT using verified execution context, including:

- GT identity;
- the active Namespace;
- current LUMP or abstraction identity;
- localized c-list bindings;
- compiler-emitted symbolic metadata where required.

Physical-hardware traces must be matched to the correct executable identity
before symbolic petnames are displayed. A raw register value without a valid
identity match remains unresolved.

---

## 12. Phase 1 deliverables

After approval, Phase 1 consists of:

1. Define the final extended CALL and LAMBDA bit encodings.
2. Update the assembler/compiler to resolve complete petnames without
   programmer-selected CRs or rows.
3. Implement indexed CALL/LAMBDA as virtual-M reads from implicit CR6.
4. Keep fetched E/X GTs internal rather than writing them to general CRs.
5. Retire ELOADCALL and XLOADLAMBDA after an explicit compatibility decision.
6. Display verified petnames for all GT-bearing CRs in the IDE.
7. Display `Self`, `Self.Thread`, and `Self.Namespace` according to the active
   execution context.
8. Keep DRs numeric and unnamed.
9. Show unresolved identities explicitly and never reuse stale labels.
10. Align the interactive reference, ISA documents, simulator, assembler,
    tests, and RTL.

---

## 13. Deferred work

The following are outside Phase 1:

- source-variable names for Turing DRs;
- optimized variable-lifetime tracking;
- source-level temporary visualization;
- permanent `Parent` or `Child` identity hierarchies;
- storing petname strings in hardware;
- changing GT identity based only on an unverified trace address.

---

## 14. Review and approval checklist

Approval of this document confirms:

- [ ] Petnames are the normal CLOOMC++ interface; registers and rows are
      compiler-managed.
- [ ] `Scheduler.pause` resolves both an abstraction row and a method
      selector.
- [ ] `Self`, `Self.Thread`, and `Self.Namespace` are reserved relative
      petnames.
- [ ] C-list row zero is displayed as `Self`, not `Child[0]`.
- [ ] `Caller` is a dynamic protected-frame relationship, not a permanent
      petname.
- [ ] Every resolved GT in a Church CR may be displayed by petname.
- [ ] Turing DRs remain numeric and unnamed in Phase 1.
- [ ] Indexed CALL and LAMBDA use implicit CR6 through virtual M.
- [ ] The indexed E/X GT remains internal and is not materialized in a
      programmer-visible CR.
- [ ] Abstraction entry authority does not receive L permission.
- [ ] Extended CALL replaces ELOADCALL.
- [ ] Extended LAMBDA replaces XLOADLAMBDA.
- [ ] Final row/method/mode bit allocation requires a separate explicit
      encoding approval.

Until this checklist and the final encoding are approved, this document is a
proposal and does not supersede the implemented ISA.