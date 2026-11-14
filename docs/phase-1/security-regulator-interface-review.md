# SecurityRegulator — consolidated interface review

**Review date:** 2026-11-14  
**Status:** Consolidation for review, not a new API approval, implemented method
table, ISA amendment, or authorization to alter saved artifacts or hardware.

This is the single review index for SecurityRegulator methods and signatures.
It preserves decisions already recorded in the source documents, distinguishes
proposed signatures from approved behavior, and identifies remaining choices.
No numeric method indices are assigned to the final `ide.SecurityRegulator`.

## Method and signature table

**Standard return policy for every API, not only SecurityRegulator:**
[Common API return status](01-isa/instruction-set.md#common-api-return-status)
requires DR1=0 for success; a nonzero DR1
is a returned fault code. HardFault follows the existing ISA fault path and is
not converted into a status return. DR1 inputs are consumed before DR1 becomes
the status result; GT results retain their specified capability destinations.
Signatures below describe functional results, with this common status implicit
(including methods marked `void`). SWITCHM returns status only upon completion
after restoration of its matching SYSTEM context. Numeric fault codes and
returnable failure cases remain to be specified; ISA/RTL are unchanged.

“Proposed” describes the published interface, not a rejection of behavior already
approved within it. “Required extension” means the behavior was requested but
its callable interface is not yet selected.

Evidence below names the **user (calling service)** and **reason for use**, not
the person requesting the feature. A documented use is not proof of an
implemented call or an additional authority grant. Where the review supplies
only a general capability, the missing concrete caller/use case is explicit.

| Method / signature / evidence | Settled behavior or operand decisions | Remaining choices / implementation specifications |
|---|---|---|
| **LOADM — proposed interface with approved inputs**<br>`LOADM(sourceGT, homeIndex) → valueGT`<br>[ISA A.2](01-isa/instruction-set.md#a2-loadm--m-assisted-capability-load) | Approved inputs: CR1=`sourceGT`, DR1=`homeIndex` (zero-based). Source-register M may replace the source L requirement, not other checks. Return the exact loaded GT, including NULL data, in CR1 with CR1.M clear, replacing the source argument. NULL source authority remains invalid. Caller preserves ordinary working values needed after the call; protected CALL/RETURN behavior is unchanged. | Document exact working-register clobbers; verify the return mask and exact M acceptance/clear points. |
| **SAVEM — proposed interface with approved inputs**<br>`SAVEM(destinationGT, homeIndex, valueGT) → void`<br>[ISA A.3](01-isa/instruction-set.md#a3-savem--m-assisted-golden-token-save); [operation-review corrections](security-regulator-operation-review.md) | CR1=`destinationGT`, DR1=`homeIndex`, CR2=`valueGT`. `valueGT` is a GT, not a DR integer or register number. Destination authority governs SAVE. Successful SAVE clears B only in the stored copy; source remains unchanged. | Complete clobber/return contract and M-state implementation boundaries. Reconcile historical source-B admission wording; do not reopen approved operand assignments. |
| **SWITCHM — approved inputs and continuation**<br>`SWITCHM(sourceCListGT, rowIndex) → context transfer`<br>[ISA appendix](01-isa/instruction-set.md#review-appendix-securityregulator-methods); diagnostic comparison below | Approved inputs: CR1=`sourceCListGT`, DR1=`rowIndex` (zero-based Namespace-GT row). SYSTEM Thread slot-2 handoff; after another SWITCHM restores its matching saved context, resume after SWITCH and RETURN to the original caller. No immediate return or automatic switch back. CR15.M is required; the source must have explicit L. Raw M remains private to SR. ISA and RTL are unchanged. | Specify clobbers and M setup/consumption; verify the saved continuation and return sequence. The diagnostic's fixed private binding does not replace the approved public inputs. |
| **MintM — approved argument/result registers**<br>`MintM(Ctype, Permissions, Slot) → GT`<br>[ISA construction discussion](01-isa/instruction-set.md); [construction-port clarification](../phase-2/gt-construction-port.md) | DR1=`Ctype`, DR2=`Permissions`, DR3=`Slot`; return GT in CR1. Constructs a GT; it does not allocate an object or increment its version. Approved for new Inform GTs: read the current version from the selected slot's valid live entry in the active Namespace, without refreshing an existing GT. The clarified mechanism packs DATA and reads it as a GT under monitor M, rather than using an ordinary scratch L grant. | Exact `GTvars`/field mapping, remaining identity-field derivation and type validation, clobbers and return preservation. Reconcile naming with SecurityMonitor `Create(GTvars)` without assuming an alias. |
| **MakeOutformM — indexed alternative under review**<br>Baseline: `MakeOutformM(sourceInformGT) → outformGT` in CR1<br>Alternative: DR1=`n`, convert caller's CR[n] in place; standard DR1 status<br>[ISA conversion discussion](01-isa/instruction-set.md) | User confirmed that the alternative selects the caller's CR[n], not the regulator's register. Original source GT remains mandatory. Earlier fixed CR1 convention remains the baseline pending alternative evaluation. Success replaces the selected GT and returns DR1=0. A returned software rejection leaves the selected GT unchanged and returns a nonzero fault code. | Verify caller-context access, result preservation and rejection behavior under existing ISA/RTL; settle allowed registers and numeric fault codes. HardFault retains the ISA fault path with no rollback guarantee. Conversion checks and M-use implementation remain open. |
| **MakeInformM — approved register signature**<br>DR1=`n`: convert caller's CR[n] from Outform to Inform in place; DR1 returns status<br>[ISA conversion discussion](01-isa/instruction-set.md) | Caller CR[n] supplies the original Outform GT and receives the corresponding Inform on success, with DR1=0. A returned software rejection leaves the selected Outform GT unchanged and returns a nonzero fault code. HardFault remains separate, without a rollback guarantee. A slot-only reconstruction is not equivalent. Lazy Load belongs to the original request, not SR. | Verify caller-context access, result preservation and rejection behavior under existing ISA/RTL; specify allowed registers, conversion checks, preserved/transformed fields, fault classification/codes, clobbers and M-use implementation. |
| **SetB — approved name and register signature**<br>DR1=`n`: set caller CR[n].B to 1; DR1 returns status<br>[B/F requirements](security-regulator-operation-review.md) | Explicitly set B to 1, not toggle. No DR2 value argument. Do not change unrelated GT fields or other copies. Success returns DR1=0. A returned software rejection leaves the selected GT unchanged and returns a nonzero fault code. HardFault remains separate, without a rollback guarantee. | Verify caller-register access, instruction mechanism and rejection effects under unchanged ISA/RTL; specify allowed registers, rejection conditions and numeric fault codes. |
| **ResetB — approved name and register signature**<br>DR1=`n`: set caller CR[n].B to 0; DR1 returns status<br>[B/F requirements](security-regulator-operation-review.md) | Explicitly set B to 0, not toggle. No DR2 value argument. Do not change unrelated GT fields or other copies. Ordinary movement rules remain separate. Success returns DR1=0. A returned software rejection leaves the selected GT unchanged and returns a nonzero fault code. HardFault remains separate, without a rollback guarantee. | Verify caller-register access, instruction mechanism and rejection effects under unchanged ISA/RTL; specify allowed registers, rejection conditions and numeric fault codes. |
| **SetNear — approved name and register signature**<br>DR1=`n`: set caller CR[n] to Near; DR1 returns status<br>[B/F requirements](security-regulator-operation-review.md) | Explicitly set F state to Near, not toggle or bypass a SAVE check. No DR2 value argument. Success returns DR1=0. A returned software rejection leaves the selected GT unchanged and returns a nonzero fault code. HardFault remains separate, without a rollback guarantee. | Verify exact F encoding, permitted targets, caller-register access, mechanism and rejection effects under unchanged ISA/RTL; settle rejection conditions and numeric fault codes. |
| **SetFar — approved name and register signature**<br>DR1=`n`: set caller CR[n] to Far; DR1 returns status<br>[B/F requirements](security-regulator-operation-review.md) | Explicitly set F state to Far, not toggle or bypass a SAVE check. No DR2 value argument. Success returns DR1=0. A returned software rejection leaves the selected GT unchanged and returns a nonzero fault code. HardFault remains separate, without a rollback guarantee. | Verify exact F encoding, permitted targets, caller-register access, mechanism and rejection effects under unchanged ISA/RTL; settle rejection conditions and numeric fault codes. |
| **Version increment — required extension; unnamed**<br>No selected signature<br>[version-increment requirement](security-regulator-operation-review.md); [lifecycle specification](../lazy-lifecycle-unified.md) | Increment the authoritative version associated with a supplied GT. Thread-reset use must invalidate old GTs through the Namespace entry. No wrap; inability to increment hard-faults. No hardware automatic version mutation or silent upgrade of existing holders. | Method name, argument/result registers, authorized descriptor update, and whether/how a new-version GT is returned. |

The six named methods are **not a closed inventory** after the B, F and
version-increment requirements. Watchdog-control ownership is specified
separately; that does not establish additional public method names or signatures.

### Expanded evidence: user and reason for each method

These entries expand the evidence in the table above without adding columns.
They separate an identified service use from a general requirement whose
specific caller still needs to be named.

#### LOADM — user and reason

- **User:** Mint and FreeHandler have approved invocation-grant designs, but that
  alone does not establish that either needs LOADM.
- **Reason:** Retrieve an existing GT when the approved access requires source
  M in place of L. This is retrieval, not construction or permission enlargement.
- **Why not ordinary LOAD?** Ordinary LOAD is sufficient wherever valid L already
  exists. FreeHandler's Inventory/directory scan is explicitly such a case;
  CR6.M C-list access is also a separate architectural exception, not a reason
  to call SR.
- **Evidence:** [LOADM contract](01-isa/instruction-set.md#a2-loadm--m-assisted-capability-load);
  [service-operation coverage](01-isa/instruction-set.md#a91-service-operation-coverage).
- **Usage still to justify:** Name the caller, source object and capability home
  that actually require this method rather than ordinary LOAD.

#### SAVEM — user and reason

- **User:** FreeHandler, when preparing an issued Thread for an application.
- **Reason:** Put the supplied application E-GT into saved CR1 (home 1) of the
  selected permission-free Thread GT:
  `SAVEM(ide.B1.FreeThread, 1, applicationE_GT)`.
- **Why not ordinary SAVE?** The proposed path removes the need for the separate
  `ide.B1.ThreadSetup S` grant by using SR's approved destination-M operation.
  Ordinary SAVE remains sufficient when the caller already holds destination S.
  Source B is not a reason to require this method.
- **Evidence:** [FreeHandler worked use](security-regulator-operation-review.md#freehandler-first-consumer-not-issuer-of-m-authority);
  [B1 call](security-regulator-operation-review.md#b1-call).
  The reviewed FreeHandler implementation still uses ThreadSetup S and ordinary
  SAVE; replacing it is a proposed adoption, not a completed implementation.
- **Boundary:** FreeHandler still selects the Thread, updates Block State and
  preserves values it needs after the call. SAVEM does not allocate the Thread.

#### SWITCHM — user and reason

- **User:** Amoeba in the mediated diagnostic; the final public caller/binding
  arrangement remains to be specified.
- **Execution Thread:** SWITCHM always uses the SYSTEM Thread in slot 2.
  It hands off to the destination Namespace's SYSTEM Thread in slot 2.
  Restoration of the outgoing SYSTEM Thread requires another SWITCHM; do not
  describe this as an arbitrary USER Thread switching or independently resuming.
- **Transactional preservation:** The ISA automatically saves transactional
  state and restores its matching context. SWITCHM does not add a separate
  caller-save requirement for that state.
- **Reason:** Hand execution to another Namespace's fixed entry Thread while
  keeping the raw M-control grant private to SecurityRegulator.
- **Why not ordinary CHANGE?** CHANGE changes Threads, not Namespace roots.
  SWITCH requires CR15.M and explicit source L; SR supplies the bounded M
  operation rather than distributing its raw M-control grant.
- **Evidence:** [mediated Amoeba fixture](../phase-2/cooperative-retry/candidate_mediated_fixture.py);
  [diagnostic SwitchM implementation](../phase-2/cooperative-retry/candidate_regulator_switch.cloomc).
  Amoeba calls diagnostic method 0; private SR C-list row 2 supplies the peer
  Namespace. This does not establish the proposed source/row public ABI.

#### MintM — user and reason

- **User:** Mint, as the service issuing a GT for its allocated/bound object.
- **Reason:** Materialize a new Golden Token from explicit type, permissions and
  slot information under the trusted construction mechanism.
- **Why not LOADM or ordinary LOAD?** Those retrieve an existing GT. This method
  constructs one; the clarified mechanism packs DATA and reads it as a GT under
  monitor M, rather than granting ordinary L access to writable result storage.
- **Evidence:** [construction contract and Mint responsibilities](01-isa/instruction-set.md#a7-mintm--golden-token-construction);
  [construction-port clarification](../phase-2/gt-construction-port.md).
- **Boundary:** Mint owns allocation, slot lifecycle and publication. MintM does
  not perform them. The relationship to SecurityMonitor `Create(GTvars)` still
  needs reconciliation; FreeHandler is not thereby granted unrestricted
  construction.

#### MakeOutformM — user and reason

- **User:** Mint, in its Inform-to-Outform conversion responsibility.
- **Reason:** Produce an Outform representing the same living object as the
  supplied Inform, retaining source identity evidence rather than rebuilding a
  token from a slot number.
- **Why a separate method?** MintM has no source-GT argument and cannot stand in
  for identity-preserving conversion. Mechanical conversion does not itself
  establish preserved backing or release local storage.
- **Evidence:** [source-required conversion contract](01-isa/instruction-set.md#a8-inform--outform-conversion--source-gt-required);
  [Mint conversion coverage](01-isa/instruction-set.md#a91-service-operation-coverage).
- **Usage still to specify:** The concrete Mint workflow/call site and the
  backing/binding conditions under which conversion is requested.

#### MakeInformM — user and reason

- **User:** Mint, in its Outform-to-Inform conversion responsibility.
- **Reason:** Produce an Inform for the same living object identified by the
  supplied Outform, with the required local binding established or reused.
- **Why a separate method?** Constructing a fresh token from a slot would discard
  the source's identity evidence and could incorrectly refresh a stale reference.
  Mint must resolve the living object and arrange its local binding separately.
- **Lazy Load boundary:** Lazy Load belongs to the original request, not SR.
  The approved MakeInformM register signature does not authorize an implicit
  fetch/load. Missing-binding behavior remains a separate review question.
- **Evidence:** [source-required conversion contract](01-isa/instruction-set.md#a8-inform--outform-conversion--source-gt-required);
  [Mint resolution/binding coverage](01-isa/instruction-set.md#a91-service-operation-coverage).
- **Usage still to specify:** The concrete Mint workflow/call site and the
  admissible source and destination-binding conditions.

#### SetB and ResetB — user and reason

- **User:** A specifically authorized caller has not yet been named for this
  operation. The compiler's ESaveLists workflow is cited as needing returned
  GTs, but that is not evidence of a SetB or ResetB invocation.
- **Reason:** SetB explicitly sets B to 1; ResetB explicitly sets B to 0 in the
  caller's CR[n], selected by input DR1. Neither changes unrelated fields or
  other copies. Separate methods avoid a DR2 value argument; DR1 returns the
  common status.
- **Why a separate method?** LOAD preserves B; CALL clears passed argument B;
  RETURN preserves B in kept CRs; SAVE clears B in the stored copy. None is a
  general explicit setter for both values. In particular, source B=0 does not
  prevent SAVE and is not a justification for invoking SR.
- **Evidence:** [B-setter requirement, movement corrections and ESaveLists context](security-regulator-operation-review.md).
- **Usage still to justify:** Name the caller and the operation that needs an
  explicit B=1 or B=0 result, independently of ordinary movement rules.

#### SetNear and SetFar — user and reason

- **User:** No concrete calling service or call site is named in the requirement.
- **Reason:** SetNear explicitly selects Near; SetFar explicitly selects Far
  for the caller's CR[n], selected by input DR1. Neither toggles state or
  bypasses a SAVE check. No DR2 value argument; DR1 returns common API status.
- **Why a separate method?** The requested operation is deliberate F setting,
  not an incidental effect of SAVEM or Inform/Outform conversion. The cited
  requirement does not establish those operations as substitutes.
- **Evidence:** [explicit Near/Far requirement](security-regulator-operation-review.md).
- **Usage still to justify:** Name the caller, target and situation requiring
  Near versus Far, then settle the target encoding and mechanism.

#### Version increment — user and reason

- **User:** Authorized USER-Thread reset software in the Phase 2 lifecycle;
  the concrete calling abstraction has not yet been selected.
- **Reason:** Increment that Thread's authoritative Namespace-entry version
  before the reset context becomes eligible, so retained pre-reset GTs cannot
  activate or complete work against the replacement context.
- **Why not edit a GT copy or use MintM?** Editing one copy does not invalidate
  other holders. MintM constructs a token but does not change the authoritative
  version. Hardware checks versions and must not increment them automatically.
- **Evidence:** [Thread-reset invalidation and requested SR companion](../lazy-lifecycle-unified.md);
  [version-method requirement](security-regulator-operation-review.md).
- **Boundary:** No wrap, no silent upgrade of old holders, and no change to other
  Threads or the requested target LUMP. New-context GT provisioning and the
  exact caller/ABI remain open.

## Common contract: settled versus open

The DR1 standard applies independently of the indexed MakeOutformM alternative:
status is approved for every API method, while caller-register access remains under
review. It supersedes older “no success flag” wording and any description of
DR1 status as merely proposed. It does not authorize catching HardFault.

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
| ISA review appendix | `SWITCHM(sourceCListGT, rowIndex)` | Approved inputs: CR1 source C-list GT, DR1 zero-based Namespace-GT row. RETURN after another SWITCHM restores the matching SYSTEM Thread context. |
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

1. **Switching implementation:** verify the approved RETURN after restoration
   of the matching SYSTEM context. CR1 source/DR1 row inputs are approved; resolve the conceptual
   `SwitchNamespace` name's disposition without reopening those assignments.
2. **Complete callable ABI:** argument/result registers, clobbers, preservation
   masks and final method indices. Preserve already-approved SAVEM operands.
3. **Required extensions:** SetB/ResetB names and DR1 signatures are approved;
   verify their mechanism and unchanged-GT rejection effect; settle allowed
   registers and rejection conditions.
   SetNear/SetFar names and DR1 signatures are approved; verify their encoding,
   permitted targets, mechanism and unchanged-GT rejection effect; settle
   rejection conditions and numeric codes.
   Choose the version-increment name/signature and mechanism.
4. **Construction/conversion details:** reconcile `MintM` with `Create(GTvars)`,
   specify identity-field handling and precise conversion rules.
5. **Common implementation contracts:** finish invocation/proof propagation,
   M-state timing and context-transfer continuation without introducing a
   reporting dependency.

Implementation, compiler/API registration, saved binaries, bindings and
hardware qualification are subsequent engineering work, not additional
semantic approvals inferred from this consolidation.
