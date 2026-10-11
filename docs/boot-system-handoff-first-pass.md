# Boot → System Namespace: first-pass handoff definition

Date: 2026-10-11  
Status: **proposal for Design Team review, not an approved ABI or implementation.**

The [isolated feasibility probe](../reports/namespace-handoff-feasibility.md)
found that simulator resolution still uses its fixed Boot table after CR15
changes. Narrow Amaranth lookup tests pass, but the complete handoff is blocked;
the proposed mapping below has not been established.

This refines the [standard handoff contract](system-namespace-handoff-contract.md).
It does not amend the ISA, assign slots/register operands, replace LUMPs, authorize
hardware operations, or certify the candidate. Replit Agent implements the approved
contract; Design Team owns its decisions and sign-off.

## 1. Proposed bounded behavior

Boot enters its prepared diagnostic program through the existing boot path.
After one complete required diagnostic pass, the trusted startup coordinator
transfers control once to the explicitly selected System Namespace and its
prepared entry Thread. It does not repeat the 3LL indefinitely in normal startup
mode. A separately selected diagnostic-loop mode has no automatic breakout.

“Boot → System” therefore means **boot initialization → 3LL diagnostics → checked
handoff**, not a fourth boot instruction or skipping the diagnostic program.
Selection never comes from the latest catalog item or the open editor.

The first implementation should support one machine, one active Namespace at a
time, and a fresh System entry context. Live replacement, return to suspended
Threads in a previous Namespace, Namespace-set scheduling, lazy loading and
distributed activation are deferred. The existing cooperative scheduling policy
continues within the active Namespace.

Proposed delivery: explicit IDE staging while execution is stopped, into reviewed
non-overlapping memory outside the unchanged three-resident-LUMP boot projection.
The selected System Namespace and its dependencies must survive the particular
start operation used. If reset/initialization overwrites them, stage after that
initialization and before diagnostic execution, or reject the delivery procedure.
No live upload during handoff. Capacity, placement, and the exact stop/init/stage/
start sequence remain approval blockers; this proposal does not allocate memory.

## 2. Selection and preparation record

Freeze the following semantic fields together. These are a review-level schema,
not an assigned binary layout, register ABI, or new security token.

| Field group | Required contents |
|---|---|
| Correlation | Request identity, machine/run epoch, contract version |
| Source | Exact boot configuration and diagnostic executable identities |
| Destination | Exact Namespace revision, table geometry, loaded byte digests and placement map |
| Entry | Permissionless Thread GT, Thread artifact, prepared CHURCH frame/root and executable Enter authority |
| Dependencies | Exact selected artifacts, localized C-Lists, device profile and mandatory checks |
| Grants | Runtime holders and permissions for entry, transition and recovery; no public credentials |
| Policy | Diagnostic-loop versus startup mode, completion/fault policy, allowed cancellation boundary |
| Evidence | Validation result, diagnostic result, frozen-input identity and observed activation outcome |

The IDE selects an exact approved configuration. A trusted startup coordinator
consumes that selection; it is not authority merely because it received a record.
Capability checks remain mandatory. The record identifies existing authority and
does not forge GTs, grant M, or make operational Mint a dependency.

Preparation checks exact artifact admission, loaded bytes, Namespace descriptors,
generation, bounds, non-overlap, C-Lists, prepared Thread frame and required devices.
Revalidate at activation or hold exclusion over all inputs that could invalidate
those checks. Digests of immutable input evidence must not be confused with
mutable runtime memory after legitimate diagnostic writes.

## 3. Proposed lifecycle and observable boundary

| State | Permitted behavior | Exit |
|---|---|---|
| SELECTED | Freeze one request; no execution authority changes | Explicit staging begins |
| STAGED | Write only declared isolated staging regions; retain exact input evidence | Admission and geometry pass |
| READY | Prepared target held stable; exclude competing loaders/init writers | Boot diagnostics run |
| DIAGNOSTICS | Run required checks on disposable objects without corrupting target/recovery state | Matching pass evidence, or blocked startup |
| ARMED | Coordinator owns the request and necessary scoped transition authority; cancellation closes | Enter reviewed transition sequence |
| TRANSITION | No yield, CALL, unrelated work, retargeting or external memory replacement | Successful target CHANGE, or hard-fault recovery |
| ACTIVE | CR15 and restored Thread/executable authority agree; execute System entry | System validation and later application admission |
| BLOCKED / RECOVERY | Record reason and last proven state; no automatic alternative target | Explicit new start/recovery decision |

The **activation boundary** is successful retirement of the CHANGE that installs
the System entry Thread with the selected CR15 already established. Evidence must
also identify the first target retirement. A delivery acknowledgement, CR15 write,
or post-stop snapshot alone is not proof of completed activation.

Once ARMED is entered, cancellation means a separately defined stop/recovery,
not a promise that no transition happened. Lost acknowledgement means UNKNOWN
until correlated evidence resolves it; never blindly repeat activation. A new
machine epoch invalidates old in-flight requests and diagnostic evidence.

## 4. Existing ISA mapping and its limits

Authority: [master ISA](instruction-set.md), especially one-GT CHANGE and SWITCH.

| Operation | Existing mechanism | Constraint |
|---|---|---|
| Materialize authorized transition operands | Ordinary LOAD from admitted C-Lists | Exact row, type, generation, integrity and permissions; no synthetic GT repair |
| Authorize CR15 installation | Existing M-bit I/O authority under SecurityRegulator direction | Exact destination M must be authorized; no assumed right to write the whole M word |
| Install Namespace | `SWITCH CR15, CRs, #row` | CRs is CR0–CR11 with L; CR15.M latched at acceptance and consumed on success |
| Activate System Thread | `CHANGE CRn` | One permissionless, non-NULL Thread GT; checked incoming frame and C-List; errors hard-fault |
| Invoke methods after entry | CALL / RETURN in the destination context | Not a Namespace-switch mechanism; cannot assume a return restores old CR15 |

Programmatic CHANGE is not privileged and does not require operand R/W/X/L/S/E.
The incoming executable Enter GT is distinct from the permissionless Thread GT.
The special boot back-half is not a general-purpose post-diagnostic handoff.
IRQ entry/hidden return proposals are not substitutes for this transition.

Current source observations (not fresh execution evidence):

- `hardware/change.py` reconstructs saved capabilities through the current CR15
  Namespace; its scheduler context contains private CR words. Do not infer that
  ordinary CHANGE restores a Namespace as part of the Thread snapshot.
- `simulator/simulator.js` restores CR0–CR11 in its Thread paths and derives
  executable/C-List context. A Thread restore is not proof of combined CR15 swap.
- That simulator also retains a guarded boot-only `SWITCH CR15, CR15` placeholder.
  It violates the ordinary source class and is not an admissible runtime bridge.
- `hardware/switch.py` and `hardware/change.py` are separate execution units.
  Their individual completion does not establish sequence-level atomicity.

## 5. Preferred mapping to investigate: a shared transition context

Propose a narrowly scoped transition context, explicitly admitted under both the
source and destination Namespace views. “Shared” means the exact same approved
objects and authority, not merely matching names or slot numbers.

Conceptual sequence, **not executable assembly**:

1. Enter the coordinator/transition context under the boot Namespace. Any helper
   CALLs have returned; the transition does not inherit a cross-Namespace RETURN
   obligation. Complete all preparation and diagnostic checks.
2. Hold exclusion and freeze operands. Obtain only the required CR15 M
   authorization through an approved regulator path.
3. SWITCH CR15 from an ordinary L-authorized C-List row holding the admitted
   destination Namespace capability.
4. Fetch and execute the single intended CHANGE under the destination Namespace,
   using the exact permissionless System Thread GT.
5. Restore the prepared System context. First target execution has a coherent
   Namespace, Thread, executable, C-List, stack, DRs and flags. No transition
   grant or M authorization may leak into application-accessible context.

This is two separately retiring instructions, **not an atomic pair**. Between
them the old transition Thread is still active under the destination Namespace.
That interval is acceptable only if this very context is deliberately valid in
both views; it must not be an incompatible old application context.

Proof obligations before adopting this mapping:

- All bridge fetch, C-List resolution, Thread-save destinations, continuation
  identity, bounds and recovery dependencies remain valid after CR15 changes.
- Destination-local identity/generation bindings do not reinterpret any carried
  bridge GT. Enumerate every required shared object; do not mirror the entire
  boot Namespace or extend the frozen-bootstrap T===GT rule to dynamic objects.
- The System entry Thread validates in the destination view, without requiring
  unsafe early resolution in the source view.
- Interrupted CHANGE may have written outgoing context. Define accepted writes
  and recovery at each microstep; no sequence-wide rollback claim is inferred.
- Scheduling, fault entry, reset and external writers cannot resume incompatible
  context in the interval. “Cooperative” alone does not establish this.
- The saved bridge continuation cannot accidentally re-enter the diagnostic loop
  or repeat activation. Its treatment and residual authority are explicit.

If these cannot be met using approved capabilities and current ISA semantics,
reject this mapping. Present the smallest missing architectural guarantee for
approval. Do not silently add atomic SWITCH+CHANGE semantics, hidden CR15 saves,
new opcodes, a global identity cache, or a boot-only bypass.

## 6. Register, memory and recovery contract

| Boundary | Required state/effect |
|---|---|
| Before SWITCH | Source CR15; valid bridge CR12/CR0/CR5/CR6/CR14 and protected frame; frozen target operand; scoped M authorization |
| Successful SWITCH | Only prescribed CR15 replacement and destination-M consumption; ordinary SWITCH has no Namespace-table or memory writes |
| Between instructions | Destination CR15; still-valid bridge context; no arbitrary application instruction, scheduling yield or upload |
| Successful CHANGE | Destination CR15 retained; CR12 is selected System Thread; restored private CRs, DRs, flags, frame, CR5, CR6 and CR14 satisfy canonical Thread ABI |
| Allowed transition memory effects | Precisely enumerated outgoing bridge suspension and incoming frame/indicator effects required by CHANGE; staging writes accounted separately |
| Forbidden effects | Namespace descriptor repair, executable widening, opportunistic allocation, writes outside approved Thread regions, publication of unvalidated authority |

The exact all-register values, M states, accepted write events and address units
must be frozen in the golden checkpoint specification, not inferred from this
high-level table. CR13/recovery authority needs explicit source/destination
validation; this draft does not repurpose it as a software scheduler register.

Recommended failure/completion policy for the first candidate:

- Before ARMED: refuse startup into System and report the cause; retain the safe
  boot environment. Staging writes may already exist.
- During transition: preserve the first fault and request identity through the
  approved recovery path. Do not resume the bridge or guess which context won.
  Recovery access itself must be proved valid on both sides of SWITCH.
- After activation: System test failure blocks application admission. Record
  failure and use explicit recovery; do not silently return to 3LL.
- Successful System validation: remain in a System supervisor idle/service state
  awaiting separately admitted application work. Do not RETURN into Boot.
- Reset/new start: rerun required diagnostics. Initial policy reuses no prior
  boot's pass; optimizing reruns requires separate evidence and approval.

## 7. Decisions for review and closure

| Decision | First-pass recommendation | Still required |
|---|---|---|
| Startup mode | One complete diagnostic pass, then one handoff; loop mode explicit | Exact mandatory checks, pass/status encoding and failure reporting |
| Delivery | Stopped IDE staging, no live replacement | Capacity/layout, reset survival, writer exclusion and approved delivery sequence |
| Selector authority | Exact frozen configuration consumed by trusted coordinator | Runtime holder, admission and regulator ABI; no assigned GT/slot yet |
| Mechanism | Investigate shared transition context plus ordinary SWITCH/CHANGE | Cross-view identity, fetch/save/recovery and interruption proof |
| Destination ABI | Fresh canonical Thread with poison root and prepared entry | Exact frame/register golden values and serialization |
| Completion | Stay in System supervisor; no implicit Boot return | Concrete idle/service behavior and explicit recovery entry |
| Trust | Existing local approved admission only | Minimum Genesis/local bootstrap agreement; no network-trust inference |

Not closed by this first pass: concrete shared-object layout, descriptor wire
format, regulator calling convention, fault-code precedence, and any required
ISA clarification. These must be resolved before implementation approval.

Acceptance must demonstrate two System selections using the same bitstream;
diagnostic failure; missing/corrupt/stale target; denied M; invalid Thread
permissions/frame; reset/fault at both instruction boundaries and internal write
boundaries; concurrent-writer rejection; lost replies; and no transition-authority
leakage. Reuse readiness cases H01–H12, with complete independent checkpoints
before SWITCH, after SWITCH, after CHANGE and at first System retirement.

**Review outcome:** a specific candidate mechanism and bounded policy proposal,
not a completed mechanism proof. No functional tests were run for this document.
