# System Namespace and standard handoff contract

Date: 2026-10-11

**Status:** user-approved direction; detailed mechanism and ABI are a design
draft. This document does not claim implementation, allocate GTs or slots,
replace saved LUMPs, enable Mint/Outform, or authorize a build or flash.

The [Boot → System first-pass definition](boot-system-handoff-first-pass.md)
proposes the initial lifecycle, selection record, ISA mapping, controlled
transition context and recovery policy. Its recommendations remain subject to
Design Team approval and cross-Namespace mechanism proof.

**User clarification — 2026-10-11:** handoff errors, including context-save/
restore failures, must take the existing hard-fault path. Correct CHANGE
behavior is already required; implementation defects do not require a new user
decision. References below to recovery do not authorize a new handoff-specific
rollback, retry, or partial-resume mechanism.

## 1. Purpose and startup sequence

The first destination beyond the evolved three-LUMP diagnostic loop (3LL) is a
**System Namespace**. It proves the standard handoff and provides the controlled
environment in which system features are exercised before application admission.

```text
Boot
  → required 3LL startup diagnostics
  → standard checked handoff to the selected System Namespace revision
  → system feature tests / application admission
  → standard checked handoff to selected application Namespace(s) and entry Threads
```

Diagnostic failure prevents application startup and retains useful evidence.
A pass proves only the specified coverage, not absence of all hardware defects.
System tests may be destructive: run them against disposable test objects and
isolated allocations, never implicitly against approved application data.
The diagnostic/bootstrap context and required recovery authority must survive
test failures according to the approved recovery contract.

The 3LL remains the startup baseline, not a closed list of all executable LUMPs.
Its breakout destination is reprogrammable. Selecting another compatible
program must not require rebuilding the FPGA. Adding a physical interface may
require new RTL and a new qualified bitstream.

## 2. One handoff, independent of delivery

IDE-controlled loading and future lazy loading must feed the same admission and
activation contract. Download completion is neither validation nor permission
to activate. No loader may install its own unchecked CR15 transition.

**IDE tunnels and networked Church Machines (CMs) are explicit system features,**
not implicit consequences of Ethernet support. An IDE tunnel supplies an
authorized management/data path; CM-to-CM communication crosses machine and
Namespace authority boundaries. Neither transport connectivity nor possession
of a remote GT grants local execution authority. Remote artifacts must pass
local admission before activation. A local Namespace handoff must not be
misrepresented as remote execution migration.

The conceptual handoff input identifies:

- Exact approved Namespace revision(s), artifact identities and allocations.
- Entry Thread(s), prepared contexts, C-Lists, stack roots and continuation rules.
- Explicit capability grants and permitted inter-Namespace communication.
- Required hardware profile, devices, diagnostic coverage and contract versions.
- Completion, fault, cancellation and unavailable-dependency behavior.

These are semantic requirements, not a frozen serialization format or register
ABI. No numeric GT, slot, proof register or new opcode is assigned here.
Namespace membership comes from the selected Namespace configuration, not
catalog history. Credentials must not appear in public descriptors or logs.

Preparation must complete validation before activation. Revalidate exact
prepared identity at the safe boundary, or hold exclusion that prevents it
changing. Establish external-writer exclusion and defined fault/reset handling.
Switch Namespace authority and executable Thread context coherently: execution
must never observe a new Namespace with an incompatible old context.

| Outcome | Required result |
|---|---|
| Invalid configuration, missing dependency or failed diagnostics | No application activation; retain the current safe environment and actionable reason |
| Successful activation | Execute the exact validated entry context with only its authorized capabilities |
| Fault/reset during activation | Defined recovery outcome; never execute mixed context or assume rollback |
| Application completion | Explicit completion policy; no accidental return into the 3LL |
| Application fault | Approved fault recovery and retained evidence, not an invented IRQ mechanism |
| Request changed while preparing | Reject stale preparation or obtain explicit adoption of the new revision |

Preparation can stage bytes; failure does not imply zero staging writes.
Application-visible installation, activation and cleanup boundaries must be
specified separately. Lost replies must not cause blind duplicate activation.

## 3. System Namespace feature matrix

Every row is in scope for the system validation program. This is not a claim
that all rows already work or must execute on every boot. Freeze mandatory
startup checks and feature-dependent application checks separately.

| Feature | Positive evidence | Negative / containment evidence |
|---|---|---|
| Standard handoff | 3LL → System → application, including two differently selected destinations without FPGA rebuild | Bad target, stale revision, incompatible Thread/Namespace, interrupted activation, defined completion/recovery |
| Lazy loading | Missing supported dependency fetched, authenticated/validated, bound and resumed at the correct continuation | Missing/corrupt/untrusted dependency, interrupted transfer, duplicate request; no premature authority publication |
| Cooperative multithreading | Multiple Threads make progress by run-to-suspension round-robin; exact register/frame isolation and expected order | Runaway Thread follows approved watchdog/fault behavior; failed context save/restore is contained; no invented preemption or CR13 role |
| Namespace garbage collection | Reclaim only eligible unreachable objects and safely reuse their storage/slots under an approved lifetime rule | Never reclaim live Threads, stacks, pending loads, shared objects or protected roots; stale capabilities must not gain authority on reuse |
| I/O extensions | Exercise selected board drivers, including Ethernet and HDMI when implemented and selected | Unsupported devices block dependent applications explicitly; bounded access, malformed input, timeout and isolation checks |
| IDE tunnels | Authorized IDE-to-CM session establishment, scoped operations, target/session correlation, and explicit close/reconnect | Unauthorized endpoint or operation, stale session, disconnect during transfer/activation, lost reply and replay; no blind duplicate operation or implicit authority expansion |
| Networked CMs | Authorized CM-to-CM exchange and remote dependency delivery with peer identity, destination-local admission and explicit capability boundaries | Wrong peer/Namespace, replay, stale remote reference, peer reboot, timeout or partition; no use of a remote GT as unchecked local authority |
| Application rules/contracts | Admit compatible apps with exact entry, dependencies, resources, permissions and completion policy | Reject incompatible contract/profile, unauthorized grants, invalid layout or unavailable mandatory devices |
| Mint and privileged regulators | Exact authorized effects, bootstrap T === GT where applicable, and per-operation authority checks | Authentication/authorization denials, R1–R3 interruption cases, protected-state isolation and invalid reuse |

No simulated Ethernet/HDMI result establishes physical support. Inventory the
full A7 board/carrier and distinguish board-present, RTL-implemented,
capability-exposed, driver-tested and physically verified states.

## 4. Dynamic boundary and security

The frozen resident single-machine bootstrap uses T === the complete runtime GT.
That simplification does not automatically cover the System Namespace's lazy
loads, collection, slot reuse or retained execution across replacement.
The dynamic identity, generation/reuse and stale-capability contracts must be
resolved before those features are admitted. A stopped fresh-image bootstrap
and live replacement are different operations.

Cross-machine identity and authority are required for networked CMs even if each
machine schedules cooperatively. Local bootstrap T === GT cannot be assumed to
identify an object on another CM. Tunnel authentication, operation authorization,
session lifetime, revocation and retry semantics require explicit contracts;
an encrypted or reliable transport alone does not establish those guarantees.
Do not imply a global scheduler or distributed atomic commit from local R1–R3.

ide.Mint is not made operational by this document. Its
[contract](ide-mint-forge-contract.md) still governs authentication, authorization,
allocation and representation. Phase 1 uses the bounded R1–R3 rule rather than
requiring a general transaction engine solely because four words are written.
Cooperative scheduling does not exclude upload/init writers or prevent resets.

SecurityRegulator owns M authority under the approved direction. Initial CR15
and recovery authority remain governed by the hardwired recovery contract.
Applications do not acquire raw NamespaceTable or M-control authority merely
because the System Namespace possesses it.

## 5. Evidence and release gates

Extend the [ISA-to-FPGA alignment plan](releases/isa-to-fpga-alignment-plan.md):

1. Freeze the handoff, dynamic lifetime and application contract semantics.
2. Prove the baseline handoff in the simulator using independently derived
   expected register, memory and accepted-write effects.
3. Add feature tests with isolated fixtures and an explicit supported/deferred
   matrix; never represent a disabled feature as a passing implementation.
4. Replay the same exact inputs through RTL and synthesized evidence.
5. Build only after authorization and retain source/input/bitstream provenance.
6. Verify physical handoff and selected device/system features on the exact board.

Label each layer PASS, FAIL, NOT RUN or UNOBSERVABLE. A feature required by an
application cannot be waived merely because another feature passed. Record
diagnostic evidence against the exact machine profile and define what reset,
reconfiguration or hardware change invalidates it.

The System Namespace is a logical destination, not permission to add a fourth
resident LUMP to the current approved boot image. Delivery, residency and memory
capacity must be selected explicitly.

## 6. Decisions required before implementation

- Handoff descriptor format, trusted caller, ABI, safe boundary and low-level
  Namespace/Thread activation sequence.
- Delivery/residency of the first System Namespace and unavailable-target behavior.
- Diagnostic coverage, rerun/invalidation policy and per-application requirements.
- Namespace-set scheduling, capability crossing and completion/recovery policy.
- Lazy-load transport, proof/admission path, pending-request ownership and resume.
- IDE tunnel endpoint/session identity, permitted operations, disconnect/reconnect,
  revocation, request correlation and indeterminate/lost-reply handling.
- Networked-CM peer identity, cross-machine references, capability export/import,
  local admission, peer restart and partition behavior; supported remote operations
  must be distinguished from deferred execution migration or distributed commit.
- Garbage-collection roots, reachability, pending/shared-reference treatment,
  bounded progress, generation reuse and stale-capability protection.
- Driver resource inventory and supported A7 board/carrier profile, including
  Ethernet/HDMI control, buffers and any DMA authority actually implemented.

Resolve these through the approved ISA and security contracts; do not infer
permission to bypass a missing mechanism from the convenience of the proposed UI.
