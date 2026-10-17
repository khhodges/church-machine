# Inspected source and provenance

**Inspection base:** Git `931b399166a78ce7c52725da78fa9714481ea456`.
Initial `git status --short` was empty. Inspection date: 2026-10-17.
Only this review package, the root threat reference and the existing Mint
contract navigation/supersession notice are changed by this work. No source
modifications were used as evidence. [source-hashes.sha256](source-hashes.sha256)
pins the inspected source bytes, including relevant historical inputs, independently
of line-number drift. The existing Mint contract is the sole dirty source
document in that hash list: its hash covers the **post-notice/link-repair** bytes.
Its base-revision/pre-notice SHA-256 was
`4a2e78714fa65889cbc88a79fc78328e2333e4e30ace9a83ea637acdb6a2539b`.
Historical prose is preserved below the new notice.

All S identifiers below mean **INSPECTED**, not runtime PASS. Every citation
inherits this revision plus its per-file SHA-256. Named symbols and ranges are
given together; consult code rather than comments where they disagree. Root
generated Verilog and the archival RTL collection are not the active source.

## S01 — Hardware authority and representation

- [Master ISA](../../phase-1/01-isa/instruction-set.md#L89-L128):
  “Capability operations and calls,” RETURN keep mask and oracle closure.
  Lines 645–800: generations, T, software boundaries and old Mint TBDs.
  Lines 1309–1343: “Active Namespace geometry.”
- [layouts.py](../../../hardware/layouts.py#L78-L112): `GT_LAYOUT`,
  `CAP_REG_LAYOUT`, `WORD2_LAYOUT`. Public GT/descriptor layouts, not PassKey
  authorization records.
- [integrity32.py](../../../hardware/integrity32.py#L33-L58):
  `integrity32`, `integrity32_amaranth`; public unkeyed corruption check.
- [foundation](../../cloomc-foundation.md#L237-L290): “Trusted Security Base”
  design principle, not current slot/layout authority or formal proof.

## S02 — Lambda binding and continuation gap

- [lambda_unit.py](../../../hardware/lambda_unit.py#L8-L80):
  `ChurchLambda.elaborate`, CHECK_PERM/EXECUTE. Architectural type-NULL and
  Turing-X check; target location becomes NIA. No Mint transaction interface.
- [core.py](../../../hardware/core.py#L1370-L1435):
  `ChurchCore.elaborate`, `lambda_active_reg`, `lambda_pc_reg`,
  `u_cload.cload_start`, `cross_domain_ret`: CR6 reconstruction after RETURN.
- [ret.py](../../../hardware/ret.py#L200-L258):
  `ChurchReturn.elaborate`, IDLE/LAMBDA_FAST, latched code and PC;
  LAMBDA_FAST does not pop the simulator's protected Lambda frame.
- [simulator.js](../../../simulator/simulator.js#L9351-L9437):
  `ChurchSimulator._execLambda`: validates via mLoad, records protected
  continuation/shadow state and increments PC inline. This does not demonstrate
  the hardware location-target internal binding proposed for Mint.

## S03 — Requester/frame authority, CALL/RETURN and host shadows

- [call.py](../../../hardware/call.py#L195-L237): `ChurchCall.elaborate`,
  `caller_egt_from_cr6`, `caller_egt_latched`; normalized caller E authority.
  Lines 461–540 capture inputs and caller before callee transition;
  lines 780–810 write protected frame/caller word.
- [stack_frame.py](../../../hardware/stack_frame.py#L1-L45):
  `stack_slot_addr`, protected STO at Thread +17 outside ordinary heap.
- [ret.py](../../../hardware/ret.py#L200-L300): `ChurchReturn.elaborate`;
  revalidation and protected storage, not a service-facing provenance API.
- [simulator.js](../../../simulator/simulator.js#L8307-L8350):
  `_execReturnCore` explicitly treats `callStack` as diagnostic, not
  frame-selection authority. Lines 7436–7715 `_execCallCore` handle caller
  continuation; do not substitute host state for authenticated hierarchy.
- [change.py](../../../hardware/change.py#L170-L190):
  `ChurchChange.elaborate`, L/S permission predicates; lines 450–505 admission.
  Thread rights/activation need matching ABI evidence.

## S04 — Compiler, HARDFAULT and maps

- [cloomc_compiler.js](../../../simulator/cloomc_compiler.js#L1673-L1700):
  `CLOOMCCompiler._parseMethodParameter` preserves capability/value distinction.
  Lines 1205–1225 and 3508–3526 assign scalar parameter registers. These do not
  automatically implement this service's proposed capability ABI.
- [assembler.js](../../../simulator/assembler.js#L1915-L1930):
  `ChurchAssembler._assembleLine` HARDFAULT branch rejects emission pending
  map-binding/target approval.
- [hardfault-map.js](../../../simulator/hardfault-map.js#L1-L95):
  `normalize`, `createVerifier`, `signingBytes`, `api`. Exact artifact/code/site,
  occurrence, fault-word and signature checks; production pins empty,
  `emissionEnabled: false`. Test-key verification is not deployment trust.

## S05 — Non-implementations

- [legacy mint.cloomc](../../../simulator/cloomc/mint.cloomc#L1-L97):
  `Mint.Encode`, `Revoke`, `Transfer`; older bit layout/seven-bit wrap and data
  GT results are not the five-operation contract.
- [Mint draft](../../archive/phase-1-expanded-collection/source-drafts/ide.Mint.cloomc):
  Create/Replace/ForgePassKey and `TODO_*` branches; no completed service.
- [Lambda fragment](../../archive/phase-1-expanded-collection/source-drafts/ns-slot-lambda.cloomc):
  `TODO_SINGLE_SLOT_WRITE_PROTOCOL`, unapproved scratch/provisioning.
- [verifier draft](../../archive/phase-1-expanded-collection/source-drafts/pkverify.cloomc):
  Verify, `TODO_REQUIRE_COMPLETE_BOUND_PROOFS`; sample compare is not Q14 proof.
- [draft README](../../archive/phase-1-expanded-collection/source-drafts/README.md):
  deliberate compiler blockers and historical syntax-check scope.

## S06 — CPU writes and admission

- [dwrite.py](../../../hardware/dwrite.py#L8-L200):
  `ChurchDWrite.elaborate`, latched inputs and PERM_CHECK/MEM_WRITE path;
  instruction bounds/serialization, not whole software sequence exclusion.
- [dread.py](../../../hardware/dread.py#L1-L180):
  `ChurchDRead.elaborate`; checked data reads, no multiword snapshot primitive.
- [core.py](../../../hardware/core.py#L447-L520):
  `ChurchCore.elaborate`, `any_unit_busy`, `lambda_start_sig`;
  lines 1822–1848 `thread_switch_start_sig` admitted when not busy;
  lines 2279–2335 and 2513–2570 legacy MINT_WRITE_NS states advance
  sequentially; actual state names are searchable independent of line drift.
- [core.py](../../../hardware/core.py#L1350-L1435): normal CALL and Lambda
  clear/set continuation latches; a latch alone is not update exclusion.

## S07 — Actual Wukong memory/control observers

- [wukong_top.py](../../../hardware/wukong_top.py#L988-L1025):
  `ChurchWukongXC7A100T.elaborate`, hw_init/upload/CPU `dmem_wr` priority.
- [wukong_top.py](../../../hardware/wukong_top.py#L1041-L1102):
  M6 debounce, configured Thread count and `core.thread_switch_req`.
- [wukong_top.py](../../../hardware/wukong_top.py#L1230-L1450):
  UART control/upload receive handling, separate maintenance inputs.
- [wukong_top.py](../../../hardware/wukong_top.py#L1580-L1790):
  snapshot FSM, `snapshot_mem_rd`, `snap_mem_addr`, selected Thread/heap reads
  and serialized response. No arbitrary Namespace dump inferred.

## S08 — Namespace consumers and dormant ingress

- [ns_gate.py](../../../hardware/ns_gate.py#L9-L155):
  `ChurchNSGate.elaborate`, sequential descriptor reads/integrity/version;
  no whole Mint publication primitive.
- [church_outform.py](../../../hardware/church_outform.py#L1-L180):
  `ChurchOutformFSM.elaborate`, OUTFORM_UNAUTH containment.
- [mload.py](../../../hardware/mload.py):
  `ChurchMLoad.elaborate`, OUTFORM_UNAUTH branch before legacy download trigger.
  This is current ingress containment, not authorization to use dormant Mint.

## S09 — Bridge and server control boundary

- [wukong_bridge.py](../../../hardware/wukong_bridge.py#L337-L366):
  `try_parse_halt_state_frame`, `halt_state_evidence_matches_pending` correlate
  nonce; not cryptographic authentication.
- [wukong_bridge.py](../../../hardware/wukong_bridge.py#L1703-L1750):
  `main`: HTTP default, HTTPS certificate verification unless `--insecure`.
  Lines 787–849 `decode_snapshot_frame`: structural/CRC decode, not secrecy.
  Lines 2659–2815 `_handle_upload`: existing binary transport, not secret setup.
- [app.py](../../../server/app.py#L24231-L24535):
  `wukong_command_ack_post`, `wukong_halt_state_post`, `wukong_upload_ack_post`,
  `_wukong_command_lock`. Command correlation is not a Mint vault or RAM lock.
- [replit.md](../../../replit.md#L26-L48): FW=2 plaintext / FW=3 proposal;
  the unconditional HTTPS-verification statement is stale relative to `main`.

## S10 — Persistence patterns, not a credential store

- [models.py](../../../server/models.py#L16-L145): `register_models`, ordinary
  Project/Device/FaultEvent/trace/log records.
- [change_confirmation.py](../../../server/change_confirmation.py#L409-L495):
  `IntentStore._connect`, `issue`; explicit BEGIN IMMEDIATE pattern, no Q54
  credential/pool/counter store.
- [artifact_revisions.py](../../../server/artifact_revisions.py#L18-L90):
  `RevisionStore.publish/read`, file fsync, directory rename/fsync and hashes.
  Immutable artifact publication is not encrypted security-record persistence.

## S11 — Boot/name/profile binding

- [namespace_design_v1.py](../../../server/namespace_design_v1.py#L29-L81):
  `seed`, `phase1_seed`; Boot.NS slot 1, Boot.Thread slot 2; old `nstab`/
  `pkverify` labels, Resident intent, 256-slot Phase 1 metadata. This file says
  it never publishes executable image bytes; not a live Namespace observation.

## S12 — Prior evidence candidates and isolated checks

These are reproducible **future candidate commands**, NOT RUN here. Inspect their
fixtures/conftest and indirect dependencies for live-state writes before use.

| Command from repository root | Scope, not a new Mint assurance result |
|---|---|
| `node simulator/test_lambda_exec.js` | JS Lambda model |
| `node simulator/test_return_protected_validation.js` | JS protected RETURN |
| `node simulator/test_return_keep_mask.js` | JS mask behavior |
| `python3 -m pytest tests/gates/test_lambda_cr6_reentry.py -q` | Python wrapper invokes a **JS** harness, not RTL |
| `python3 -m pytest tests/hardware/test_return_stack_contract.py -q` | RETURN-focused hardware test, not requester service |
| `python3 -m pytest tests/hardware/test_mint_bootstrap_token.py -q` | AST/source-expression checks of dormant Mint W3/GT, not executed RAM |
| `python3 -m pytest tests/devices/test_mint_bram_writes.py -q` | Legacy installation fixture, not new credential service |
| `python3 -m pytest tests/server/test_change_confirmation.py tests/server/test_artifact_revisions.py -q` | Ordinary persistence fixtures, not Q54 |

The [historical hardware review](../../ide-mint-hardware-atomicity-review.md)
records its own three-test Mode-2 result and exclusions; not rerun or promoted.
No candidate test above was assumed safe merely from its filename.
