# G4 simulator exclusion investigation

**2026-10-17 · Bounded source inspection and isolated negative regression evidence.**

**G4 remains OPEN. Operational Mint remains BLOCKED.** The successful test
result means the absence of exclusion was reproduced, not that an interlock
passed. M1/M2/M3 remain proposals requiring approval. No implementation,
encoding, capability-policy, artifact, live image or hardware change is made.

This is a simulator expansion of the shared
[producer/observer inventory](namespace-update.md#producerobserver-inventory),
not a replacement for it. It evaluates the revised
[minimal interfaces](minimal-machine-interfaces.md), especially the M1/G4
dependency and M2's separate READ/verifier/COMMIT invocations.

## Finding and evidence boundary

A marker saying “admitted” cannot prevent a writer or activator that does not
consult an enforcing mechanism. Existing individual capability, bounds,
Namespace-write-window and image-configuration checks are real, but none of
the inspected paths establishes the proposed whole-update interval.

The probe captures **four actual physical old words**, permits an intervening
action, then compares **all four actual physical words** again. It never
implements BEGIN, Lambda READ, COMMIT, protected snapshots or FINISH. Those names
describe the proposed interval being modeled, not available APIs.

- The admission marker is explicitly inert test bookkeeping outside the
  simulator, retained throughout each case. It is not a fake machine interface.
- The RW alias, CR values, synthetic code, Thread frames and Namespace images
  are privileged fixture construction. They prove conditional behavior of
  existing paths, **not** lawful Mint provisioning, requester authentication,
  authorized NSRW access, or an exploit reachable by an unprivileged caller.
- No `mLoad`, write, activation or permission check is stubbed. Instruction
  handlers receive existing assembler-decoded instructions. Direct handler
  invocation does not prove compiled wrapper/dispatcher execution or retirement.
- The existing `lambdaActive` flag is tested both false (verifier gap) and true.
  Setting it is only a latch-boundary experiment, not execution of the proposed
  private same-artifact Lambda.
- JS calls are synchronous. The tests do not claim a browser callback can
  interrupt a single handler. Promise-scheduled work models a callback between
  separate operations; sequential instruction calls model instruction boundaries.
  Single-call synchrony does not span the proposed multi-invocation interval.

## Source map against the shared inventory

Paths below are repository-relative. Symbols are stable lookup anchors; the
[source fingerprints](exclusion-source-hashes.sha256) bind this inspection.
“Inspected” is not runtime coverage or proof that every configuration exposes
the path. All rows below lack a demonstrated Mint-wide interlock; existing
guards must not be removed in response.

| Shared actor / simulator path | Actual admission, mutation or observation | Evidence / remaining limit |
|---|---|---|
| Ordinary CPU memory writes | `simulator/simulator.js`: `_execDwrite` checks GT/W/bounds with `mLoad`, synchronizes DR home, then `_writeRuntimeWord`; `_execSave` validates S/domain/C-list constraints and writes capability rows. `_writeDR`, `_writeCR`, `_threadWrite` also write homes/protected state. | DWRITE alias and negative permission/bounds controls exercised. SAVE and home writers inspected, not individually raced. No test grants raw Thread-read authority. |
| Low-level RAM/image writes | `_writeRuntimeWord` tracks original words; `writePersistentWord` removes that overlay and writes RAM; direct `memory[index]`, `.set`, `.fill` bypass both helpers. | Typed-array ABA exercised. Runtime-original tracking is persistent-image bookkeeping, not write-history exclusion. Wrapping only one helper would miss direct writers. |
| Namespace setters and deletion | `withNamespaceWrite` temporarily enables `_allowAutoWrite`; `_assertNamespaceWriteAllowed`, `writeNSEntry`, `clearNSEntry` enforce action scope, slot bounds and built-in protections. `withNamespaceSave` has a separate built-in save depth. | Unscoped user-slot write rejects; scoped queued write succeeds during the marked interval. This scope authorizes a writer, not a lock against other writers. Built-in restrictions are not bypassed by the probe. |
| Host allocator/GC and registration | `markLive`, `markGarbage`, `runGC`, `lazyLoad`, `lazyEvict`, `_restoreOutformWords`, `_commitResidentInform` mutate body/table/bindings. `simulator/system_abstractions.js` has memory/Bank stores and Navana registration through `writeNSEntry`. | Inspected host dispatch paths; not qualified as Phase 1 Mint, nor all publicly reachable. GC G-bit masking in integrity is not exclusion. |
| Deferred loaders and ingress | `resolvePendingSlot`, `receiveLump`, `lazyLoad`, `loadLumpBinary` can install/relocate body, C-list and descriptors. `loadLumpBinary` limits execution-context refresh to the active slot or explicit activation. | Inspected only. Preventing a background C-list splice does not serialize every table write. Actual asynchronous app/dependency completions not driven. |
| CPU readers/observers | `readNSEntry`, `mLoad`, `_fetchInstruction`, LOAD, CALL/RETURN consume memory/authority. `snapshotPersistentMemory` reads original-overlay words; live diagnostics read current words. | Probe directly observes mixed old/new physical words between writes. This is host observation, not a claim that a malformed intermediate descriptor passes `mLoad`. A cached/persistent view is not proof of live equality. |
| CALL/RETURN and Lambda | `_execCall`, `_execReturn`, `_execLambda`, `_flushLambdaCache` write/read frames and live execution state. `lambdaActive` controls Lambda reentry/cache behavior. | Existing G1–G3 context probes remain separate. Latch-only DWRITE succeeds; same-Thread trusted verifier work would remain allowed by the proposal, but none of that proves exclusion of other actors. |
| Self and distinct Thread CHANGE | `_execChange` → `_execChangeCore` → `_activateChangeThread`; validates permission-free Inform identity, Thread geometry, incoming capability homes/resume frame/code, saves outgoing context through `_suspendLiveThread`, restores banks/PC. | Both self and distinct CHANGE succeed under a marker with unchanged four target words. This is activation/suspension evidence, not a new running-bit claim. Ordinary CHANGE requires a suspended continuation, not a poison-root shortcut. |
| Cross-Namespace SWITCH | Base `_execSwitch` is isolated-register LOAD with destination-M admission. `simulator/namespace-runtime-core.js` overrides CR15 SWITCH: validates source L view and target geometry, suspends outgoing Thread, installs CR15, activates destination slot 2, clears CR13. | Separate slot-0-header profile probe succeeds and activates the destination Thread while the original physical slot remains equal. No inference that the legacy tail-table loader or ascending executable-envelope admission has identical semantics. |
| IDE pause, Run/Step and selection | `simulator/app-run.js` selects/resets Threads; `selectConfiguredThread`/`advanceConfiguredThread` delegate to CHANGE; `step`/`run` gate on halt, pending work and loop state, not a Mint interval. | Selection while paused succeeds. Pause is not release of Thread ownership. Run/Step timer scheduling itself not driven in a browser. |
| Bootstrap/entry activation | `_bootStep`, `_activatePreformattedBootThread`, `_activateChangeThread(..., allowRoot)`; `NamespaceRuntimeCore.startEntryThread` accepts only a fresh non-faulted runtime. | Synthetic constructor boot and isolated slot-0 entry establish fixtures. They are not Mint admission. No prepared/live image is activated. |
| Image replacement/explicit activation | `loadBootImage`/`_loadBootImageCore` validate size, header and Thread images before copying; `loadProgram`, `loadLumpBinary`, `loadHardwareBinary`, `loadImageFromBinary` have configuration guards. `activateSimulationConfiguration` validates a detached candidate and requires Run/Walk stopped, then resets/loads/binds; `resetPreparedSimulation` uses retained approved bytes. `simulator/app-simulation-preparation.js` calls those explicit paths. | Inspected only; no image replacement or approval path invoked. Configuration/provenance guards are not an M1/G4 interval guard. Reset-only synthetic probe replaces the RAM object; no interrupted-publication containment is proven. |
| Direct IDE editing | `simulator/app-cr-detail.js`: `injectCRCode` and related code editing write bodies, C-lists and NS W0–W2 directly. `simulator/app-memory.js` uses `writePersistentWord` for zeroing, resizing and C-list edits. | Inspected host UI paths, not browser-tested and not permissionless ISA access. They must be included even if a particular release disables their UI. |
| Capture, baseline restore and retirement | `_suspendLiveThread` saves real homes/frame; `_captureThreadBaselines` copies configured Thread bodies; `resetThreadToBaseline` restores a copied body and, for an active Thread, reselects it without saving the overwritten context. Failed reselect restores previous state. | Real suspend/capture/baseline-reset exercised in synthetic RAM. No single-use checkpoint or Amobea rollback contract inferred from this programmer reset mechanism. Deletion/eviction and fresh image construction are additional lifecycle writers, not live-use clearance APIs. |
| Amobea self/external capture/restore | `simulator/amobea/src/ThreadStudio.tsx` checkpoint tab explicitly says “Execution blocked” and “Not captured, stored, restored, or tested”; `simulator/amobea/README.md` describes synthetic in-memory design views. | **Missing operational path.** No callable Amobea capture/restore service was found in the inspected runtime/system-abstraction paths. Proposed ownership/capture rules in Amobea §4.3 remain unimplemented evidence obligations, not covered by baseline reset. |
| IRQ/lazy suspension and fault/reset | `_fireSchedulerIRQ` depends on a registry and non-active IRQ state; pending-resolution and lazy loaders are profile-dependent. `fault` records diagnostics and halts; `reset` replaces/reinitializes state. | Inspected only except isolated reset and ordinary negative controls. No watchdog timing, all-context live-use scan, reset-domain quarantine, post-fault restart or IRQ-overlap acceptance is claimed. Do not infer active recovery merely from historical comments. |
| M6, raw UART, upload/init mux, snapshots and power loss | Existing hardware rows in `namespace-update.md` and S06–S09. | **Not exercised here.** Browser/Node event ordering is not FPGA admission, BRAM acceptance, bridge serialization, hardware observer or power-loss evidence. |

The inventory includes dormant paths without labelling them reachable exploits.
There is no selected-build reachability proof for every row. That missing
qualification itself prevents closing G4.

## Reproducible probes and observed results

Run from repository root; all machine mutations are in disposable Node memory:

```sh
node tests/mint_phase1/exclusion_probe.js
python3 -m pytest tests/mint_phase1/test_exclusion_evidence.py -q
sha256sum -c docs/reviews/mint-phase1/exclusion-source-hashes.sha256
python3 docs/reviews/mint-phase1/verify_review.py
```

The Node probe emits structured actual values and assertions; the Python
regression checks the case set and distinguishes expected gaps from acceptance.
It needs no server, secrets, saved LUMPs, generated boot file or hardware.

**Recorded check outcome:** the regression passed (18 asserted cases in one
pytest test); all nine new inspection fingerprints matched. The existing
`verify_review.py` passed local link/fragment and protected-decision checks,
then stopped on historical `source-hashes.sha256` drift at `replit.md`.
An independent comparison also found historical drift at
`server/namespace_design_v1.py`. Neither file was changed by this investigation.
The historical manifest was not silently repinned; the full historical review
check is **not passing**, and its later arithmetic section did not run.

| Probe | Observed outcome | Meaning |
|---|---|---|
| Unchanged control | Four-word equality true | Only a comparison control; does not establish exclusion. |
| Permission and bounds controls | Existing DWRITE checks reject, four target words unchanged | No permission-check stub or permissive engine replacement. |
| Changed W0, W1, W2, W3 independently | Each four-word comparison is false | Full comparison detects each changed word, including W2 and W3; generation-only comparison is inadequate. |
| DWRITE ABA, Lambda inactive and latch true | Four changed words observed, then eight total target writes leave all four exactly equal to READ | Equality misses intervening mutation in either state. Observations after individual writes include mixed old/new words. |
| Queued scoped Namespace writer | Unscoped call rejects; scoped call changes all four words despite retained marker | Writer-action scope is real but is not update-wide serialization. |
| Direct typed-array ABA | `[1,2,3,4]` observed, then original four words restored | Low-level/host writers also need coverage; no unprivileged access claim. |
| Self CHANGE, distinct CHANGE, paused IDE selection | Accepted; distinct activation changes slot 1 → 11; four target words still equal | Descriptor equality says nothing about context activation or stale live-use clearance. |
| Other-Thread ABA and return | Thread 1 → 11; Thread 11 uses its restored fixture-granted RW alias to change and restore all four words; selection returns to Thread 1 | Both active Thread identity and four-word equality can be restored after another writer acted. The extra writer grant is test privilege, not approved Mint provisioning. |
| Suspend/capture/baseline reset | DR home restored and current Thread reselected; target descriptor unchanged | Implemented programmer baseline restore is an independent state mutator, not Amobea acceptance. |
| Reset | RAM object replaced; target comparison fails | Marker cannot certify fault/reset containment or safe resumption. |
| Cross-Namespace SWITCH | CR15 base 0 → 8192 and CR12 base → 8448; original physical slot unchanged | Equality must not follow redirected CR15; root/activation binding is a separate obligation. |

The DWRITE ABA uses old words
`[4096, 14680127, 3735183091, 1241972776]`.
Each is XORed with 1 and then restored. W1's generation remains unchanged even
in the altered state. The test observes the intervening words, rather than
inferring mutation from a final equal value. No retry, repair, history counter
or operational COMMIT is introduced.

The slot-0 probe compares the **original physical address**, not a new
table selected through CR15. It does not prove request/target/Namespace binding
is enforced by M2; that interface does not exist.

## Consequences for the revised interfaces and gate register

1. **M1/G4:** no existing BEGIN/FINISH service or machine-owned invocation guard
   is demonstrated. Operational BEGIN must still fail before mutation unless
   exclusion can be established. A browser flag, per-call write window, paused
   run loop or `lambdaActive` is not that guarantee.
2. **M2:** compare all four old words and bind physical Namespace, request,
   target and invocation. That is necessary but insufficient: mutation can
   restore all four words, and activation can change without touching them.
   READ → verifier → COMMIT needs continuous enforcement, not just a Lambda
   leaf-code restriction or a final reread. Post-write confirmation remains a
   distinct completion check and cannot hide earlier observations.
3. **G3/Amobea:** no all-context clearance or checkpoint activation exclusion
   is proven. Self CHANGE is continuous ownership, not proof that an admission
   boundary excluded a second context. Baseline reset must not be relabelled
   Amobea capture/restore.
4. **G4 interruptions:** V15–V17 fault cuts and hardware acceptance remain
   unexecuted. A successful negative regression cannot authorize COMMIT,
   partial-state reuse after reset, gate closure or an operational Mint claim.
5. **Proposed mechanism, not current behavior:** a future approved mechanism
   would need to control every applicable producer/observer across the whole
   interval, retain coherent request/live-use evidence, and fail closed on loss
   of exclusion. Whether that is a minimal interlock or a genuinely enforceable
   restriction remains a review decision. This report chooses no encoding,
   new counter, raw Thread grant, transaction engine or implementation.

No G1–G8 policy decision, approval ledger, residency, 17-entry layout, credential
recipient, artifact, saved Namespace or live image was changed.
