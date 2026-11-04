# SecurityRegulator — machine-operation review

**LOAD B decision:** LOAD ignores B as a condition and copies the loaded
GT's B unchanged. Neither ordinary nor M-assisted LOAD grants or consumes B;
other LOAD validation remains applicable.

**Latest conceptual correction:** B is a GT setting defining movement,
not a source/destination property or a hardware-register M setting. Do not
infer a CALL clearing rule from the user's correction. The preceding
multiple-RETURN/private-sharing explanation has been corrected; use the
explicit CALL and RETURN decisions below instead.

**CALL argument decision:** B=0 does not prohibit an argument GT from
crossing CALL. This does not override explicit argument clearing or other
CALL checks. A passed argument with B=1 has B cleared to 0; B=0 remains 0.
Passed argument GTs therefore arrive with B=0. This does not change M behavior.

**RETURN decision:** Deliberately returned GTs in kept CRs retain B unchanged:
0 remains 0 and 1 remains 1. Repeated RETURNs preserve it while the GT is kept;
an intervening CALL applies its own rule. Cleared CRs are not restored.

**Latest correction — source bits do not authorize SAVE:** The source GT's
bits, including B, have zero effect on SAVE admission. Source B=0 does not
require SR access. Destination authority governs the write; source GT remains
unchanged and stored GT has B=0 with other fields preserved. This supersedes
the historical source-B requirement and SR B-override discussion below.
Existing implementation checks must be reconciled, not treated as this rule.

**Subsequent B/F requirement:** The user requires SecurityRegulator methods
for B and F. Resolve their intended operations before choosing signatures or
changing SAVEM checks. SR must explicitly support setting a GT's B to 1 or 0,
not merely toggling it. This supersedes the earlier B-override-only proposal.
The operation is separate from CALL/SAVE/RETURN movement rules; its method
name, register ABI and mechanism remain to be specified. The common SR
invocation, M-consumption and Passcode/Home IDE audit requirements apply.
This does not authorize changes to other GT fields or other copies.
F must explicitly set Near or Far, not toggle
state or override its SAVE check. Its target, encoding and exact interface
details remain open.
The earlier six-method completeness discussion is
historical, not a restriction against these requested additions.

**B versus M access:** The user clarified that B and M do not coincide in
every situation and not all callers have SR access rights. Preserve ordinary
B-authorized SAVE without requiring SR. Do not infer M or SR invocation
authority from B, or declare a SaveB interface redundant solely because
SAVEM can override a transfer check. Its interface disposition remains open.

**B lifetime review:** The compiler's ESaveLists workflow requires returned
GTs. Apply the explicit CALL/RETURN decisions above, rather than the
earlier corrected private-sharing explanation.
Successful SAVE clears B in the stored GT only. The source CR retains B
and can supply further SAVEs subject to destination authority and checks. Other
stored GT fields remain unchanged. Failed-SAVE behavior remains unresolved.
Source B may start at 1 or 0 and remains unchanged; stored B is zero for
either authorized case. Source bits, including B, do not authorize SAVE.
This supersedes earlier exact-copy wording; do not reuse M's
fault-consumption semantics for B.

**Status:** First-pass architectural review, 2026-11-02. Proposed software
interfaces, not an ISA amendment, implemented API or hardware qualification.

**Current method proposal:** see the Master ISA's
[SecurityRegulator review appendix](01-isa/instruction-set.md#review-appendix-securityregulator-methods)
for LOADM, SAVEM, SWITCHM, MintM, MakeOutformM and MakeInformM.
The broader candidates below are investigation
history, not additional selected methods.

**Coverage result:** [Appendix A.9](01-isa/instruction-set.md#a9-six-method-coverage-review)
maps the identified Mint/FreeHandler functions to these six methods or ordinary
operations. It retains a concrete open descriptor-M-window case; no seventh
method or universal completeness claim is justified by this static review.

**Subsequent construction decision:** `MintM(Ctype, Permissions, Slot) -> GT`
adds Golden Token construction. The user requires correction of blocking
Phase I M-bit limitations. See appendix A.7 for construction versus allocation,
unresolved identity fields, mechanism changes and audit requirements.

**Conversion distinction:** MakeOutformM and MakeInformM require the original
source GT, unlike MintM. Appendix A.8 makes that input mandatory; conversion
must not discard source identity evidence and reconstruct from a slot alone.

**Audit requirement:** Every SecurityRegulator action is logged in detail
against the Passcode and sent to the Home IDE, including unsuccessful actions.
The appendix records proposed audit fields and open delivery semantics.
This is accountability, not an added policy engine; secret credential values
must not be confused with the audit identity.

## Authority and purpose

**Approved M scope/lifetime clarification (2026-11-02):** CR6.M is automatic
execution-context C-list authority, persists across ordinary LOADs, and does
not use SecurityRegulator. Boot is also outside SR and retains its defined
trusted bootstrap authority and lifecycle, without granting that authority
to ordinary code. Outside Boot and CR6.M, M use is confined to the six agreed SR
methods and consumes the relevant M state on use, whether successful or failed.
This supersedes earlier open success/failure-lifetime questions below, not
the need to verify exact implementation boundaries or resolve skipped
instructions. Historical M-window/Abstract-dispatch paths are not additional
exceptions authorized by this review; reconcile them against this rule.

The [Master ISA](01-isa/instruction-set.md) is authoritative. Its approved
corrections override older reference tables and implementation behavior.
The user's current direction defines SecurityRegulator as a pure digital
mechanism: held authority expresses trust; the mechanism does not adjudicate
caller purpose, Block ownership or application policy.

Do not add a policy engine, per-target approval database or Thread-specific
constructor. Do not silently import a historical Passkey/proof scheme into
this interface. Invocation representation and any existing credential
mechanics must be stated explicitly before choosing a concrete ABI.

Babbage's historical term was **regulator**, not SecurityRegulator. His
industrial regulation examples motivate deterministic mechanisms, not the
particular M semantics proposed here.

## Evidence classes

- **Defined:** a requirement in the Master ISA.
- **Proposed:** a candidate software interface or behavior requiring closure.
- **Observed:** a static implementation reading, not a conformance result.
- **Open:** no complete normative operation/test oracle established here.

No method below gains approval merely because it appears in the matrix.
No global simulator privilege flag is an acceptable substitute for specifying
individual architectural M effects.

## Operation matrix

| Family / candidate | Defined machine baseline | M role and interface disposition |
|---|---|---|
| `SaveM(target, home, valueGT)` | SAVE requires destination S and source B, with mSave validation; Abstract PassKey handling is separately specified | **Proposed.** Resolve destination M permission override separately from source-transfer M effects. Neither full scope nor success/fault lifetime is established by this review. First worked case below. |
| `LoadM(source, home)` | LOAD uses mLoad through source capability; authorized NULL data discards destination authority, but NULL is not access authority; CR6 context exception is not general | **Proposed.** Establish which source/destination M effects apply, legal destination registers, consumption and how the result survives return. Never infer arbitrary register access. |
| Isolated-register read/export | Operand restrictions and instruction-specific checks still apply | **Open interface.** Simulator SAVE recognizes source M for CR12–CR15, but that observation does not establish an unrestricted ReadRegister API. Trace exact ISA authority before exposing it. |
| Thread handoff / CHANGE | One supplied permission-free Thread GT; fixed activation destination CR12; no general operand-M requirement; CHANGE CR13 is INVALID_OP | **Defined ordinary mechanism, not a new ChangeM privilege.** Microcode performs protected context save/restore. A wrapper must not claim to add authority or promise ordinary return. |
| Namespace handoff / SWITCH | Fixed CR15/CR12 destinations; accepted CR15.M required; source is CR0–CR11 with explicit L, which source M cannot replace | **Candidate wrapper around defined operation.** Successful handoff consumes CR15.M; validate source before outgoing save; failures hard-fault and no rollback is promised after save starts. Not generic isolated-register installation. |
| Explicit M-control write | Existing M-control implementation is evidence, not sufficient normative API definition | **Open.** Specify control-word fields, supported readback, unrelated-bit preservation, latch point and lifecycle before offering SetM/WriteM. Do not assume setting M then returning transports it to the caller. |
| Watchdog control/status | Approved separate MMIO control word: bit 0 exemption, bits 2:1 duration, bits 31:3 reserved zero; selection alone does not refresh deadline | **Possible thin control interface.** Use exact word semantics and approved renewal events. A standalone RefreshWatchdog method is not established by these rules. |
| Other hardware settings/status | Only explicitly defined fields/ports exist | **Open, no wildcard API.** Enumerate supported fields and read/write effects. Do not expose arbitrary control words under the name of regulation. |

### Coverage boundary

This is the requested first review set, not proof of a complete M inventory.
Before declaring completeness, audit CALL/RETURN, LAMBDA, fetch, data access,
reset/fault transitions and every RTL M consumer. Each must be classified as
an exposed primitive, an internal architectural transition, or not M-controlled.
Do not create a public privileged method for every instruction by analogy.

## First worked case: SaveM

**Subsequent approved decision:** destination-register M replaces destination
S, while identity, generation, integrity, bounds and protected-home checks
remain. Consume the used destination M on success or failure. `valueGT` is
held in CR2 under the approved input assignment, not a DR scalar; SAVE stores
its GT, never its M setting. The latest source and stored-B rules are recorded
in Appendix A.3; older source B/F questions below are historical. Appendix A.3 records
the current contract; earlier open destination-permission questions below
are retained as review history, not unresolved approval.

### Functional proposal

```text
SaveM(destinationGT, homeIndex, valueGT) -> normal completion or machine fault
```

The index is a capability-home index, not an arbitrary word address.
The write stores the supplied GT with B cleared in the stored copy, preserving
all other fields; it does not upgrade permissions.
No allocation, activation, generation change or policy decision is included.

**Return contract retained:** Successful SAVEM returns normally with no result
value or success flag. Failed SAVE follows the defined machine-fault path, not
a successful return. This is not completion of FreeHandler's wider allocation
bookkeeping. Audit-delivery failure behavior remains a separate review item.

**Approved operand inputs:** this freezes only the three assignments below,
not the method selector, audit inputs, preservation or return contract.

| Register | Input |
|---|---|
| CR1 | Destination GT |
| CR2 | Value GT |
| DR1 | Home index |

**Approved preservation responsibility:** The caller preserves working values
needed after SAVEM, including FreeHandler's selected Thread GT, Block State GT
and application GT. SAVEM does not promise preservation of ordinary working
registers. This does not change protected CALL/RETURN behavior or authorize
temporary M authority to escape. The exact clobber set and supported
save/restore sequence remain to be specified.

An `ide.SecurityRegulator E` invocation grant is approved for explicit
provisioning to Mint and FreeHandler, not an assertion that this saved artifact
exists. Define method selector,
clobbers, result registers and CALL/RETURN effects before implementing it.

### B1 call

```text
destinationGT = ide.B1.FreeThread
homeIndex     = 1
valueGT       = supplied application E-GT

intended effect:
    ide.B1.FreeThread.savedCR1 <- exact application E-GT
```

FreeHandler still selects the available Thread, maintains `ide.B1.State` and
returns its permission-free Thread GT. SecurityRegulator does not select a
Block or mark an object issued. No concurrency or allocation rollback is
implied by a single SAVE.

If the complete M operation supports this write, revise the Inventory to
remove its redundant `ide.B1.ThreadSetup S` reference. Until then, preserve
existing saved artifacts; do not claim the replacement is operational.

### Required machine decisions

| Question | Required resolution |
|---|---|
| Destination permission | Which operand register's M permits writing through the permission-free Thread GT? |
| Source transfer | Does this operation use only destination elevation, or also source elevation affecting B/F checks? Specify each separately; no implicit blanket bypass. |
| Target layout | How is home 1 resolved under the canonical Thread layout, and which homes are writable under this operation? |
| Remaining checks | State the disposition of NULL, GT form/domain, identity/version, integrity, bounds, SELF and other protected locations individually. |
| M lifetime | Specify acceptance, success, pre-write fault, post-write fault, control transfer, reset and watchdog behavior for the relevant M states. |
| Return behavior | Which result and registers survive normal return? Do not equate return with exporting temporary M. |
| Write boundary | Identify accepted operands and the observable write. Do not promise atomic multi-operation allocation or restoration after a fault. |

The earlier normal-return/no-export description is an intended interface
property, not a settled CALL/RETURN oracle: the Master explicitly lists
CALL/RETURN M effects among unresolved baseline corners.

## Implementation observations, not architectural rulings

Read-only inspection found:

- `simulator/simulator.js`, `_execSave`: isolated source CR12–CR15 M is
  recognized separately; source transfer goes through `mSave`; the destination
  then goes through `mLoad(..., 'S', ...)`. The implementation rejects row zero
  as immutable SELF before these checks.
- `mSave`: source elevation can affect B/F transfer checks.
- `mLoad`: its permission condition includes a simulator-wide `mElevation`
  escape. This is not evidence that the target register's M implements SaveM.
- `_execSave` consumes isolated source M on successful completion when not
  using global elevation. This alone says nothing about target M consumption.
- `simulator/device_abstractions.js` models a whole-word M-control interface.
  A general control setter must account for that write granularity rather
  than assume a per-bit operation is already architectural.

No simulator probes, RTL conformance tests or board tests were run for this
review. Current implementation must be compared with the resolved contract,
not used to settle it.

## Corrections to earlier hypotheses

**Watchdog interface clarification:** The user describes the watchdog timer
as an MMIO capability with **RW access to set the next time interval**.
Possession of its W authority permits the defined interval-setting write;
R permits reading the defined register value, not an assumed remaining-time
counter. This is ordinary capability-mediated device access, not inherently
an M-elevated instruction or a separate policy decision by SecurityRegulator.
A wrapper, if useful, exposes that mechanism rather than adding approval.
“Next interval” does not by itself authorize refreshing the active deadline,
selecting arbitrary time units/ranges, or changing the approved MMIO encoding.

1. **CHANGE is not generally M-gated.** Do not introduce a new requirement.
2. **SWITCH is not WriteAnyRegister.** It has fixed destinations and requires
   explicit source L even when source M is set.
3. **Watchdog refresh is not an arbitrary control write.** The Master defines
   a watchdog word independently of earlier discussion placing watchdog
   functions in the upper half of an M-control word. Do not merge those layouts.
   A selector-only write does not renew the active interval.
4. **Source M and destination M are not interchangeable.** A source-export
   implementation does not prove permission-free Thread initialization.
5. **CALL/RETURN is not an assumed M transport mechanism.** Reconcile its
   exact effects, including the CR13 reservation, before freezing wrappers.

## Acceptance plan after contract closure

Build an expected-outcome table before writing implementation tests:

- SAVE: source M 0/1 crossed with destination M 0/1, S present/absent,
  source B present/absent and relevant F cases; define expected results first.
- Exact supplied GT stored at home 1; unrelated objects/homes unchanged.
- NULL, malformed, stale and out-of-range operands; protected-home cases.
- Operand aliasing and changed live operands during multicycle execution:
  accepted operands determine the operation.
- Success, predication skip, fault and watchdog boundaries: compare M states
  and any committed write without inventing rollback.
- LOAD: authorized NULL versus NULL access authority; legal destinations;
  result survival through the agreed wrapper.
- CHANGE: no added M requirement; CR13 still rejected.
- SWITCH: CR15.M absent/present; source M cannot substitute for L; fixed
  destinations and consumption on success.
- Watchdog: reserved-bit rejection, selector-only non-renewal and approved
  exemption/deadline transitions.

Apply the same closed expectations independently to simulator and RTL.
Hardware claims require the exact installed build and observed results.
Retain failed/counterexample evidence, not only passing demonstrations.

## Next review item

Proceed from LOADM, one decision at a time. The user approved source-register
M replacing LOAD's L permission requirement, without bypassing identity,
generation, integrity, bounds or protected-register checks; see appendix A.2.
Stored NULL remains valid data, NULL source remains invalid authority, and
loaded permissions remain unchanged. Success/failure consumption and the
independent persistent CR6.M exception are now approved; exact implementation
boundaries and result-return ABI remain to be resolved. Then address SAVE
destination-M and source-transfer scope.
Implement only resolved contracts, without a global privilege shortcut.
No new caller-purpose policy is required.

## Mint and FreeHandler authority review

**Status:** Static source/contract review, 2026-11-02; no runtime or hardware
qualification and no saved-artifact migration.

### Four distinct concepts

| Item | Meaning | Custody / use |
|---|---|---|
| M-control GT | Capability addressing the hardware control object; not an M bit embedded in a GT | Intended private regulator authority; concrete canonical name/binding remains to be established |
| `ide.SecurityRegulator E` | Capability to invoke the regulator's methods; concrete binding/ABI still pending | Explicit IDE/Builder provisioning to Mint and FreeHandler approved as a design |
| CRn.M | Actual architectural register state | Established/consumed by the specified operation; not an issued GT permission |
| Passcode audit identity | Identity against which regulator actions are recorded and sent Home | Must remain attributable across nested service calls; exact representation/ABI not yet selected |

Do not call all four “the M-bit GT.” Granting a consumer regulator E is itself
a substantial authority grant, not a harmless wrapper: the methods are general
mechanisms with no hidden per-target policy. Keeping raw device authority
private provides an operation/audit boundary, not proof that a consumer cannot
request a powerful action.

### Intended relationship

**Approved provisioning design (2026-11-03):** The trusted IDE/Builder
explicitly binds the raw M-control capability into SecurityRegulator's private
C-list when preparing the Namespace. Ordinary Mint allocation and FreeHandler
allocation neither create nor distribute this capability; SecurityRegulator
does not acquire it automatically at runtime. Boot and automatic CR6.M retain
their separately defined exceptions.

This approves the design only, not implementation, saved-artifact migration,
activation or hardware changes. The canonical binding and verification of
Mint's Namespace-write reach remain open; intended private custody is not
proof that the implementation prevents another access path.

```text
Trusted provisioning
    -> raw M-control GT held by SecurityRegulator
    -> regulator invocation GT held by explicitly trusted consumers

Mint or FreeHandler
    -> regulator method + explicit operands + Passcode audit association
    -> defined LOAD / Golden Token Save / SWITCH effect
    -> detailed action/outcome record sent to Home IDE
```

The approved provisioning route is the trusted IDE/Builder, not ordinary
Mint CREATE or FreeHandler inventory allocation. Neither service's ordinary
result should include raw M-control authority.

**Approved consumer-grant design (2026-11-03):** The trusted IDE/Builder
explicitly provisions SecurityRegulator E to Mint and FreeHandler. They
receive invocation authority, not raw M-control authority. Their ordinary
allocation results include neither raw M-control nor regulator invocation
authority. Other applications gain no automatic regulator access; additional
grants require an explicit programmer decision. These are substantial grants
to a mechanism without caller-purpose policy. The separate Passcode/audit
contract remains open. This approval does not authorize implementation,
saved-artifact changes or hardware operations.

### Mint: what the source establishes

`simulator/cloomc/mint.cloomc` currently declares MintState RW, MintScratch L,
MintPool RW, PkVerify E, MintNamespace RW, MintCleaner E and MintApproval SL,
plus SELF. It does not declare SecurityRegulator E or the M-control GT.

The implemented CREATE slice is DATA RW only; it does not prove a general
Thread or regulator-device constructor. Mint selects its trusted approval
reference from its own C-list before calling PkVerify. The current
`simulator/cloomc/pkverify.cloomc` contract compares the supplied proof and
trusted reference with EXACT. This is Mint's established service boundary,
not a reason to add a policy engine to SecurityRegulator.

Mint also holds Namespace-write authority and uses a scratch L view to
materialize a result GT. Review those paths separately from regulator custody:
moving M-control into a private C-list alone does not prove Mint cannot
construct another route to that device. Trace actual descriptor reach,
binding and integrity checks before claiming exclusive access. This review
identifies a proof obligation, not a demonstrated exploit or permission to
remove Mint's approved authority.

Any later replacement of a Mint scratch/transfer mechanism with LOADM or
SAVEM must identify the exact instruction-level need. Ordinary DWRITE through
MintNamespace RW does not become an M operation merely because Mint performs it.

### FreeHandler: first consumer, not issuer of M authority

`simulator/examples/free_handler.cloomc` holds directory L/R views and finds
each Block's private Inventory. FreeThread currently loads row 10's
ThreadSetup S and performs ordinary SAVE into home 1; it then marks issuance
in that Block's State. It does not invoke SecurityRegulator.

The proposed replacement is:

```text
SAVEM(ide.B1.FreeThread, 1, applicationE_GT)
```

Before adopting it, define how the added call preserves the selected Thread,
State GT and application operand. Freeze the SAVE M contract and audit ABI;
then revise the private Inventory to remove ThreadSetup S. Do not remove the
grant first, activate unbound artifacts, or use global simulator elevation.
Returned Data/C-list/Thread GTs remain ordinary object grants, not regulator
or M-control grants.

FreeHandler's current source explicitly ignores its passkey parameter.
Therefore it cannot be cited as evidence of implemented Passcode attribution
or admission. Do not silently equate that parameter with Mint's Abstract
Passkey or the regulator's new audit identity.

### Current M-control implementation discrepancy

`simulator/device_abstractions.js` exposes `issueNamespaceMBitCapability` and
`writeMBitWord`. The helper recognizes a Navana/Namespace owner and a
JavaScript object capability for the slot-13 M-bit device; writes replace
CR0.M–CR15.M from one word. That is not evidence of a saved, ordinary
SecurityRegulator-owned GT path. It conflicts with treating regulator custody
as already implemented. The fixed helper port/slot must not become the new
API merely by copying it into a document.

### Cross-service audit and review priorities

For a nested call, record the originating Passcode identity and the immediate
caller (Mint or FreeHandler), together with the transaction ID held in the
tuple's CR5 store. The user explicitly added transaction attribution, such as
an order or a telephone call. Do not substitute the service identity for the
originator or invent a separate transaction-ID mechanism.

**Approved tuple entry name:** `TransactionID` is the reserved name in the
CR5 tuple store across transaction types. This names the existing transaction
identity; it does not create another ID or add a SAVEM operand.

**Approved Passcode audit representation:** Provision a non-secret audit ID
with the Passcode. The Home IDE maintains its association with the Passcode's
identity. Record the audit ID, not the secret; the ID confers no authority.
It identifies the credential and remains distinct from `TransactionID`.
**Approved verification point:** SecurityRegulator verifies evidence of the
originating Passcode and obtains the audit ID from its provisioned association.
Mint and FreeHandler must not substitute their own identity for the originator
on nested calls. Independently supplied audit labels are not trusted.
The invocation capability remains necessary; verification is not a
caller-purpose policy check and the secret is never logged. Protected
proof encoding, nested-call transport details and the register ABI remain
to be defined. This design approval authorizes no implementation or hardware
changes.

**Approved local verification provisioning:** During Namespace preparation,
the trusted IDE/Builder provisions the Passcode verification material and
associated audit ID into SecurityRegulator's private storage. Calls supply
the credential, not the trusted reference against which it is checked.
Mint and FreeHandler cannot replace that reference through an ordinary
regulator call. Verification uses the local reference without a Home IDE
round trip. This selects reference ownership and placement, not a hash, key,
other cryptographic representation or register ABI. Private custody remains
a design requirement, not proof against Mint's Namespace-write reach.

**Approved nested-call credential:** Mint and FreeHandler carry an
invocation-bound proof, not the reusable secret Passcode. SecurityRegulator
verifies that proof using its provisioned verification material and obtains
the associated audit ID. The proof must be bound to the requested operation
so it cannot be used for a different request or replayed later. The invocation
capability remains necessary; this does not add caller-purpose policy.
Proof generation, encoding, exact operation-binding fields and replay
prevention remain to be specified. This does not adopt the existing Passkey
scheme or authorize implementation.

The physical tuple layout and how these identities are carried and bound
without spoofing or leaking a secret remain to be specified. The transaction
ID is the stored ID, not an assumption that the raw CR5 GT is the ID.
This is evidence binding, not purpose policy or implementation approval.

**Approved audit delivery model:** Retain required audit evidence locally
before the privileged effect, record the actual outcome, and deliver
asynchronously to the Home IDE. Network acknowledgement does not block each
operation. Unacknowledged records remain pending; transmission alone is not
delivery proof. If required local recording cannot be guaranteed, hard-fault
rather than execute without evidence. This is design approval only, not proof
of implemented reset-safe storage. Capacity, reset retention, acknowledgement
protocol and outcome-recording failure boundaries remain to be defined.

**Approved Home IDE provisioning:** The trusted IDE/Builder sets the Home IDE
destination alongside SecurityRegulator during Namespace preparation.
Individual calls cannot redirect records; Passcode identity and
`TransactionID` are attribution, not destination selectors. A destination
change requires explicit configuration. Transport and credentials remain
separate design work; this approval changes no live configuration.

**Fault-scope clarification:** The user specifies that a hard fault impacts
only one Thread at a time, only the fault data is retained, and other Threads
are unaffected. The earlier “Church reset” framing is withdrawn: do not turn
this into a machine-wide reset or a requirement to recover unaffected
Threads.

**Approved Phase 1 power-off boundary:** Loss of pending local audit records
on board power-off is allowed; power-loss-safe local audit storage is not a
Phase 1 requirement. Normal powered operation must still retain unacknowledged
records under the approved delivery rule. This does not authorize clearing
records on a Thread-local fault or settle FPGA reconfiguration retention.

Review in order:

1. Exact M-control custody/provisioning, including Mint's Namespace-write reach.
2. Destination/source M semantics for the first SAVEM use and normal return.
3. Passcode association through nested calls and Home IDE delivery/fault rules.
4. Explicit consumer bindings and preserved-register ABI.
5. Exact-artifact migration and independent simulator/RTL evidence.

No method implementations, grants, Namespace state or hardware were changed
by this review.
