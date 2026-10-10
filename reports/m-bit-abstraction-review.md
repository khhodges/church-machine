# SecurityRegulator — interface proposal

**Review only.** This defines a proposed software abstraction over the existing
protected hardware-control word. It does not add ISA opcodes, change the master
ISA or authorize implementation, synthesis or board actions. The user names
the abstraction **SecurityRegulator**, in Babbage's tradition. The name does
not itself allocate a canonical artifact identity or grant hardware authority.

## Purpose and authority

Expose bounded functions rather than a raw register setter. Bits 0–15 control
CR0.M–CR15.M; bits 16–31 are for hardware controls, including watchdog refresh.
The exact watchdog bit and command semantics still require approval.

The abstraction must not return or export the writable control-object GT.
An executable GT authorizes entry, but that alone must not imply permission to
invoke every privileged operation with arbitrary operands. Each method needs
an explicitly authorized caller and a defined, limited effect.

Existing custody is Namespace-only. The proposed interface can be supplied by
Namespace or delegate a complete operation to it before any M bit is armed.
Moving custody to a new standalone abstraction would be a separate reviewed
change; merely naming `SecurityRegulator` does not grant it hardware access.

## Presently known method contracts

**User-defined privileged cases:** LOAD into CR12, CR13, CR14 or CR15, and
SAVE a GT from CRn without requiring its B bit. Watchdog refresh is a separate
hardware-control method. The names below are functional interface names, not
new ISA opcodes; the current master calls the isolated-register load form
SWITCH. Its encoding and any LOAD/SWITCH terminology change require separate
ISA reconciliation.

| Proposed method | Authorized caller / GT sources | Effect | Must not do |
|---|---|---|---|
| `RefreshWatchdog()` | Approved scheduling authority; provider's protected control-object GT authorizes the write | Restart the fixed one-second deadline through the proposed refresh command, before expiry | Change the duration, clear an existing fault, grant M authority, toggle the fault LED or let an ordinary worker repeatedly feed the watchdog |
| `LoadCR12(sourceCList, index)` | Caller authorized to replace CR12; control-object GT authorizes CR12.M; source C-list GT independently authorizes lookup | Arm CR12.M and perform the validated load into CR12 | Treat register replacement as a full CHANGE or implicitly save/restore a Thread |
| `LoadCR13(sourceCList, index)` | Caller authorized to replace CR13; control-object GT authorizes CR13.M; source C-list GT independently authorizes lookup | Arm CR13.M and perform the validated load into CR13 | Infer an IRQ role or grant authority to another register |
| `LoadCR14(sourceCList, index)` | Caller authorized to replace CR14; control-object GT authorizes CR14.M; source C-list GT independently authorizes lookup | Arm CR14.M and perform the validated load into CR14 | Assume the method's existing execution/return context remains valid after replacing code authority |
| `LoadCR15(sourceCList, index)` | Caller authorized to replace CR15; control-object GT authorizes CR15.M; source C-list GT independently authorizes lookup | Arm CR15.M and perform the validated load into CR15 | Bypass validation of the replacement Namespace or assume retained capabilities automatically remain valid |
| `SaveGTWithoutB(sourceCRn, destinationCList, index)` | Caller authorized to install the specified GT; the earlier source-M mechanism must be reconciled with the scoped construction grant below | Perform an authorized SAVE despite source B=0. In construction, every inserted dependency is stored with B=0 | Treat B preservation as a universal rule, waive destination checks, or broaden construction authority beyond its scope |

The SAVE case is **not limited to CR12 or CR12–CR15**: CRn identifies the
source register for the authorized operation. Operand legality remains
explicit; the broader scope is not a claim that every case is implemented.
M authorizes this particular SAVE despite B=0; it does not convert the GT into
one that can subsequently be delegated without M.

The one-shot regulator methods combine **set the relevant M bit + the specific operation**.
Additional operations require their own contracts. No generic
`SetM(register, value)`, raw `WriteControlWord(value)` or privileged callback
executor is proposed for callers.

## Scoped construction: every inserted dependency is stored with B=0

**User-confirmed rule:** `objectMaker.Creat(RW, size)` returns a new object
reference with scoped construction authority, expressed by the user as
`GT.new.M=true`. Its owner can build the C-list of a dynamic class instance.
**Every dependency GT inserted into that C-list is stored with B=0.**
This is not merely a rule about saving the new object's own GT elsewhere.

The factory supplies the object and scoped construction authority; a caller
such as a compiler determines its structure and dependencies. The grant is
authority over the new object, not the raw hardware-control word.

| Dependency presented for an authorized construction SAVE | Stored C-list entry |
|---|---|
| B=1 | B=0 |
| B=0 | B=0 |

These rows describe the stored result **after authorization**, not permission
to install any GT merely because the caller presents it. All applicable mLoad,
identity, destination access and bounds checks still apply. The confirmed
change is to the stored entry's B bit; it does not authorize rewriting the
source register or granting additional permissions.

This supersedes the earlier blanket claim that privileged SAVE preserves B.
The stored dependency can be used according to its remaining authority, but
B=0 does not by itself permit ordinary onward binding. A separately authorized
privileged operation is distinct from ordinary delegation; B=0 is not a claim
that privileged reinstallation is impossible.

For `SAVE CRd[index], CRs`, CRs still identifies the dependency and CRd the
destination. The new scoped grant is associated with the returned object
reference; do not silently substitute the earlier source-CR.M-only proposal.
The exact relationship between this grant, destination S and source admission
must be specified before implementation.

`GT.new.M=true` is conceptual scope notation here, not an approved extra bit
in the serialized GT. The register-held representation, survival across the
factory return, number of permitted insertions, end-of-scope revocation and
fault behavior still need explicit contracts. The user has not approved a
particular finalize method or instruction.

## Functional requirements

- The instruction and authorizing GT remain independent. Every applicable
  access passes mLoad and the operation's other security checks. M contributes
  only the authority explicitly defined for that register and operation.
- Caller authorization precedes arming M or refreshing the timer. Delegation
  must not turn an unauthorized request into an authorized one merely because
  a trusted helper forwards it.
- A one-shot regulator's M-authorized operation belongs inside its method. No caller callback,
  yield or intervening CALL/RETURN may carry an armed M bit to unrelated code.
  Current CALL/RETURN M rules must be reconciled with the method's ABI; this is
  not equivalent to calling a setter and then executing an operation afterward.
- The factory construction path is a distinct, explicitly scoped grant to the
  caller, not an ordinary setter. Do not apply a one-operation consumption rule
  that prevents building a multi-entry C-list, or let the grant escape its
  eventual defined scope.
- Each one-shot method must finish its M-authorized operation without leaving the
  relevant M bit armed or newly elevating unrelated registers. Exact
  consumption/fault rules for the generalized SAVE case require ISA
  reconciliation; the existing isolated-register rules alone do not establish
  implementation support for every CRn.
- The GT operated on must be the one named by the authorized request, not a
  method-local register value substituted by CALL argument passing. CRn
  selection, operand preservation and return behavior need a concrete ABI.
  Loading CR12, CR14 or CR15 may change the very authority needed to continue
  or return. These methods cannot be assumed to be ordinary returning wrappers:
  their post-load continuation and any return restoration must be defined
  without undoing the intended load or using invalidated authority.
- On a fault, do not claim software cleanup executed. Preserve the ISA-defined
  fault evidence; recovery must not expose armed M authority to untrusted
  execution. The exact fault/recovery M-state contract remains an adoption
  requirement, not a new implicit ISA exception.
- A control-word write must deliberately account for the low sixteen bits.
  Under existing full-word semantics, writing only the refresh bit would clear
  them. Do not replay other upper command bits or assume a stale whole-word
  value is safe. Exact preservation and readback semantics need definition.
- Watchdog expiry, not refresh, toggles the LED. Repeated one-second expiries
  give the requested one-second-on / one-second-off cycle, subject to recovery
  timing. The indicator is not a free-running heartbeat.

## Decisions required before implementation

1. Exact method-entry authorization and delegation rules. A shared callable
   interface must not let refresh-only callers invoke M-authorized operations.
2. Refresh command bit, readback, unrelated-bit handling and expiry precedence.
   Suggested command behavior is write-one refresh, no persistent hold-off.
3. Method operands/results and their CALL/RETURN register contract.
4. Fault and continuation postconditions for the known operations above,
   including generalized B-free SAVE and privileged-register replacement.
5. Reconciliation with the earlier automatic-handoff renewal proposal: explicit
   protected refresh must not coexist with an unintended second renewal path.
6. Scoped object construction: grant representation and return semantics,
   admission rules, destination rights, revocation and failures. The stored
   B=0 result for every inserted dependency is already user-confirmed for review.

The watchdog duration remains fixed at the proposed one second; setting a new
duration is not part of this interface. The existing red-text ISA review predates
this interface and the save-first recovery discussion and still requires
reconciliation before adoption.
