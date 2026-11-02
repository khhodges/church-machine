# SecurityRegulator — machine-operation review

**Status:** First-pass architectural review, 2026-11-02. Proposed software
interfaces, not an ISA amendment, implemented API or hardware qualification.

## Authority and purpose

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

### Functional proposal

```text
SaveM(destinationGT, homeIndex, valueGT) -> normal completion or machine fault
```

The index is a capability-home index, not an arbitrary word address.
The intended write stores the exact GT, not a permission-upgraded copy.
No allocation, activation, generation change or policy decision is included.

Illustrative ABI, **not yet frozen**:

| Register | Input |
|---|---|
| CR1 | Destination GT |
| CR2 | Value GT |
| DR1 | Home index |

An eventual `ide.SecurityRegulator E` invocation grant is a proposed binding,
not an assertion that this saved artifact exists. Define method selector,
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

Resolve the SAVE destination-M rule and source-transfer scope against the ISA.
Then freeze the primitive's ABI and M lifecycle and implement it without a
global privilege shortcut. Expand the operation set only from similarly
explicit machine contracts. No new caller-purpose policy is required.
