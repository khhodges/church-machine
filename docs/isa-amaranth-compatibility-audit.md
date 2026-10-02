# Amaranth ISA compatibility audit

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

There is an unresolved consistency problem:

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
| 8 | ELOADCALL | **Cutover gap:** live hardware decoder accepts it and core has an execution path. Legacy assembler and simulator paths also remain. |
| 9 | XLOADLAMBDA | **Cutover gap:** live hardware decoder accepts it and core has an execution path. Legacy assembler and simulator paths also remain. |
| 10 | IDX1 introducer | **Gap:** live hardware decoder rejects it with fault code 11. No hardware IDX1 packet/profile implementation was found. |
| 16 | DREAD | Legacy unit/dispatch present. Full result, permissions, MMIO and containment parity unverified. IDX1 runtime DR±immediate packet mode absent. |
| 17 | DWRITE | Legacy unit/dispatch present. Full write/permission/alias containment parity unverified. IDX1 packet mode absent. |
| 18 | BFEXT | Core dispatch exists. Complete range, masking, flag and fault parity unverified. IDX1 packet mode absent. |
| 19 | BFINS | Core dispatch exists. Complete source masking, range, flag and fault parity unverified. IDX1 packet mode absent. |
| 20 | MCMP | Core dispatch exists. Full signed/unsigned edge-case and flag parity unverified. |
| 21 | IADD | Core dispatch exists; scheduler tests use arithmetic incidentally. Full carry/overflow and operand-edge parity unverified. |
| 22 | ISUB | Core dispatch exists. Full borrow/overflow and operand-edge parity unverified. |
| 23 | BRANCH | Condition truth table and resumed-Thread condition tests passed in the earlier scheduler suite. All signed displacement/bounds cases unverified; IDX1 packet mode absent. |
| 24 | SHL | Core dispatch exists. **Verification blocked:** the shift suite fails during boot before reaching shift assertions. |
| 25 | SHR | Core dispatch exists. **Verification blocked:** same boot prerequisite; cannot certify LSR/ASR and carry behavior from that suite. |

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
| Mode-2 abstract/outform behavior | Three unit tests pass; core integration fails before boot completes, so ingress behavior is not certified end-to-end. |
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

New completed runs:

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
3. Repair the boot prerequisites in instruction/integration tests, preserving
   their substantive assertions.
4. Implement the missing approved semantics with identical-byte differential
   tests, including permission failures, arithmetic overflow, out-of-range
   indices, illegal packet boundaries and no-side-effect rejection.
5. Bind the exact published three-thread image and source snapshot; compare
   architectural state/retirement across software and hardware models.
6. Only then regenerate RTL for that snapshot, synthesize, verify timing and
   provenance, and separately approve flashing.

**Release status: HOLD.** This checklist locates confirmed blockers and missing
evidence; it does not certify the unverified rows merely because legacy code exists.