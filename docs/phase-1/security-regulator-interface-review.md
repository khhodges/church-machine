# SecurityRegulator — consolidated interface review

**Review date:** 2026-11-14  
**Status:** Consolidation for review, not a new API approval, implemented method
table, ISA amendment, or authorization to alter saved artifacts or hardware.

This is the single review index for SecurityRegulator methods and signatures.
It preserves decisions already recorded in the source documents, distinguishes
proposed signatures from approved behavior, and identifies remaining choices.
No numeric method indices are assigned to the final `ide.SecurityRegulator`.

## Method and signature table

“Proposed” describes the published interface, not a rejection of behavior already
approved within it. “Required extension” means the behavior was requested but
its callable interface is not yet selected.

| Method / requirement | Published functional signature | Settled behavior or operand decisions | Remaining choices / implementation specifications | Evidence |
|---|---|---|---|---|
| LOADM — proposed interface | `LOADM(sourceGT, homeIndex) → valueGT` | Source-register M may replace the source L requirement, not other checks. Return the exact loaded GT, including NULL data, in CR1 with CR1.M clear. NULL source authority remains invalid. | Confirm proposed entry CR1=`sourceGT`, DR1=`homeIndex`; working-register clobbers, preservation mask and exact M acceptance/clear points. | [ISA A.2](01-isa/instruction-set.md#a2-loadm--m-assisted-capability-load) |
| SAVEM — proposed interface with approved inputs | `SAVEM(destinationGT, homeIndex, valueGT) → void` | CR1=`destinationGT`, DR1=`homeIndex`, CR2=`valueGT`. `valueGT` is a GT, not a DR integer or register number. Destination authority governs SAVE. Successful SAVE clears B only in the stored copy; source remains unchanged. | Complete clobber/return contract and M-state implementation boundaries. Reconcile historical source-B admission wording; do not reopen approved operand assignments. | [ISA A.3](01-isa/instruction-set.md#a3-savem--m-assisted-golden-token-save); [operation-review corrections](security-regulator-operation-review.md) |
| SWITCHM — proposed interface | `SWITCHM(sourceCListGT, rowIndex) → context transfer` | Fixed Namespace entry-Thread transfer, not an ordinary immediate return. CR15.M is required; the source must have explicit L. Raw M remains private to SR. | Decide whether the final public interface accepts the proposed CR1 source/DR1 row or uses a privately provisioned fixed next-Namespace binding. Specify clobbers, continuation and M consumption. The diagnostic does not settle this public ABI. | [ISA appendix](01-isa/instruction-set.md#review-appendix-securityregulator-methods); diagnostic comparison below |
| MintM — proposed interface | `MintM(Ctype, Permissions, Slot) → GT` | Constructs a GT; it does not allocate an object or increment its version. The clarified mechanism packs DATA and reads it as a GT under monitor M, rather than using an ordinary scratch L grant. | Final argument/result registers, exact `GTvars`/field mapping, identity-field derivation and type validation, clobbers and return preservation. Reconcile naming with SecurityMonitor `Create(GTvars)` without assuming an alias. | [ISA construction discussion](01-isa/instruction-set.md); [construction-port clarification](../phase-2/gt-construction-port.md) |
| MakeOutformM — proposed interface | `MakeOutformM(sourceInformGT) → outformGT` | Original source GT is mandatory; a slot-only reconstruction is not equivalent. | Argument/result registers, precise conversion checks and preserved/transformed fields, clobbers and M-use implementation. | [ISA conversion discussion](01-isa/instruction-set.md) |
| MakeInformM — proposed interface | `MakeInformM(sourceOutformGT) → informGT` | Original source GT is mandatory; a slot-only reconstruction is not equivalent. | Argument/result registers, precise conversion checks and preserved/transformed fields, clobbers and M-use implementation. | [ISA conversion discussion](01-isa/instruction-set.md) |
| Explicit B setter — required extension; unnamed | No selected signature | Set the supplied GT's B to **0 or 1**, not toggle. Do not change unrelated GT fields or other copies. Ordinary movement rules remain separate. | Method name, target/result convention, registers and instruction mechanism. | [B/F requirements](security-regulator-operation-review.md) |
| Explicit F setter — required extension; unnamed | No selected signature | Explicitly set **Near or Far**, not toggle or merely bypass a SAVE check. | Method name, precise target/encoding, argument/result registers and mechanism. | [B/F requirements](security-regulator-operation-review.md) |
| Version increment — required extension; unnamed | No selected signature | Increment the authoritative version associated with a supplied GT. Thread-reset use must invalidate old GTs through the Namespace entry. No wrap; inability to increment hard-faults. No hardware automatic version mutation or silent upgrade of existing holders. | Method name, argument/result registers, authorized descriptor update, and whether/how a new-version GT is returned. | [version-increment requirement](security-regulator-operation-review.md); [lifecycle specification](../lazy-lifecycle-unified.md) |

The six named methods are **not a closed inventory** after the B, F and
version-increment requirements. Watchdog-control ownership is specified
separately; that does not establish additional public method names or signatures.

## Common contract: settled versus open

| Area | Preserve as settled | Still to specify or verify |
|---|---|---|
| Authority | Genesis/IDE configuration provisions M custody exclusively to SecurityRegulator for the next candidate. SR is a digital mechanism, not a caller-purpose policy engine. An invocation grant is not an implementation. | Concrete private grants, destination bindings and final implementation evidence. |
| M lifetime | M is register state, not transported in a GT. Boot and automatic CR6.M C-list access are distinct exceptions. Relevant SR M authority is consumed on successful or failed use; unrelated M state is not indiscriminately cleared. | Exact latch/clear points, skipped-instruction behavior and conformance evidence. |
| Identity | Originating credential attribution, immediate caller and CR5 tuple `TransactionID` are distinct. Audit identity is non-secret; it is not the Passcode and grants no authority. | Credential/proof encoding, propagation, verification ABI and replay handling. Do not equate Passkey and Passcode terminology without a decision. |
| Reporting | **The IDE may not exist. Reporting is optional observation outside execution. No reporting wait, preauthorization, stall or fault for absent/failed/unacknowledged delivery.** Existing authority governs execution. | Optional report content/transport implementation. None may become an execution prerequisite. |
| Placement | Amoeba and SecurityRegulator are Resident in each of the two Namespaces, with separate local copies/bindings. | Actual saved SR binary, exact extent, local bindings and runnable-image qualification. Residency does not manufacture a callable API or memory size. |

The reporting rule above is the explicit **2026-11-14 correction** in the
[operation review](security-regulator-operation-review.md). It supersedes the
older mandatory delivery, receipt-before-operation, local-recording-before-effect
and reporting-fault interpretations. Retaining historical attribution proposals
does not restore those execution gates.

## Switching references are not interchangeable

| Reference | Interface actually shown | Meaning / limitation |
|---|---|---|
| ISA review appendix | `SWITCHM(sourceCListGT, rowIndex)` | Proposed general source/row interface. |
| [candidate source](../phase-2/cooperative-retry/candidate_regulator_switch.cloomc) | `candidate.SecurityRegulator.SwitchM()` | Executable diagnostic with no explicit arguments. Private C-list row 1 holds M-control; row 2 holds the next-Namespace GT. Explicitly not a complete SR. |
| [mediated fixture](../phase-2/cooperative-retry/candidate_mediated_fixture.py) | Amoeba loads its SR E-GT and calls method **0** | Numeric index belongs to that diagnostic binary only; it is not the final API's method-number assignment. |
| [Namespace concept review](../reviews/current-namespace-abstraction.md) | `SecurityRegulator.SwitchNamespace(Boot.NS, Passkey)` | Conceptual orchestration example, not a compiled ABI or alias of either interface above. |

Historical `LoadM(...)`, `SaveM(...)`, `SaveB` and raw M-control discussions in
the operation review remain review history. Do not silently turn spelling
variants or candidate families into exported methods.

## Current implementation evidence

- A complete saved `ide.SecurityRegulator` compilation and method table were
  not present in the audited library.
- The diagnostic `candidate.SecurityRegulator` implements only the bounded
  switching mechanism. Its existence does not establish LOADM, SAVEM,
  construction, conversion, B/F setters or version-increment implementations.
- SecurityMonitor `Create(GTvars)` has separate construction references.
  Shared mechanism intent does not prove identical public names or signatures.
- Namespace Resident entries are configuration intent. They do not prove a
  compiled method signature, executable readiness, or FPGA installation.

## Remaining review choices, in dependency order

1. **Public switching interface:** explicit source/row versus private fixed
   peer binding; resolve the conceptual `SwitchNamespace` name's disposition.
2. **Complete callable ABI:** argument/result registers, clobbers, preservation
   masks and final method indices. Preserve already-approved SAVEM operands.
3. **Required extensions:** choose B-setter, F-setter and version-increment
   names/signatures and their exact operation mechanisms.
4. **Construction/conversion details:** reconcile `MintM` with `Create(GTvars)`,
   specify identity-field handling and precise conversion rules.
5. **Common implementation contracts:** finish invocation/proof propagation,
   M-state timing and context-transfer continuation without introducing a
   reporting dependency.

Implementation, compiler/API registration, saved binaries, bindings and
hardware qualification are subsequent engineering work, not additional
semantic approvals inferred from this consolidation.
