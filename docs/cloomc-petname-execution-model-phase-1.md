# CLOOMC++ Petname Execution Model — Phase 1

**Status:** Approved architecture; proposed CALL/LAMBDA bit allocation pending approval
**Date:** 2026-09-15  
**Approved:** 2026-09-15
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

The previous four-bit row proposal is insufficient for a full c-list.

### 7.4 Proposed common 32-bit format

CALL and LAMBDA use the same top-level field layout:

```text
 31          27 26          23 22 21              14 13               0
┌──────────────┬──────────────┬───┬─────────────────┬──────────────────┐
│    opcode    │  condition   │ D │    selector     │      detail      │
│    5 bits    │    4 bits    │1b │     8 bits      │     14 bits      │
└──────────────┴──────────────┴───┴─────────────────┴──────────────────┘
```

`D` is the direct-mode bit:

| `D` | Mode | `selector[7:0]` |
|---:|---|---|
| 0 | Indexed | unsigned c-list row `0..255`; CR6 is implicit |
| 1 | Direct | `selector[3:0]` is CR0..CR15; `selector[7:4]` must be zero |

The direct encoding range `D=1, selector[7:4] != 0` is reserved and must
fault. Requiring the high nibble to be zero gives canonical encodings and
prevents ignored bits from creating aliases.

This layout provides:

- all 256 possible c-list rows in indexed mode;
- all 16 capability registers in direct mode;
- one explicit mode bit;
- 14 instruction-specific bits;
- no encoded CR6 field in indexed mode.

The decoder signal should be called `direct_mode`. It is unrelated to the
processor's virtual M authority.

### 7.5 Proposed CALL encoding

CALL remains opcode 2:

```text
 31          27 26          23 22 21              14 13               0
┌──────────────┬──────────────┬───┬─────────────────┬──────────────────┐
│  CALL 00010  │  condition   │ D │ row or source CR│ method selector  │
│    5 bits    │    4 bits    │1b │     8 bits      │     14 bits      │
└──────────────┴──────────────┴───┴─────────────────┴──────────────────┘
```

#### Indexed CALL

```text
D = 0
selector = caller CR6 c-list row, 0..255
method = 0..16383
```

Execution:

```text
E-GT := virtual-M-read CR6[selector]
validate E-GT
enter E-GT at method
```

#### Direct CALL

```text
D = 1
selector[7:4] = 0
selector[3:0] = source CR, 0..15
method = 0..16383
```

Execution:

```text
E-GT := CR[selector[3:0]]
validate E-GT
enter E-GT at method
```

#### Method field

The 14-bit method selector is defined as:

| Value | Meaning |
|---:|---|
| 0 | default/single-entry method |
| 1..16383 | public method-table slot |

CLOOMC++ resolves `Scheduler.pause` to the Scheduler c-list row and the
positive public method-table slot for `pause`. The programmer never writes
either number.

Fourteen method bits retain 16,383 named method-table slots plus the default
entry. This is preferred over reducing the c-list row to seven bits: an
abstraction's private vocabulary should retain the complete 8-bit row space.

### 7.6 CALL examples

If `Scheduler` is in caller c-list row 9 and `pause` is public method-table
slot 3:

```text
CALL Scheduler.pause
opcode    = 00010
condition = AL
D         = 0
selector  = 0x09
method    = 0x0003
```

If CLOOMC++ already holds Scheduler's E-GT in CR2:

```text
opcode    = 00010
condition = AL
D         = 1
selector  = 0x02
method    = 0x0003
```

These forms have the same authority and method semantics. Only GT resolution
differs.

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

### 8.3 Proposed LAMBDA encoding

LAMBDA remains opcode 7 and uses the same mode and selector fields:

```text
 31          27 26          23 22 21              14 13               0
┌──────────────┬──────────────┬───┬─────────────────┬──────────────────┐
│ LAMBDA 00111 │  condition   │ D │ row or source CR│    reserved 0    │
│    5 bits    │    4 bits    │1b │     8 bits      │     14 bits      │
└──────────────┴──────────────┴───┴─────────────────┴──────────────────┘
```

#### Indexed LAMBDA

```text
D = 0
selector = caller CR6 c-list row, 0..255
detail = 0
```

The processor reads the X-GT internally from implicit CR6 under virtual M,
validates it, and applies it without modifying CR6 or a general CR.

#### Direct LAMBDA

```text
D = 1
selector[7:4] = 0
selector[3:0] = source CR, 0..15
detail = 0
```

The processor validates and applies the X-GT already held in the selected CR.

All nonzero LAMBDA `detail` values are reserved and must fault. They are not
ignored. This leaves a canonical Phase 1 encoding and preserves 14 bits for a
future explicitly versioned extension.

### 8.4 Why LAMBDA has no method selector

CALL enters an abstraction and therefore selects one of its public methods.
LAMBDA applies the code designated by an X-GT directly. It does not perform a
public abstraction-method dispatch, so its 14-bit detail field is zero in
Phase 1.

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

### 9.1 End-to-end retirement plan

ELOADCALL and XLOADLAMBDA must be removed through the complete executable
toolchain. Removing their source syntax while leaving their simulator or RTL
implementations active is not sufficient.

The work is ordered so that no layer silently assigns two meanings to the same
instruction word.

#### Gate A — approve replacement encodings

Before changing executable code:

1. Approve the final 32-bit indexed/direct encoding for CALL.
2. Approve the final 32-bit indexed/direct encoding for LAMBDA.
3. Confirm the c-list row and method-selector ranges.
4. Decide whether opcodes 8 and 9 become permanent reserved faults or remain
   reserved for a future ISA revision.
5. Assign an ISA or binary-format version boundary that distinguishes old
   artifacts from the new encoding.

No old opcode may be reinterpreted as a new instruction without a version
gate.

#### Gate B — stop producing fused instructions

Update every source-producing path:

- CLOOMC++ lowering;
- symbolic assembler syntax and aliases;
- assembler pseudo-instruction expansion;
- examples, tutorials, and embedded source;
- boot and resident-LUMP generators;
- migration and fixture-generation scripts.

After this gate:

- no compiler or assembler emits opcode 8 or 9;
- named calls such as `Scheduler.pause` emit extended CALL;
- named lambda applications emit extended LAMBDA;
- explicit `ELOADCALL` and `XLOADLAMBDA` source causes a recompilation error;
- existing source is corrected manually before it is recompiled.

There is no automatic source migration or silent translation. Rejecting the
obsolete mnemonics makes every remaining use visible and prevents an encoding
or authority mistake from being concealed.

#### Gate C — migrate executable artifacts

The boot load contains exactly three LUMPs:

1. `CapabilityTest`
2. `SelfTest`
3. `WukongCallHome`

Their authoritative source is inspected and corrected manually. Each is then:

1. rebuilt with the approved compiler;
2. assigned freshly computed code size, c-list placement, identity, hashes,
   and seals;
3. localized with destination GTs;
4. placed in the regenerated boot image;
5. audited to prove that it contains no opcode 8 or 9.

No additional LUMP is admitted to the boot load in Phase 1.

Other source, examples, and tests that use a retired instruction are also
corrected manually. Any uncorrected source fails recompilation. An old binary
containing opcode 8 or 9 is not migrated or reinterpreted by the loader; it
cannot run on the new ISA.

#### Gate D — simulator and developer tools

Replace the separate fused execution paths with the approved dual-mode
behavior in CALL and LAMBDA:

- indexed mode reads implicit CR6 under virtual M;
- direct mode consumes the selected CR;
- the resolved E/X GT remains internal;
- CALL retains method dispatch;
- CALL/RETURN and LAMBDA/RETURN frame behavior remains architectural;
- opcodes 8 and 9 raise an unassigned/reserved-instruction fault.

Remove obsolete handling from:

- instruction decoding and dispatch;
- assembler and disassembler tables;
- instruction pickers and interactive references;
- pipeline diagrams and trace labels;
- LUMP audits and c-list-row validation;
- lazy-resolution routing;
- tutorials, examples, and API/reference data.

Tests that previously proved fused behavior must be replaced by tests proving
the corresponding indexed CALL or LAMBDA behavior. Merely deleting those tests
would leave the replacement unverified.

#### Gate E — synthesizable RTL

Remove the fused instructions from the Amaranth hardware design:

1. Remove ELOADCALL and XLOADLAMBDA opcode constants and decoder outputs.
2. Remove their dedicated FSMs and hardware submodules.
3. Remove their start, busy, reset, operand-latch, memory-bus arbitration,
   CR-write, NIA-write, fault, lazy-resolution, and trace wiring.
4. Extend the existing CALL and LAMBDA units with the approved indexed/direct
   mode decode.
5. Implement indexed CR6 reads through virtual M without generating an
   architectural L permission or writing the fetched GT to a general CR.
6. Preserve CALL method dispatch and protected frame semantics.
7. Make opcodes 8 and 9 enter the normal invalid/reserved-opcode fault path.
8. Update boot guards, trace-unit behavior, and version telemetry so they
   describe the new CALL/LAMBDA contract rather than fused-instruction support.

The dedicated fused-unit RTL file is deleted only after all live core profiles
stop importing or instantiating it.

#### Gate F — regenerate every live FPGA target

After the Amaranth source changes:

1. regenerate all actively synthesized Verilog and RTLIL outputs from the
   canonical Python sources;
2. verify their embedded source fingerprints;
3. confirm that generated RTL contains no ELOADCALL/XLOADLAMBDA decoder or FSM;
4. rebuild boot ROM and BRAM initialization content from the migrated images;
5. run synthesis, place-and-route, timing, and bitstream generation for each
   supported release target;
6. reject stale generated files, cached synthesis databases, or bitstreams;
7. produce fresh release provenance binding source commit, generated RTL,
   boot image, and bitstream digests.

The current Wukong release target must then be flashed with the newly generated
bitstream. A simulator-only pass does not complete this gate.

#### Gate G — cross-layer release verification

The retirement is complete only when one release candidate proves all of the
following:

- CLOOMC++ petname calls compile without fused opcodes;
- disassembly contains no opcode 8 or 9;
- canonical boot and resident LUMPs contain no opcode 8 or 9;
- simulator indexed CALL and LAMBDA pass authority, method, frame, return,
  lazy-resolution, and fault tests;
- RTL simulation matches those behaviors;
- generated Verilog/RTLIL contains no fused instruction implementation;
- FPGA synthesis and timing pass from fresh generated inputs;
- the physical Wukong board boots the migrated image;
- a petname CALL such as `Scheduler.pause` executes on the FPGA;
- indexed LAMBDA executes on the FPGA;
- trace packets and IDE state show the same CR6, CR14, frame, and NIA results as
  the simulator;
- deliberately executing opcode 8 or 9 faults as reserved on both simulator
  and FPGA.

Only after this cross-layer proof may documentation describe ELOADCALL and
XLOADLAMBDA as removed rather than deprecated.

### 9.2 Compatibility policy

Phase 1 proposes a clean version boundary:

- new source cannot name ELOADCALL or XLOADLAMBDA;
- new binaries cannot contain opcode 8 or 9;
- new simulator and FPGA releases fault on opcode 8 or 9;
- existing source is corrected manually and must then recompile cleanly;
- any remaining retired mnemonic causes a recompilation error;
- the boot load contains only `CapabilityTest`, `SelfTest`, and
  `WukongCallHome`;
- old binaries containing opcode 8 or 9 do not run on the new ISA;
- no loader, simulator, or FPGA may silently reinterpret an old instruction
  word.

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
5. Retire ELOADCALL and XLOADLAMBDA from source, compiler, assembler,
   simulator, developer tools, active binaries, boot images, RTL, generated
   Verilog/RTLIL, and released FPGA bitstreams.
6. Manually correct and rebuild the only three boot-loaded LUMPs:
   `CapabilityTest`, `SelfTest`, and `WukongCallHome`.
7. Make every remaining source use of a retired mnemonic fail recompilation.
8. Display verified petnames for all GT-bearing CRs in the IDE.
9. Display `Self`, `Self.Thread`, and `Self.Namespace` according to the active
   execution context.
10. Keep DRs numeric and unnamed.
11. Show unresolved identities explicitly and never reuse stale labels.
12. Align the interactive reference, ISA documents, simulator, assembler,
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

- [x] Petnames are the normal CLOOMC++ interface; registers and rows are
      compiler-managed.
- [x] `Scheduler.pause` resolves both an abstraction row and a method
      selector.
- [x] `Self`, `Self.Thread`, and `Self.Namespace` are reserved relative
      petnames.
- [x] C-list row zero is displayed as `Self`, not `Child[0]`.
- [x] `Caller` is a dynamic protected-frame relationship, not a permanent
      petname.
- [x] Every resolved GT in a Church CR may be displayed by petname.
- [x] Turing DRs remain numeric and unnamed in Phase 1.
- [x] Indexed CALL and LAMBDA use implicit CR6 through virtual M.
- [x] The indexed E/X GT remains internal and is not materialized in a
      programmer-visible CR.
- [x] Abstraction entry authority does not receive L permission.
- [x] Extended CALL replaces ELOADCALL.
- [x] Extended LAMBDA replaces XLOADLAMBDA.
- [x] Opcodes 8 and 9 fault as reserved in the new simulator and FPGA ISA.
- [x] Existing source is corrected manually; no automatic translation is
      provided.
- [x] Any remaining ELOADCALL or XLOADLAMBDA mnemonic causes a recompilation
      error.
- [x] The boot load contains exactly `CapabilityTest`, `SelfTest`, and
      `WukongCallHome`.
- [x] Those three LUMPs and the boot image are rebuilt and contain no opcode 8
      or 9.
- [x] Retirement is not complete until regenerated RTL and a fresh physical
      FPGA bitstream pass cross-layer verification.
- [ ] Final row/method/mode bit allocation requires a separate explicit
      encoding approval.

This architecture is approved. It supersedes conflicting design intent but
does not claim that the current implementation already conforms. Executable
changes remain blocked on the separate final row/method/mode bit-allocation
approval.