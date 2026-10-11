# Bitstream candidate readiness

Date: 2026-10-11  
Reviewed workspace baseline: `1ded0e031dfd1780547e53bb100e7760b9ab6286`  
Disposition: **NOT READY for candidate freeze, synthesis authorization or FPGA acceptance.**

## Scope and method

Read-only source/evidence review against
[the alignment plan](../docs/releases/isa-to-fpga-alignment-plan.md) and
[System Namespace handoff draft](../docs/system-namespace-handoff-contract.md).
Only this report and its documentation link are created; no implementation,
catalog, saved LUMP, Namespace, build, reset, upload or board operation is changed.
No functional tests were rerun. Historical test results below are attributed,
not presented as current-baseline passes or newly reproduced failures.

Source search covered the simulator, server and hardware for the standard
handoff. The identified compiler “handoff” references concern source assembly,
and server/build_handoff.py records programmer release metadata. Neither is
evidence of runtime Namespace activation. This review did not establish an
implemented end-to-end System Namespace handoff; absence of a search hit alone
is not proof that no reusable lower-level mechanism exists.

## 1. Bounded first-candidate target

Proposed acceptance target:

**Boot → required 3LL diagnostics → reprogrammable System Namespace handoff →
selected test application.**

Demonstrate two explicitly selected application configurations under the same
FPGA bitstream, correct completion/recovery, rejection before activation, and
no mixed Namespace/Thread execution. Use explicit IDE delivery first.

Retain the existing three-resident-LUMP baseline unless a separate residency
change is approved. Delivery and placement of the System Namespace must be
specified; neither its name nor this report authorizes a fourth resident LUMP.

Keep lazy loading, Namespace GC, expanded multithreading, Ethernet, HDMI, IDE
tunnels and networked CMs explicitly in the System Namespace roadmap. They are
not all prerequisites for this first bounded demonstration. Any capability
actually used by this candidate must nevertheless be implemented and tested.

Recommend keeping operational ide.Mint out of this first handoff dependency:
deliver a validated configuration through the IDE, rather than enabling the
dormant writer to unblock startup. This is a recommendation, not an approved
replacement of the existing release selection.

## 2. Evidence and implementation gaps

| Requirement / gate | Evidence inspected | Gap and next action |
|---|---|---|
| Approved red-ISA contract, Gate 1 | Alignment plan; reports/isa-instruction-contract-matrix.md explicitly labels its October 2 audit historical | Reconcile latest decisions into one release-scoped ledger. Do not treat every old “open” item as still open: e.g. width 1–31 was subsequently selected for bitfields and CHANGE privilege wording requires latest-authority reconciliation. Freeze exact encodings, effects and fault rules. |
| Boot roots and CHANGE, Gates 2–3 | reports/root-frame-candidate-review.md records corrected executable-limit handling and 87 passing boot/scheduler tests | Original BOUNDS finding is superseded by the correction. Report explicitly says no approval was frozen and fresh elaboration provenance remained outstanding. Revalidate the selected exact inputs, not a repaired historical snapshot. |
| Initializer fidelity, Gate 4 | reports/initializer-reset-faithful-validation.md records matching 2,693 initializer pairs and reset-faithful replay | Evidence is for a mapped initializer inside an optimized word-level full-system model, not a fully mapped chip or physical board. Bind fresh candidate initializer/projection evidence to current sources. |
| Standard Namespace handoff, Gates 1–4 | docs/system-namespace-handoff-contract.md is expressly a mechanism/ABI draft | Define safe boundary, authorized selector, descriptor, coherent Namespace/Thread transition, completion and fault behavior; then implement and test in compiler/simulator/RTL as needed. No new opcode is implied. |
| Reprogrammable delivery, Gates 2–3 | Existing IDE upload and build-metadata paths; no demonstrated standard handoff in this review | Specify stopped delivery versus live replacement, frozen request identity, validation, external-writer exclusion and activation acknowledgement. Existing upload success cannot substitute for handoff proof. |
| System Namespace fixtures, Gate 3 | Draft purpose and test matrix exist | Select or construct isolated System Namespace and two application fixtures with exact roots, C-Lists and authority. No artifact selection or new bytes were frozen in this review. |
| Minimum startup trust, Gate 1 | Existing admission docs distinguish human/IDE-vouched bootstrap from deferred verified provenance | Record exactly what this local candidate trusts and what it does not. Genesis agreement is pending; do not design its mechanisms or claim network trust here. Determine the minimum agreed local boundary before freezing executable authority. |
| ide.Mint | hardware/core.py now uses full resulting GT for W3 in both profiles; tests/hardware/test_mint_bootstrap_token.py provides structural/encoding regressions | This correction does not implement the CLOOMC abstraction or prove R1–R3. Keep ingress closed unless proof/authorization, allocation, ABI and bounded write/reset contracts are resolved and executed. |
| Physical resource authority | Shared catalog and Wukong profile previously inspected; ownership agreement covers all hand-crafted capabilities | Freeze exact selected driver/resource grants and runtime holders. Full board/carrier inventory remains provisional. Do not inherit broad device authority or treat unimplemented devices as present in the selected bitstream. |
| Golden checkpoints, Gates 1–6 | Alignment plan requires independent layouts, full CR triples, memory and accepted-write events | Create handoff-specific expected states and deltas, with byte/word units and authorized changes. Neither simulator output alone nor matching final memory is a sufficient oracle. |
| Build and physical acceptance, Gates 5–6 | Older retained build/replay reports are available | No fresh exact candidate build or board acceptance established here. Require source/input hashes, timing, complete bundle and correlated physical capture after authorization. |

## 3. Retained workflow failure triage

Workflow statuses and retained logs were inspected on 2026-10-11. Their run
provenance is not sufficient to assert these failures reproduce at the reviewed
commit. This is a risk classification, not completed root-cause analysis.

| Retained result | Observed evidence | Release treatment |
|---|---|---|
| boot-image-matches-sim: FAILED | Retained log: 18 failed, 8 passed; failures include mandatory NS slot 2 zeroed | Candidate geometry/device authority risk. Reproduce against isolated selected inputs; check actual NS[2] UART entry. Do not remove the guard or assume fixture drift. |
| lump-consistency: FAILED | Retained log: 4 failed, 1,346 passed, 11 skipped; malformed C-list GT checks include two Ethernet artifacts and two token-named artifacts | Map every failing artifact to the frozen candidate dependency graph. Selected/dependent failures block; unselected failures require explicit exclusion evidence, not a blanket waiver. |
| assembler-tests: FAILED | Retained output includes passing sub-suite summaries but does not identify the failing stage in the inspected excerpt | Recover complete exit-stage evidence or rerun the appropriate isolated suite. Do not label the workflow green because some sub-suites passed. |
| all-tests: FAILED | Retrieved retained log supplies failed status without actionable failure detail | Aggregate status cannot diagnose or certify a release. Collect per-suite results after candidate scope is fixed. |
| boot-image-upload-endpoint, boot-image-serve-endpoints, boot-rom-no-false-halt, wukong-boot-rom-guard: FAILED statuses | No new failure traces returned by log refresh for these workflows | Potential direct impact on boot/delivery/recovery. Reproduce in private fixtures before freeze. No assertion here about current root cause. |
| check-selftest-lump-stale, check-capabilities-blocks, check-api-reference-stale: FAILED statuses | No new traces available in this review | Inspect against selected source/bytes; source drift and declared authority may affect release. Documentation failure alone is not proof of runtime failure. |
| e2e-tests, ns-slot-modal-persist-tests: FAILED statuses | No fresh traces available | Include if they affect exact selection, persistence or the delivery path. Otherwise document scope exclusion. |
| Several focused boot, fault, threading and command workflows: FINISHED | Status records exist, but not all provide fresh source/input-correlated output | Preserve useful evidence; FINISHED is not a certificate for this new candidate. |

Do not run destructive suites against live shared catalogs merely to clear this
table. Test isolation must include all persistence inputs used by regeneration.
No current-baseline failure count is claimed.

## 4. Bounded implementation sequence

1. **Contract closure:** produce the release decision ledger and exact handoff
   ABI/transition proposal. Resolve the relevant local trust, Namespace geometry,
   entry authority, diagnostics and recovery decisions. Design Team approves.
2. **One vertical implementation:** implement authorized target selection,
   prepare/validate, a safe activation boundary and correlated outcome. Connect
   3LL to a minimal System Namespace and two selectable test applications.
   Reuse existing instructions where their approved semantics suffice.
3. **Simulator and compiler proof:** independent encoding/state expectations,
   complete successful paths and all denial/interruption cases below.
4. **Isolated release triage and freeze:** resolve selected-artifact failures,
   preserve unrelated live data, freeze exact inputs and independently checked
   generic image, resident projection and initializer expectations.
5. **RTL/synthesized replay:** prove the same checkpoints and containment with
   exact candidate bytes and fresh elaboration provenance.
6. **Authorized build and physical run:** qualify timing and artifact bundle;
   then perform separately authorized programming and acceptance.

Implementation belongs to Replit Agent; Design Team owns contracts and sign-off.
Independent review challenges the result and does not replace physical evidence.

## 5. Exact required acceptance cases

The following are required test specifications, not claims of existing tests:

| ID | Case | Required observation |
|---|---|---|
| H01 | Valid startup | Exact boot checkpoints; diagnostic result and authorized System Namespace entry |
| H02 | Required diagnostic fails | No application entry or handoff-authority publication; retained cause |
| H03 | Select application A, then B | Same FPGA bitstream; distinct exact selected identities and expected contexts; no hard-coded destination list |
| H04 | Invalid/missing/stale target or dependency | Reject activation; no unauthorized target writes or mixed execution |
| H05 | Selection changes during preparation | Frozen request wins only with valid ownership, or explicit conflict; no silent retarget |
| H06 | Coherent transition | CR15 and incoming Thread/executable/C-List/stack authority agree at first target retirement; no old-context execution under new Namespace |
| H07 | Interrupt delivery/activation at each boundary | Defined pre/post-activation outcome; no inferred rollback or blind retry after lost reply |
| H08 | Competing upload/init | Proven exclusion or accepted writes; no silent lost installation write |
| H09 | Application completion and fault | Defined continuation or approved recovery; retained fault identity; no accidental fallthrough into 3LL |
| H10 | Permission and bounds negatives | No escalation from selectors, malformed GTs or cross-Namespace references; exact fault effects |
| H11 | Repeated starts/handoffs | Stable protected roots, stacks and allocations; no unintended authority/state drift |
| H12 | Required device unavailable | Explicit refusal before dependent application entry; no simulated result counted as physical support |

Reuse existing regression entry points after fixture/scope review:

- `python3 -m pytest hardware/test_boot_change.py hardware/test_wukong_thread_scheduler_contract.py -q`
- `node simulator/test_compiler_method_assembly.js`
- `node tests/simulator/sim_boot_three_instruction.js`
- `python3 -m pytest tests/hardware/test_mint_bootstrap_token.py hardware/test_outform_mode2.py hardware/test_mwin_seal.py -q -k 'not core_integration'`

These do not cover H01–H12 by themselves. In particular, the Mint source test is
not successful-Mint simulation. Review scripts/prepare_root_frame_candidate.py
and the release-check entry points before running them on isolated inputs; do
not let a generic release script silently select live data or perform a build.

## 6. Next action and go/no-go rule

**Next engineering action:** close the Namespace/Thread handoff contract and
map its precise transition onto existing ISA mechanisms. In parallel, recover
isolated current-baseline evidence for selected boot/compiler failures.

Proceed to build only when Gates 1–4 have exact-input passing evidence, relevant
failures are resolved or explicitly excluded, and build authorization is given.
The roadmap can stay open-ended without making the first candidate unbounded.
