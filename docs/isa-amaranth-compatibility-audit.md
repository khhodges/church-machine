# Amaranth ISA compatibility audit

**Scope correction (2026-10-02):** the user clarified that indexed instructions
must themselves add the data-register value to the immediate. See
[ISA reference §1.1](isa_reference.md#11-uniform-indexed-operands--required-semantics).
The prior multiword IDX1 design is not established as the intended encoding.
IDX1 gaps recorded below describe implementation differences; they are not
authority to implement its packet format in Amaranth. Reconcile the encoding
first, then verify assembler/simulator/hardware behavior against that decision.

## Verdict

**Do not certify the current hardware as implementing all approved ISA changes.**

The generated RTL is current with the Python hardware sources, but source
freshness is not ISA equivalence. This is a source-and-targeted-test audit,
not a complete simulator-versus-RTL differential proof.

No ISA definition, hardware logic, saved program, Namespace, or boot image was
changed during this audit. No synthesis or flashing was performed.

## Authority and scope

The baseline reference is `docs/isa_reference.md`, with encoding details in
`docs/isa_encoding.md`. The newer indexed profile is defined separately in
`docs/isa-indexed-profile.md` and `docs/isa-indexed-encoding.md`.

The initial audit found this consistency problem (opcode retirement is now
enforced as described in the follow-up below):

* The recorded approved cutover retires ELOADCALL/XLOADLAMBDA without automatic
  translation and requires rejection of their old encodings on the new ISA.
* The main reference still describes those instructions as active opcodes.
* The assembler, simulator, and hardware retain legacy implementations.
* IDX1 explicitly retires those opcodes while preserving separately admitted
  legacy interpretation. IDX1 documentation does not itself authorize a
  hardware release or reinterpretation of existing binaries.

Therefore, legacy compatibility must not be mistaken for completion of the
approved new-ISA cutover. This report does not invent a new compatibility policy
or change the ISA to make the implementations agree.

## Evidence labels

* **Targeted pass:** listed tests passed; this is not a proof of every behavior.
* **Present, unverified:** dispatch/implementation exists, but semantic parity
  was not established with an independent executable comparison.
* **Gap:** an approved/new-profile capability is absent from this hardware.
* **Blocked verification:** a test fails before exercising its intended behavior.

## Instruction-by-instruction checklist

| Opcode | Instruction | Hardware evidence and audit result |
|---|---|---|
| 0 | LOAD | Legacy unit/dispatch present. Complete permission, bounds, lazy resolution and result parity unverified. IDX1 DR±immediate packet mode absent. |
| 1 | SAVE | Targeted SAVE M-authority and immutable SELF tests pass. Full legacy semantic parity remains unverified. IDX1 SAVE is not currently enabled in software either. |
| 2 | CALL | Indexed CR6 CALL tests pass. Decoder carries legacy method-index and CR6-row handling. IDX1 typed dispatch/admitted-object semantics absent; extended forms require explicit coverage rather than inference from legacy tests. |
| 3 | RETURN | Stack-contract and mask tests pass. IDX1 caller-profile restoration is software-only; complete cross-engine frame/authority equivalence unverified. |
| 4 | CHANGE | Earlier full-core Thread scheduler tests pass, including condition flags across switching. IDX1 CHANGE is not currently enabled in software. Full saved-image equivalence unverified. |
| 5 | SWITCH | Legacy unit/dispatch present; independent semantic parity not established. IDX1 SWITCH is not currently enabled in software. |
| 6 | TPERM | Targeted TPERM and permission-check tests pass. This does not certify all interactions with every caller and fault path. |
| 7 | LAMBDA | Hardware target-capability/X-permission path present. No independently demonstrated coverage of every approved extended form or caller-scope/frame invariant. IDX1 LAMBDA is unavailable in current software. |
| 8 | ELOADCALL | **Targeted retirement pass:** explicit assembly and four formerly generating capability-call paths report errors; simulator and hardware reject before execution, including false conditions. Public compiler regressions cover the repaired paths. Historical decoding remains available. |
| 9 | XLOADLAMBDA | **Targeted retirement pass:** explicit assembly errors; simulator/hardware reject before execution. No generated opcode-9 emitter found in CLOOMCCompiler; exhaustive frontend coverage is not claimed. Historical decoding remains available. |
| 10 | IDX1 introducer | **Gap:** live hardware decoder rejects it with fault code 11. No hardware IDX1 packet/profile implementation was found. |
| 16 | DREAD | Legacy unit/dispatch present. Full result, permissions, MMIO and containment parity unverified. IDX1 runtime DR±immediate packet mode absent. |
| 17 | DWRITE | Legacy unit/dispatch present. Full write/permission/alias containment parity unverified. IDX1 packet mode absent. |
| 18 | BFEXT | Core dispatch exists. Complete range, masking, flag and fault parity unverified. IDX1 packet mode absent. |
| 19 | BFINS | Core dispatch exists. Complete source masking, range, flag and fault parity unverified. IDX1 packet mode absent. |
| 20 | MCMP | Core dispatch exists. Full signed/unsigned edge-case and flag parity unverified. |
| 21 | IADD | Core dispatch exists; scheduler tests use arithmetic incidentally. Full carry/overflow and operand-edge parity unverified. |
| 22 | ISUB | Core dispatch exists. Full borrow/overflow and operand-edge parity unverified. |
| 23 | BRANCH | Condition truth table and resumed-Thread condition tests passed in the earlier scheduler suite. All signed displacement/bounds cases unverified; IDX1 packet mode absent. |
| 24 | SHL | **Targeted pass:** corrected ISA setup encodings; direct result and NZCV checks pass for zero, one, large shifts and alternating patterns. See shift diagnosis below; not exhaustive equivalence. |
| 25 | SHR | **Targeted pass:** LSR/ASR results and NZCV pass for positive/negative inputs and zero/one/large shifts. Acceptance, single retirement and stable writeback checked. |

Other reserved/data encodings were not exhaustively swept in this audit.
Acceptance of a decoded opcode alone does not prove correct execution.

## IDX1: implemented software versus remaining target requirements

The current profile documents software packet support for LOAD, DREAD, DWRITE,
BRANCH, BFEXT and BFINS, using any DR0–DR15 plus/minus a 20-bit magnitude.
It also documents admitted-object identity, executable boundaries, protected
metadata, and typed CALL/RETURN profile transitions.

Those hardware obligations are larger than adding opcode 10 to the decoder:

1. Fetch and validate complete two-/three-word packets atomically.
2. Enforce legal operand combinations and continuation boundaries.
3. Preserve exact arithmetic overflow/underflow and containment behavior.
4. Bind profile selection to admitted object identity; never infer it from bytes.
5. Preserve profile/authority through CALL, RETURN and context changes.
6. Reject unsupported deployment profiles without stripping their metadata.

**Important qualification:** the profile explicitly allows targets that do not
support IDX1, provided admission/deployment rejects it safely. Missing IDX1
therefore establishes a capability gap, not by itself a demonstrated unsafe
deployment bypass. The actual hardware deployment handshake was not certified
by this audit.

Indexed CALL, SAVE, SWITCH, CHANGE and LAMBDA are not all implemented in the
software profile. They must not be described as completed simulator features
that only need copying into hardware. General uniform indexing is an approved
target direction; each operation still needs its specified implementation and
evidence.

## Cross-cutting checks

| Area | Evidence / remaining work |
|---|---|
| Namespace widths, integrity and Thread offsets | Freshness/readiness checks passed previously; additional namespace-header tests pass. Not proof that the published image matches the hardware projection. |
| CALL/RETURN protected frame and authority | Focused frame, indexed CALL, mask and SAVE tests pass. No complete three-thread image differential trace collected. |
| Thread flags and switching | Earlier 51-test scheduler suite passes, including NZCV truth table and resumed branches. |
| Seals and permissions | 27 additional tests across M-window seal handling, permission checks and Namespace headers pass. |
| Mode-2 abstract/outform behavior | All four focused tests pass after the fault-aware boot handshake correction, including core integration. Not exhaustive ingress certification. |
| Boot and IRQ integration | Broader run including boot/IRQ did not finish within five minutes. No pass or precise timeout attribution claimed. |
| M-bit I/O and MMIO | Definitions are present; this audit did not establish full simulator/hardware equivalence for side effects. |
| Saved tested image | Not downloaded, rebuilt, changed or run against RTL in this audit. User-reported published simulation success remains distinct evidence. |

## Reproducible test evidence

Earlier checks retained as evidence (not rerun unnecessarily):

* 93 passes: `tests/hardware/test_indexed_call_cr6.py`,
  `test_return_stack_contract.py`, `test_return_mask.py`,
  `test_save_m_authority.py`, `test_msave_immutable_self.py`,
  and `hardware/test_tperm.py`.
* 51 passes: `hardware/test_wukong_thread_scheduler_contract.py`.
* 18 passes: hardware readiness and readiness-launcher tests.

Initial completed runs (superseded for shifts and Mode-2 by the follow-ups below):

* 27 passes: `hardware/test_mwin_seal.py`, `test_perm_check.py`,
  `test_namespace_header_v2.py`.
* `hardware/test_outform_mode2.py`: 3 pass, 1 fails. The integration test
  reports boot incomplete and fault 6 instead of expected OUTFORM_UNAUTH 26.
* `hardware/test_shift_ops.py -x`: first test fails with “Boot did not complete.”
  This is not evidence that the SHR arithmetic assertion itself failed.

A wider run showed additional failures but timed out before a final summary.
It is not counted as a completed suite. The subsequent focused failures above
are the attributable results. Root causes of those boot prerequisites were not
diagnosed or changed in this audit.

The direct Amaranth decoder probe asserted `instr_valid`, selected AL, and tried
opcode values 0 through 10: 0–9 produced no decoder fault; 10 produced fault 11.
Core dispatch inspection confirmed the active opcode-8/9 execution paths.

## Recommended release gates

1. Reconcile the approved retired-opcode cutover with legacy/profile admission
   and the stale active instruction reference. Do not silently translate code.
2. Decide and record the candidate's supported execution profiles. A legacy-only
   candidate cannot be called full new-ISA hardware.
3. Apply fault-aware boot prerequisites to any remaining instruction/integration
   tests that still assume fixed delays. Shift and Mode-2 suites are corrected,
   preserving their substantive assertions.
4. Implement the missing approved semantics with identical-byte differential
   tests, including permission failures, arithmetic overflow, out-of-range
   indices, illegal packet boundaries and no-side-effect rejection.
5. Bind the exact published three-thread image and source snapshot; compare
   architectural state/retirement across software and hardware models.
6. Only then regenerate RTL for that snapshot, synthesize, verify timing and
   provenance, and separately approve flashing.

**Release status: HOLD.** This checklist locates confirmed blockers and missing
evidence; it does not certify the unverified rows merely because legacy code exists.

## Follow-up: first boot-prerequisite failure diagnosed

The shift helper and Mode-2 integration test assumed boot completed in six
clocks. An isolated core trace instead shows fault-free completion at clock
nine: INIT_CLIST waits for Namespace.Init's private M-bit DWRITE handshake.
The tests now wait for completion with a bounded timeout and fault checks,
rather than injecting instructions before initialization finishes.

After this test-only correction, all four Mode-2 tests pass. Both core profiles
complete the boot-helper test with exactly CR12's M bit set. The 14 shift tests
then reached their instruction/result assertions but failed. The subsequent
diagnosis below supersedes that failure status. The ISA release verdict remains HOLD.


## Follow-up: shift setup encoding and retirement verified

The remaining shift failures were test encoding errors, not demonstrated shift
hardware mismatches. `docs/isa_reference.md` IADD/ISUB specifies bit 14 as the
immediate selector and bits 13:0 as an **unsigned** payload (0–16383).
Negative values must be constructed by subtraction, not signed imm15.
SHL/SHR use bits 4:0 for the amount and SHR bit 5 for ASR.

First LSR case, isolated Amaranth trace:

| Stage | Old test | Corrected test |
|---|---|---|
| Boot | Completes at clock 9, no fault | Same bounded fault-aware handshake |
| Setup decode | `0xAF080003`: IADD DR1, DR0, **DR3** (initially zero) | `0xAF084003`: IADD DR1, DR0, **#3** |
| Setup acceptance/retirement | `retire_valid=1`, issuer NIA=0; next edge NIA=4 | Same single-edge acceptance and NIA advance |
| Setup writeback | DR1=0; NZCV=(0,1,0,0) | DR1=3; NZCV=(0,0,0,0) |
| SHR decode | `0xCF108001`: SHR DR2, DR1, #1, LSR | Identical word |
| SHR acceptance/retirement | Issuer NIA=4; next edge NIA=8 | Same |
| SHR writeback | DR2=0; NZCV=(0,1,0,0), correct for actual source zero | DR2=1; NZCV=(0,0,1,0), correct for source three |
| Stall/idle | No second retirement or state change | Same, now asserted for every setup/shift |

The old `0x7FFF` arithmetic payload also meant **+16383**, not −1.
The tests now encode positive IADD immediates with `0x4000 | k` and explicitly
use ISUB #1/#2 for negative setup and subtraction-based result probes. No
timing change was needed beyond the earlier boot fix: the existing two-tick
execution helper correctly covers the writeback edge and one-cycle stall.

Regression evidence:

* All original 14 shift cases retain their result and flag assertions.
* Each instruction additionally checks fault-free acceptance, issuer word/NIA,
  one NIA advance, direct destination value, and stable DR/flags after the
  stall. Each shift checks all NZCV bits against an independent Python oracle.
* Literal encoding tests pin the immediate selector, bounds, reference example,
  ISUB negative construction, and SHR mode bit; invalid immediates are rejected.
* A dedicated regression executes the old words with DR3=9 to demonstrate the
  register-form distinction, verifies +16383, then verifies source 3 → LSR
  result 1, the zero-result probe, and actual −1/−2 construction.

Verified command:

```sh
python3 -m pytest hardware/test_shift_ops.py hardware/test_outform_mode2.py hardware/test_sim_boot_helpers.py -q
```

**25 passed**: 16 shift/encoding/retirement tests (14 original plus two
regressions), four Mode-2 tests, five boot-helper cases.
Only tests and this audit changed. No core arithmetic, ISA definitions, saved
LUMPs, Namespace, boot images, synthesis, or flashing changed.
The broader release verdict remains **HOLD** for the unrelated gaps above.
## Follow-up: approved opcode retirement enforced

With explicit approval of the compatibility consequence for saved post-flash
tests, explicit opcode-8/9 mnemonics now reject in assembly diagnostics, simulator
execution (including direct helper entry points), and both hardware decoder
profiles. Core start signals for the legacy fused units are tied inactive.
Disassembly is retained and no saved artifacts were rewritten or translated.

New evidence:

* `node simulator/test_retired_opcodes.js`: public assembler errors, suffixed
  mnemonics, direct execution helper rejection, and actual step-path rejection
  with unchanged CR/DR/PC/STO, including false-condition words.
* `hardware/test_retired_opcodes.py`: all 16 condition encodings reject in both
  decoder profiles; full-core checks confirm rejection and no DMEM, Namespace
  or c-list writes or M-bit changes following rejection.
* Combined retired-opcode, indexed-CALL and shift tests: 26 pass.
* Existing simulator CALL-through-CR6 suite: 17 pass.
* Regenerated core/IoT/Wukong RTL and the separate core copy pass freshness;
  13 hardware readiness tests pass.

The reference and indexed-profile notes now clarify the hard retirement.
Historical positive tests for fused execution are not authority to restore it.
The whole repository suite has not been certified by this focused verification.
**Release remains on hold for IDX1 and the other unverified audit items.**

## Completion blocker isolation

The findings in this section describe the state before the separately authorized
repairs recorded below.

Comparing against the main project confirms that the deployment configuration,
assembler, high-level compiler, simulator, CapabilityTest source, bootstrap
migration tests and publish-configuration tests are unchanged by the shift work.
The following failures must not be attributed to shift arithmetic:

* **Publish configuration:** the October 2, 2026, 17:31 UTC publishing commit
  changed `.replit` from `deploymentTarget = "vm"` to `"cloudrun"`. The guard
  added August 24 still requires `"vm"`. This is a repository configuration
  mismatch, not evidence of current production availability or lost state.
* **Bootstrap test prerequisites:** two tests in
  `tests/server/test_bootstrap_migration_atomic_3321.py` invoke
  `scripts/build_capability_test_lump.js` against disposable directories.
  Assembly fails on `simulator/examples/capability_test.cloomc` line 98,
  `ELOADCALL CR0, WukongCallHome.hw, 0`, under the incoming retirement guard.
  The log also reports an out-of-range branch after that assembly failure.
  These tests never reach their intended archive/collision assertions.
* **Generated compiler gap:** `simulator/test_retired_opcodes.js` invokes
  `ChurchAssembler.assemble`, not the high-level `CLOOMCCompiler.compile`
  generation paths. With conventions `{Foo: {Run: {index: 0}}}`, a multiline
  abstraction declaring `Foo L` and a method calling `Foo.Run(); return(0);`
  compiles without errors and emits opcode 8 first. Runtime rejects it.
  Explicit-mnemonic rejection therefore does not establish end-to-end compiler
  retirement. Generated instruction paths need their own diagnostics and
  public-compiler regressions before that claim is justified.

Resolving these issues requires separate scope: reconciling the intended publish
target, correcting the programmer-owned CapabilityTest source explicitly, and
closing the generated-compiler retirement gap. Do not restore retired execution,
weaken the guards, translate saved artifacts, or modify live Namespace/boot
images merely to clear the shift task's completion checks.

## Authorized completion-blocker repairs

The user subsequently authorized compiler/source repairs and restoring the VM
repository configuration, without publishing or changing saved/runtime artifacts.

* `.replit` again specifies `vm`; the existing publish guard passes. No deploy
  was performed, and no claim is made about the current production target.
* The three statement-call generation paths and the symbolic call-expression
  path now issue actionable errors instead of emitting retired ELOADCALL.
  This is rejection, not automatic translation. Public `compile` regressions
  cover bare calls, CALL-prefixed calls, wrapped calls and symbolic expressions,
  plus a supported explicit CALL control case.
* CapabilityTest's source was explicitly corrected to
  `CALL CR6[WukongCallHome.hw], #0`. Its offline builder relocates opcode-2
  CR6 c-list selectors when inserting compiler-owned SELF. A temporary rebuild
  regression verifies method zero, row seven, and absence of retired opcodes.
* The shared test runner now includes `retired-opcode-tests`, explicitly declared
  script-only in its sync configuration. Served-script cache keys were refreshed.

The combined bootstrap identity/migration, primary publish configuration, shift,
Mode-2 and boot-helper run passed **75 tests**. This supersedes the earlier
bootstrap and publish failures; broader ISA release certification remains HOLD.
No saved LUMPs, live Namespace, boot images, generated RTL, or physical hardware
were changed by these repairs.
