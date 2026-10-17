# Verification and evidence matrix

[Sources/revision](sources.md) · [Invariants](security.md) · [Release gates](open-issues.md)

## Evidence status at this review

**Subsequent G4 evidence:** [exclusion investigation](exclusion-evidence.md)
records 18 isolated simulator cases reproducing marker/ABA/activation gaps.
It is not service acceptance or V15–V17 closure. Its nine current source
fingerprints pass; the original review checker now stops on historical source
drift, as detailed in that report. Original results below remain historical.

| Layer | Status / what was actually established |
|---|---|
| Current source inspection | INSPECTED at `931b399166a78ce7c52725da78fa9714481ea456`, per-file hashes recorded; findings are not runtime outcomes |
| Documentation/provenance/arithmetic checks | CHECKED-DOC; commands/results below |
| Draft/compiler syntax | NOT RUN here; historical draft README reports deliberate compile blockers, not service success |
| New service JS simulator tests | NOT IMPLEMENTED / NOT RUN |
| Isolated M3 result component probes | 20 checks PASS; [scope, concrete weaknesses and reproduction](result-containment.md). Synthetic alias/CR6 setup is test privilege, not service acceptance |
| New service RTL simulation | NOT IMPLEMENTED / NOT RUN |
| Generated/synthesized RTL | NOT RUN; no vendor build, root generated file not treated as current evidence |
| Exact release build | NOT RUN; no artifact selected/adopted |
| Physical FPGA acceptance | NOT RUN; no control endpoint, serial, button, upload or flash used |
| Formal proof / independent worldwide audit | NOT PROVIDED / NOT COMPLETED |

Historical Lambda/RETURN/Mint tests listed at S12 are useful narrow candidates.
Their names or historical PASS reports do not fill any new service row below.

## Decision → invariant → source → evidence → remaining gate

Every S reference inherits the revision/hash in sources.md. V IDs below identify
fully specified future fixtures, **not existing passing tests**.

| Decisions / retained requirements | Requirement / invariant | Source symbols | Required evidence | Current status / gate |
|---|---|---|---|---|
| Q01–Q06 | Owner mapping/encoding/classification; I4/I11 | S01 GT_LAYOUT; S08 ChurchMLoad; S05 old Mint | V01/V02/V08 | Policy approved, compatibility unproven; G7 |
| Q07–Q11 | Per-operation/type/target/Namespace, private record; I4 | S05 drafts; S10 register_models | V03/V04/V06 | No new verifier; G2/G5/G7 |
| Q12–Q13 | No in-place grant edits, new GT/proof; I6 | S10 IntentStore pattern only | V19/V21/V22 | NOT RUN; G5 |
| Q14 | Fixed-work 128-bit equality; I4/I8 | S05 verifier draft | V02/V05 | Draft example is not conformance; G1 |
| Q15–Q18.3 | Trusted pool, no discard/burn/replay; I6 | S10 persistence patterns | V19–V22 | NOT RUN; G5/G6 |
| Q19–Q21 | IDE authority, local read-only mirror, both before success; I2/I6 | S09 bridge/main; S10 stores | V19–V23 | No protected mirror protocol; G5/G6 |
| Q22–Q31 | First Owner/recipient, four types, Boot, no targets; I11 | S11 phase1_seed; S01 geometry | V01/V03/V04 | Selected policy, not provisioned; G2/G7 |
| Q32 | 25-bit non-reused issued ID; I6 | S10 no corresponding store | V01/V20/V21 | NOT RUN; G5 |
| Q33–Q35 | No sharing, Genesis-only admin; I2/I11 | S08 load/gates; S09 existing admin boundary | V08/V09/V22 | Enforcement/provisioning pending; G6/G7 |
| Q36–Q37 | Canonical roles/slots; Lambda-only NSRW; I5 | S11 old labels; S02 ChurchLambda | V07/V14/V24 | Names selected, binding unproven; G1 |
| Q38–Q39 | Exact frozen authorization/proof snapshot; I3/I4 | S04 typed parameter parse; S05 draft | V02/V05–V07 | NOT RUN; G1/G2/G4 |
| Q40–Q42 | B=0, protected setup, registry RW/R split; I8/I11 | S09 transport; S05 draft | V08/V09/V23/V24 | NOT RUN; G5/G6 |
| Q43–Q45 | Five methods, actual GT args, Mint placement; I3/I10 | S04 compiler/assembler; S06 legacy placement not reusable | V03/V06/V10/V18 | Proposed ABI; G1/G7 |
| Q46–Q48 | Same-slot +1, separate block, zero before free; I9/I12 | S01 version rules; S06 old writer | V10–V13 | New lifecycle absent; G4/G7 |
| Q49 | Active and live return dependencies; I12 | S03 protected frames vs diagnostic callStack | V14 | Authority/scanner gap; G3 |
| Q50–Q51 | One request/all five, actual readback/exclusion; I5/I10 | S06 busy/DWrite; S07 RAM/control | V15–V18 | Whole-update gap; G4 |
| Q52–Q53 | Original recipient, Mint-only verifier E; I1 | S03 caller E capture | V07/V08 | Service provenance absent; G2 |
| Q54 | Atomic complete record/consumption/counter; I6/I7 | S10 transaction/fsync examples | V19–V23 | NOT RUN; G5/G6 |
| Q55 | Public complete review, no live actions | Decision ledger/package | Documentation checks below | CHECKED-DOC only |
| Baseline generation vs credential ID | Never-used 0; retained 1–510; retired 511 | S01 Master; S06 legacy fixed version | V01/V11/V12 | G7 |
| Baseline hard fault/watchdog/reset | No rejection/retry/rollback; accepted writes only | S04 HARDFAULT gate; S06/S07 fault boundary | V15–V17/V24 | G4/G8 |
| Baseline sizes/type/residency | Four types, no MMIO/Namespace/GC/lazy changes; half-memory | S01 Master; S11 Resident seed | V03/V10/V14 | G7 measurements |
| Baseline T/virtualGT | Local T===GT; exact identity binding, no zero W3 | S01 Master; S08 ns_gate; S06 legacy | V10/V11/V13 | G7 |
| Baseline evidence/release separation | No software bitstream gate or implied FPGA PASS | S01 Master, S12 test scope | Layer table and release checklist | G8 |

## Synthetic fixture definition

Only private isolated fixtures; **no production, catalog, saved boot or security
store**. No real entropy/proofs or existing secrets are needed.

Use a fresh temp root per case and disable all network/serial access in the
harness. Replace filesystem/catalog/config dependencies with explicit temp roots;
fail if a test resolves a path outside its root. Do not import `server/app.py`
merely to reach a helper; import future pure components. Tests must reject
unknown configuration or missing fixtures, not fall back to live files.

Base fixture **F0**:

- Configuration ID `00000000 00000000 00000000 00000001`; Namespace identity
  `00000000 00000000 00000000 00000010` = **synthetic Boot role**, no real Boot.
  Wrong Namespace is same prefix ending `00000011`.
- Owner mapping 0→synthetic Mint hierarchy ID ending `00000100`; 1→synthetic
  Other hierarchy ending `00000101`. Protected context producer supplies these;
  ordinary request words never do.
- First-policy credential: `GT=0x06000000`, B=0, proof
  `00112233 44556677 8899aabb ccddeeff`, active record, Create four types in
  synthetic Boot, empty Replace/Destroy sets, recipient Mint only.
- Separate **SYNTHETIC POSITIVE GRANT**, GT `0x06000001`, proof
  `10213243 54657687 98a9bacb dcedfe0f`, allows Replace/Destroy only incarnation
  ID ending `00000200` at synthetic slot 20. It is not a changed first credential
  or permission to provision a real target.
- 256-slot ascending table; empty eligible slots 20/21 except when target fixture
  occupies 20. Explicit never-used history at 21. Slot 22 is released version 8;
  slot 23 is retired 511. Protected rows and objects remain marked Resident.
- 64-word blocks at byte addresses `0x4000`, `0x5000`; old block occupied, new
  block free. Pattern old block `0xa5a5a5a5` including its unused tail. Bounds
  and alignment are checked independently; no overlap with table/private areas.
- Deterministic type payload fixtures must contain complete approved framing:
  minimal valid application method table/code/c-list; Thread with protected
  root/stack/heap/homes; standalone LS C-list; RW data. **G7 must freeze exact
  bytes/header profiles before these positive payloads are runnable**. Do not
  call an arbitrary zero block a valid LUMP. Hash each fixture and publish its
  independent expected header, rights and bounds, not just compiler output.
- Instrumented events: input reads, validated context ID, actual NS bus
  accepted/completed writes, actual read responses, consumer admissions, CR
  materialization, return/fault occurrence, allocator state changes, durable
  commit, mirror receipt, protected delivery. Test observer hooks are evidence,
  not production authority.

Independent arithmetic example for synthetic E-object slot 20:

| State | W0 | W1 | W2 | W3 |
|---|---|---|---|---|
| Old v7 / 64 words | `00004000` | `00e0003f` | `de8a5ef3` | `4a070014` |
| New v8 / 64 words | `00005000` | `0100003f` | `de825ecf` | `4a080014` |

These descriptor-only vectors use W1=`(v<<21)|63`,
W2=`rol32(W0,7) XOR rol32(W1 & 0x3fffffff,13) XOR 0xdeadbeef`.
They are not complete executable LUMPs, allocator reservations or approval to
write those addresses. F/G toggling must leave W2 unchanged. Expected table
byte address is `base + 16*slot`; payload hashes are independent of this table
arithmetic. Don't calculate the expected answer with the implementation encoder.

## Adversarial cases and pass/fail oracles

Every “fault” below means non-returning hard fault, no published result/private
authority. Pre-target-change denials must show **zero target writes**, not merely
unchanged final bytes. Post-write cuts instead record effects without rollback.

| ID | Fixture and action | Independent required observations |
|---|---|---|
| **V01** encoding/lifetimes | Enumerate Owners 0..15, payload 0/max; reject -1/16 Owners, overflow payload/B. Forge last ID then next. Revoke/reset and attempt reuse; propose assigning one Owner to another hierarchy | First GT `06000000`, owner15/max/B1 `ffffffff`; type never NULL. Last valid ID once only, next hard-fault no consumption. Existing assignment/issued IDs unchanged across boot |
| **V02** credential negatives | F0 with GT word 0 and nonzero type-00 value `80000001`; wrong type, malformed Owner context, unissued GT, revoked record; equal malformed operands; missing trusted record; correct GT/wrong proof; 0/1/3 readable words | All hard-fault before NS writes. No missing-state zero defaults; equal bits never validate missing issuance |
| **V03** first Create scope | F0 each of four complete type fixtures; wrong Namespace/root, Namespace/MMIO type, forged rights profile or B escalation, occupied-only/full table | Correct four types only in exact Boot, chosen empty eligible slot and permitted rights in CR1; others zero target writes. No default current-root selection, relocation/residency edits or lazy fallback |
| **V04** empty targets | F0 first credential: Replace and Destroy for each type, empty/occupied/resident/nonresident targets, even exact supplied slot/generation | Every combination faults before target bytes/version change. Separate positive grant is used only for V11–V14 |
| **V05** proof work/presence | Correct record; flip each of 128 proof bits separately. Count comparison operations. Separate active record binds four all-zero proof words; compare complete zeros vs absent storage | Every mismatch runs all four word comparisons before equality failure. Complete matched zero control succeeds; absent proof faults. Earlier revoked/invalid checks need not run equality; no whole-verifier timing claim |
| **V06** input bounds/TOCTOU | CR3/4/8 wrong domain/permission/length; overflow lengths, zero/missing cap, reserved fields. Mutate each word between reads using alias, then mutate after freeze; swap payload after hash | Invalid/torn inputs fault or capture a proven single coherent permitted version. Post-freeze mutations cannot affect used request/payload. All-or-nothing snapshot claim must be evidenced, not assumed from repeat reads |
| **V07** requester/deputy | Other hierarchy supplies F0 pair, claims Mint name/Owner, sends fake context R buffer; nested call Mint→PkVerify; nested unauthorized verifier invocation | Actual Other faults despite name/pair. Legitimate Mint original survives nesting. Fabricated context and stale admission ID fault; no immediate-caller substitution or host-shadow trust |
| **V08** capability confinement | Missing/wrong Mint E, non-Mint attempts verifier E, ordinary SAVE B=0 into LS destination, forged integer GT in DR1; tamper only host callStack | Access/sharing faults before destination mutation. DR bits never become CR authority. callStack edits cannot authorize anything. No private NSRW/registry/pool in returned CRs |
| **V09** admin/setup | Runtime client invokes Forge/Revoke without scoped Genesis authority, duplicated/forged admin ID, wrong config, setup during execution, missing pool/registry | Hard-fault before protected mutation; no first-caller shortcut or empty-state initialization. Authorized isolated setup restores same pair with zero ID/pool delta |
| **V10** placement/no-space | Eligible slots but no free block; free blocks but no slots; misalignment/overlap/too-small class; replacement needing extra block; payload exceeds class/half-budget | Fault before target change, no in-place fallback. Success uses only eligible disjoint block/slot; counts include private metadata and replacement overlap; no guessed capacity |
| **V11** Replace | Synthetic positive grant, v7 fixture and separate new block; then v509 and v510 targets | v7→v8 same slot, exact four-vector words/readbacks; old GT invalid/new CR1 usable. v509→510 valid. Current510 faults with zero target writes and no live511. Reclamation causes no second increment |
| **V12** Destroy/reuse | Synthetic grant: Destroy v7, then Create using released slot; Destroy510; empty words with missing history; retired slot allocation | v7 invalidates to retained8 before free; reuse8 not9/0. 510 retires511 permanently, no reuse/reset/wrap. Missing history faults, never inferred never-used |
| **V13** zeroing | Replace/Destroy old block filled pattern including unused tail; interrupt/fail after every zero-store; attempt allocation at each cut | Block not free until every word actually zero and completion known. Failure leaves unallocatable; no GC retry. W3 on live local binding equals full GT, not zero/hash |
| **V14** live use | Mark target Resident, current Thread, executing code, active C-list, caller needed by nested return, suspended other Thread's deep return. Corrupt protected frame, then change a dependency after scan | All protected/missing-state cases fault before target memory/version change. Authorized unrelated nonresident target succeeds. New dependency cannot arise between final scan and publication. Outstanding ordinary GT alone is not denial |
| **V15** writer exclusion | At each pre-write/between-write/readback/release boundary inject upload/init/legacy writer/raw UART, M6 and selected-profile IRQ, cooperative switch, conflicting state request | Either producer was excluded by proven envelope or operation hard-faults without publication/partial consumption. Log actual arbitration, never just requested writes. Unreachable sources require exact-profile evidence |
| **V16** reader/readback | At all W0–W3/R0–R3 boundaries admit ns_gate/mLoad/CALL/RETURN consumers and actual snapshot addresses/aliases; corrupt each stored word individually | No mixed entry used. Four independent actual-storage reads, compare all words; mismatch faults with no result/retry. Prepared-word echo or cache cannot pass. Snapshot claim limited to reached addresses |
| **V17** write/reset fault cuts | Drop an unaccepted write; delay an accepted write; inject fault/reset/watchdog before acceptance, on acceptance, before completion, during each readback and after confirmation before RETURN | New writes stop; accepted writes only finish within proved bound. No unaccepted remainder issued, no success after interruption. Exceeding bound stops consumers; no recovery-memory writes based on uncertain completion. Reset cannot reopen partial NS |
| **V18** all-method overlaps/masks | All 25 ordered pairs of five methods overlap at admission, verification, commit, mirror and zeroing; dirty all scratch registers before calls | Second invocation faults before its mutations, no queue. Test public/verifier/Lambda masks and CR5/DR5/CR13 rules; no general CR restoration claim. No partial registry reader or stale DR1 success accepted |
| **V19** issuance commit cuts | Deterministic pool of two secrets; nextID=0. Kill isolated storage worker at every insert/update/commit/fsync boundary | Restart yields complete old tuple (0 credentials,0 used,next0) or complete new tuple (1,1,next1). Never (0,1,1) or credential without counter/association. No proof delivery before durable commit |
| **V20** mirror/return cuts | Stop after commit, mid-mirror, after mirror before delivery, after delivery before return; boot fresh execution | No success without exact mirror agreement. Complete committed credential restored, nextID/pool unchanged, original call never resumed or automatically reissued. Precommit candidate was not issued |
| **V21** duplicate/ID exhaustion | Same admin authorization delivered twice, lost success followed by retransmit, nextID max; crash with uncommitted candidate | At most one committed credential for auth ID. Duplicate faults, not retry. Issued IDs never reused; uncommitted candidate does not burn ID/entry. New pool exhaustion faults without replacing/discarding pool |
| **V22** revocation/permissions | Revoke F0 and reboot before board acknowledgement; restore earlier backup, modify grants in place, then separately authorized replacement | No stale local verification. Old credential stays revoked, object GTs unchanged. In-place edits rejected; replacement different GT/fresh pool proof. Old backup rejected, not accepted because signed |
| **V23** store/receipt integrity | Corrupt ciphertext/tag/counter/pool reference; valid old snapshot; duplicate/wrong challenge/board/session/revision/hash receipt | Execution/admission blocked on missing trustworthy state, no repair/defaults. Unauthenticated or mismatched receipt cannot confirm success; no silent automatic retry |
| **V24** secrets/fault maps | Use distinctive synthetic proofs/private capability sentinels; capture normal returns, hard faults at each scratch load, snapshots/debug/trace, crash files, logs, browser storage, public artifacts and wire; unrelated WORD `f7000000` site | No plaintext/private authority outside approved private/delivery boundary, including crash/WAL/backups. Expected secret exists only inside authorized recipient/private storage. Raw WORD not attributed without exact trusted map/site; reporting outage never prevents fault. Secret-free successful cleanup alone insufficient |

## Reproducible future harness contract (NOT IMPLEMENTED)

The following paths/CLI are **proposed outputs of W1–W8**, not commands that
currently run. Do not create placeholders that merely assert these tables.

```bash
# Each future runner must refuse network/serial and paths outside --root.
ROOT=$(mktemp -d)
node tests/mint-phase1/service-contract.js --root "$ROOT" --cases V01:V18,V24 --profile synthetic
python3 tests/mint-phase1/persistence-cuts.py --root "$ROOT" --cases V19:V24 --no-network
python3 tests/mint-phase1/rtl-contract.py --root "$ROOT" --cases V01:V18,V24 --profile wukong
```

Expected reports: case ID, fixture SHA-256, source revision and dirty hashes,
profile/clock/memory configuration, seed and injected cut, independently expected
vs actual events/words, fault-before-recovery location, result CRs, no secret
contents. Exit nonzero for mismatch, missing case or unobservable required event.
One passing layer never populates another layer's status. Temp roots are disposable
synthetic data only; no cleanup command may target repository data.

Generated RTL testing must run the same literal instruction/descriptor fixtures
against the generated module and compare observable bus events independently,
not only Python assertions about Amaranth signals. Exact-build records must bind
source/constraints/tool versions/profile and emitted artifact hashes, check
resource/timing and protected-port reachability. Physical acceptance requires
separate authorization and exact artifact identity, externally observed outcomes
and fault location, and a clear list of unobservable internal states. Do not call
unobservable exclusions PASS.

## Documentation checks executed for this package

From repository root:

```bash
python3 docs/reviews/mint-phase1/verify_review.py
python3 scripts/check_phase_1_documents.py
git diff --check
```

`verify_review.py` checks public local links/fragments/line ranges, all 57 Q
records and answer labels, preserved qualifications digest, source hashes and
independent descriptor arithmetic. It reads files only, imports no project
runtime and contacts no services. The Phase 1 checker reads the compact collection
only. Results are recorded after execution in [checks.md](checks.md).

## Software release checklist

Close G1–G8 with evidence, implement all five methods and four supported types,
preserve first-grant restrictions, prove persistence/mirror/secret boundaries
and whole-update containment, compile complete artifacts and measure resources.
Run the required simulator, RTL and exact-build physical acceptance under
separate authorization. Any Genesis override must identify exact missing/failed
cases, scope and authority; it never becomes PASS. Software/reload completion
does not delay the independent Phase 1 bitstream gate.
