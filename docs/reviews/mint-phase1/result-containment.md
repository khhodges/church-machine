# M3 result delivery — bounded feasibility and containment investigation

## Subsequent LOAD correction

The ordinary non-CR6 L-only header access defect described in the historical
investigation below is now corrected. LOAD resolves both header metadata and
the indexed capability using L authority, without requiring R. CR6 keeps its
E-only GT; its register M bit supplies elevated LOAD authority, rather than an
unconditional exemption based on register number. Ordinary identity, source
generation, integrity and range checks remain in place.

The updated isolated probe has **24 passing checks**, including assembled
LOAD → DWRITE through an ordinary L-only source, successful use of the returned
capability, denial of data reads through that L view, E-only CR6 with M set/
cleared, and unchanged source GTs. The original failure characterization was
replaced by a positive regression; the other containment probes remain.

This fixes one delivery prerequisite only. It does not implement M1–M3, authorize
result manufacture, resolve target-generation-at-LOAD policy, establish G4
exclusion, or close the fault/diagnostic containment findings. The original
source hashes below remain historical, not fingerprints of this corrected code.

## Historical investigation

**2026-10-17 · Isolated JS component evidence, not operational Mint acceptance.**

This assesses [M3](minimal-machine-interfaces.md#m3--private-gt-result-delivery-using-ordinary-load)
against the [security boundary](security.md), especially I5/I8 and fault-before-
cleanup. **M3 is not ready to provision or activate.** Address bounds work in the
tested cases; publication-bound value/timing enforcement and whole-lifecycle
privacy do not follow from those bounds. A usable ordinary non-CR6 L-only LOAD
path is also blocked. No permit or other new authority was implemented.

## Evidence and reproducibility

Run from the repository root:

```sh
node --test tests/mint_phase1/result_containment_probe.js
python3 -m pytest tests/mint_phase1/test_result_containment.py -q
sha256sum -c docs/reviews/mint-phase1/result-source-hashes.sha256
python3 docs/reviews/mint-phase1/verify_review.py
```

The Node suite has **20 passing checks**. Some checks deliberately assert
acceptance of unsafe operations under test privilege; PASS means the observed
behavior was reproduced, **not that M3 passed a security acceptance gate**.
The pytest wrapper makes this probe discoverable with the existing component
tests. Source fingerprints are separate from the original review's historical
source set; neither set authenticates artifacts.

Validation outcome: the Node checks, pytest wrapper, five current source hashes
and `git diff --check` pass. The existing `verify_review.py` passes its link and
57-decision-ledger checks, then stops at historical **Source drift: replit.md**.
Inspection of the full historical hash list also finds
`server/namespace_design_v1.py` drift. Both already differ in HEAD and are
unchanged by this investigation. Historical fingerprints were deliberately not
rewritten to turn that unrelated provenance failure green. No UI changes were
made; the IDE workflow was not running, so an attempted preview capture could
not connect. It was not started merely for this memory-only investigation.

[Probe](../../../tests/mint_phase1/result_containment_probe.js) uses fresh
`ChurchSimulator` instances and real `mLoad`, `_execLoad`, `_execDread`,
`_execDwrite`, `_execSave`, `fault`, `_returnToBoot` and `reset` paths. No gate
is stubbed. Instruction helpers receive decoded-shaped operands: this does not
exercise fetch/decoder, compiled Mint, CALL/Lambda binding, service admission,
RETURN masks, loader provisioning, browser transport, RTL or hardware. Fault
injection calls the actual fault handler at explicit boundaries; `step()` then
confirms the halted machine cannot continue. No interrupted call is resumed.

### Test privilege, not legal provisioning

All initial RAM, Namespace descriptors and CR assignments are **test privilege**.
The harness does not obtain these through approved Mint/Genesis provisioning.
In particular, installing a result C-list base in CR6 is a synthetic scope
assignment, **not** a demonstrated reload, same-scope Lambda, private alias
grant, operational Mint entry or legal caller access.

| Fixture item | Test-only placement / purpose |
|---|---|
| Thread | slot 1, words 0–255, synthetic header `f900820c`; CR1 home at word 245 |
| Result-list backing object | slot 40, base `0x2000`, limit 63; synthetic ordinary header `f8000402`, one code word, two C-list rows |
| C-list framing | row 0 at `0x203e` is SELF; row 1 at `0x203f` is the sole result; this is not a canonical compiled LUMP |
| Private list L view | CR8; CR6 points at row 0 only in explicitly privileged component tests |
| Private one-word RW alias | slot 41, base `0x203f`, limit 0, CR9 |
| Adversarial overlapping RW alias | slot 42, base `0x2000`, limit 127, CR10; intentionally introduced by the test, never a legal caller grant |
| Disjoint view / alternate result target | slot 43, base `0x2080`, limit 15, CR11 |
| Intended object target | slot 44, base `0x3000`, limit 15 |

There are **five test descriptors beyond the Thread**, including two private
result-view descriptors, the adversarial overlap and two target objects. These
are not substitutions for the approved 17 entries. All ordinary fixture tokens
have B=0, M=0 and no M elevation; malformed words are explicit negative inputs.
No mixed RW+L token is accepted. No direct host write to the result CR substitutes
for LOAD. The DR contains data bits only until real LOAD materializes authority.

## Real access and mutation paths

References below name the inspected symbols in
[simulator.js](../../../simulator/simulator.js), pinned in
[source hashes](result-source-hashes.sha256).

| Path | Actual enforcement and limitation |
|---|---|
| `mLoad` / `_validateClistSlotPerms` | NULL/type-field and malformed/domain checks, Namespace index/entry, Bank-specific private ranges, source generation, descriptor integrity, required permission and inclusive address bounds. Those Bank rules are not general Mint-result protection. `markLive` is bookkeeping, not admission or a publication permit. |
| `_execDwrite` | Ordinary RAM writes require W through `mLoad`; the DR home is synchronized, then `_writeRuntimeWord` stores the raw 32-bit value. No result-word type, publication state, invocation, exact GT, target grant or one-use check occurs. Abstract/MMIO dispatches are separate paths, not exercised here. |
| `_execDread` | Ordinary RAM reads require R and bounds through `mLoad`, then copy data to a DR and its Thread home. No M3 private-range policy is present. Reading GT bits as data is not itself CR authority. |
| `_execLoad` non-CR6 | `_capRead(..., 'R')` reads the header before the subsequent L check. L-only therefore fails R; R-only gets through the header but fails L; combining Church/Turing permissions fails purity. Header geometry determines C-list rows, but it does not solve lawful access to that header. |
| `_execLoad` CR6 | Uses the already-installed C-list base and `_clistCountForCR`; source `mLoad` requires no permission for CR6. It validates row bounds, NULL/malformed values and the Inform target descriptor seal before `_writeCR`. That privileged scope is not a general-purpose M3 solution. |
| Inform result generation | LOAD validates the source-view generation, but the inspected Inform target branch validates its seal without comparing the result GT's generation. A stale result reaches CR1 in the probe; a later DWRITE using it fails VERSION with no target write. Do not claim all target validation occurs at materialization. |
| `_execSave` / `mSave` | Ordinary B=0 export fails BIND; row 0 has a separate immutable-SELF check. This does not stop a raw DWRITE through a separately granted RW alias, nor redact diagnostic copies. |
| `_writeCR`, `_writeDR` | Result capabilities and data are also written to the active Thread's CR/DR homes. The result cell is not the only copy to contain. |
| `_writeRuntimeWord`, `snapshotPersistentMemory` | Runtime mutation tracks originals for static-image serialization, not secrecy. In this fixture, persistent-memory snapshotting returns the original zero result cell while live RAM retains the written GT. It does not erase RAM, CRs, DRs or fault evidence. |

The seal here is the existing descriptor integrity check, not authentication of
Mint issuance. Nothing in this experiment changes GT packing, B ceilings,
generation semantics, compiler authority or ordinary access rules.

## Observed access controls versus demonstrated weaknesses

| Case | Outcome and bounded interpretation |
|---|---|
| Next/previous word through limit-0 RW view | RANGE fault; both neighbor and result are unchanged. The previous-word probe uses the existing compact-index helper input. This establishes the tested spatial bounds only. |
| No view; disjoint view outside its own range | NULL_CAP / RANGE; no result read. Merely knowing the result address supplies no access in these paths. |
| L-only DREAD, or X access check on the RW/L views | PERMISSION. X checks are `mLoad` checks, not a full execute/map/control-transfer test. No general alias-creation or mapping authority is demonstrated. |
| Stale source RW view | VERSION before a result write. |
| Mixed-domain source/result, NULL result, out-of-range C-list row, corrupt target seal | Rejected by the existing gates. The fixture disables pet-name resolution, so unnamed NULL is a hard fault, not a lazy-resolution test. |
| Early/pre-publication write | Accepted. There is no BEGIN, PkVerify, confirmed publication, permission-bound permit or active Mint invocation in this fixture. |
| Duplicate write; arbitrary `deadbeef`; canonical zero; alternate valid target GT | All DWRITEs accepted at the designated address. Invalid bytes need not load, but an alternate valid target does materialize through the test-installed CR6. Current access checks cannot distinguish an authorized published result from that forgery under the introduced manufacturing privilege. |
| Intended B=0 GT through CR6 | LOAD supplies CR1 and actual DWRITE through CR1 changes the intended object's RAM. Ordinary SAVE still fails BIND. This proves the component manufacturing mechanism, not its authorization. |
| Broader overlapping alias | DREAD copies the result; DWRITE replaces it and can overwrite the neighboring SELF row. Narrow bounds on slot 41 do not constrain another descriptor. No global result-cell or framing guard protects against that alias. |
| Repeated LOAD | The same result loads twice; LOAD is not consuming. After zeroing the cell, another LOAD faults NULL_CAP but retains the earlier CR1 result. |

The successful overlap attacks assume the test-provided alias. They do **not**
show an unprivileged caller can invent a CR, install a Namespace entry, obtain
that alias, or escape an otherwise proven private configuration. Conversely,
absence of an alias in a positive fixture is not proof that real provisioning,
Thread switching, diagnostics and loaders keep all such aliases inaccessible.

## Fault, cleanup, reuse and reset

These boundaries are examined independently, not as a new recovery policy:

| Injection/boundary | Concrete observation |
|---|---|
| Before write | Cell remains zero; private RW/L views already appear in the emitted fault's CR snapshot. Privacy must hold even before a result exists. |
| After write / before LOAD | Cell retains the GT; the producer's DR and fault DR snapshot retain data bits. Private views remain in live CRs and emitted snapshots. |
| After LOAD / before clear | Cell, CR1 and its protected Thread home retain the GT. `getState()` and `fault()` expose CR copies to the host observer. |
| After cell clear | Cell is zero, but CR1 and its Thread home still contain the result; the fault snapshot still contains private views and result authority bits. Cell cleanup alone is not containment. |
| Every injected fault | `fault()` halts immediately and records/emits evidence, without rollback or automatic clearing. Subsequent `step()` changes neither PC, RAM nor CRs. No ordinary post-fault attacker execution was demonstrated. |
| `_returnToBoot` | Live CR/DR banks clear, but the result cell, CR1 home, alias descriptor and fault record survive. Reinstalling a test-privileged scope in a new synthetic context reloads the old GT. This is a stale-reuse counterexample, not actual boot execution or an allowed interrupted-call continuation. |
| Full `reset(reason)` | Replaces live memory, clears registers and faultLog; sampled result/home words become zero. Previously emitted snapshot objects remain readable. The retained control-flow RESET event includes the old CR6 private-view descriptor. Full reset is not proof of diagnostic erasure. |
| Explicit cell plus temporary-CR cleanup | Live tested copies clear; an already obtained `getState()` copy remains. The helper cleanup is test privilege, not a trusted reinitialization implementation. |

`fault()` snapshots all CRs/DRs, emits the record, and keeps it in `faultLog`.
`getState()` returns CR/DR copies. `_recordControlFlowDiagnostic` records selected
descriptors before reset and retains bounded history. `_fastBoot` also constructs
a last-fault snapshot and can send it through the host snapshot path; that
transport was **source-inspected only, not invoked**.

These observations demonstrate availability to simulator host observers, not an
unauthenticated web endpoint or ordinary LUMP reading arbitrary host objects.
Who may receive/export/persist those observations is **not qualified here**.
Copying rather than retaining a mutable reference protects integrity, not
confidentiality. Deferred cleanup cannot repair an earlier disclosure.

## Publication-bound permit: requirements only, still unapproved

The proposed permit is needed to distinguish **where a write may land** from
**which value may be written, when, and for whom**. It is not implemented,
simulated with a fake success flag, or inferred from an existing RW grant.

Before approval/implementation, the design must settle and subsequently prove:

1. Machine-owned binding to exact admitted Mint identity, Thread/invocation,
   Namespace/configuration, target incarnation, confirmed four-word publication,
   result-cell address and exact authorized GT including permission/B ceilings.
2. Arm only after confirmed storage publication while G4 exclusion still holds.
   A software boolean, readback alone or result address is not that authority.
3. Atomic check-and-consume on the accepted write, enforced for **every alias
   and applicable producer**, not just a Mint helper. Reject early, duplicate,
   wrong-word, wrong-value, stale and cross-invocation writes before mutation.
4. Canonical zero initialization/cleanup only through approved protected
   authority; no ordinary zero-write exemption that becomes a second grant.
5. Fault/reset/FINISH/lost publication interval destroys outstanding permission.
   This must not roll back or finish an interrupted update. Old results must not
   become eligible on reentry, slot/address reuse or configuration restore.
6. Ordinary LOAD, type/domain/bounds, descriptor and B checks still apply.
   A write permit neither solves the non-CR6 header-read gap nor prevents
   repeated LOAD, stale CR1/home exposure, read aliases or diagnostic leakage.

Use the [shared producer/observer inventory](namespace-update.md#producerobserver-inventory)
for G4 and alias enforcement. This is a design requirement, **not permission**
to add a special RW mode, widened Thread authority, DR-to-CR conversion,
new GT bit, extra privileged opcode or service bypass.

## Remaining unknowns and disposition

- Lawful private L/RW provisioning, exact private placement/capacity and an
  executable caller→Mint→Lambda→LOAD→RETURN path remain unproven. No approved
  entry was overwritten or arbitrary Alice/Mallory credential issued.
- No complete proof covers all incoming/outgoing/suspended Threads, CR homes,
  private-view propagation, executable aliases, loaders, browser diagnostics,
  saved snapshots, image restore or asynchronous observers. The source inventory
  is not an exclusion proof.
- The target-generation-at-LOAD gap needs its own contract decision/regression;
  rejection on later use does not satisfy “invalid result faults at LOAD.”
- Trusted pre-admission clearing and reinitialization/reuse rules do not yet
  exist as an M3 implementation. Full reset's sampled zeroing is not equivalent
  to return-to-boot, nor a guarantee about restored images or previously exported
  observations.
- No instruction-internal interrupted write, RTL, generated build, physical
  memory arbitration, debug/readout or FPGA behavior was tested.

**Disposition:** retain G1/M3, G4 and applicable disclosure gates as OPEN.
Investigation complete; M3 containment, legal delivery and full Mint acceptance
are not established. Only tests and review documentation were added. Saved
Namespace, LUMP and image bytes, runtime simulator implementation, GT format,
B ceilings and existing authorization are unchanged. No hardware or live
service actions were taken.
