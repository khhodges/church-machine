# Complete CREATE: exact compiled-source ChurchCore acceptance

```sh
python -m pytest tests/hardware/test_mint_create_core.py \
  tests/hardware/test_cr6_load_permission.py \
  tests/hardware/test_mint_slot_core.py tests/hardware/test_return_mask.py -q
node simulator/test_mint_data_native_path.js
```

The full-core suite has no skips or expected failures. It compiles the complete
current `mint.cloomc` and `pkverify.cloomc` through the shared compiler and
canonical `lump_builder.buildLump`. It copies every method/table word unchanged.
Only fixture headers/C-lists and a disposable caller are constructed separately.
The caller enters directly; it is not an additional Mint method.

## Execution and assertions

A real bootstrap CHANGE establishes the synthetic Thread; actual CALLs enter
the caller, Mint CREATE and PkVerify. One synchronous physical-byte RAM serves
all data accesses. Namespace slot N occupies byte addresses `16*N..16*N+12`.
No instruction is rewritten or host-selected continuation used; no memory
write is mirrored into another geometry.

Success cases cover fresh version zero, reused zero → one and 509 → 510:

- Actual PkVerify CALL/RETURN, then native allocation and reservation.
- Whole allocation zero before return, exact W0–W3 publication/read-back.
- LOAD-issued CR1 through the private scratch row; row erased afterward.
- Final result checks and outward RETURN, output cleanup and two RETURNS.
- Caller writes/reads every allocated word through returned CR1, whose
  descriptor names those same physical bytes.
- Exactly one cursor/queue debit, correct retained reserved history.
- Every unrelated memory word remains unchanged.

Failure cases cover each occupied descriptor word, independently corrupted
W0–W3 storage, retirement at 510/511 (including stale fresh indication at
511), and all three unsupported methods. No failure returns to the caller.
Post-reservation faults retain the reservation; no rollback is attempted.

## Required corrections

The user approved removing the all-ones credential escape and requiring normal
credential/proof checks. Mint now declares `ide.MintScratch L`: an explicit
one-word L view of the final MintState word, separate from its whole-object RW
view. The fixture binds this descriptor at slot 46. This is private synthetic
provisioning, not deployment approval or a public raw-memory grant.

Constant data offsets in CREATE use the existing four-operand form with DR0.
The old three-operand emitter's encoding disagrees with RTL; neither the test
nor the RAM model translates that encoding.

Two ordinary RTL integration defects were exposed beyond the entry:

- RETURN rebuilt CR6 with its E identity and CR6.M, but LOAD ignored CR6.M.
  mLoad now latches a narrowly scoped CR6 L permission. It does **not** gain
  boot/M elevation: bounds, Namespace version/integrity, and type checks remain.
  Negative tests cover wrong source, absent M, bounds and corrupt seal.
- Generic TPERM prechecks read the encoded reference CR0 instead of the target.
  Idle prechecks now select the target; EXACT still reads its reference in the
  TPERM unit. This permits RW checks after a RETURN legitimately clears CR0.

## Prepared-candidate boundary

The older private candidate was independently replayed, unchanged, with:

```sh
python -m tests.hardware.replay_prepared_mint PATH_TO_TRIAL_DIRECTORY
```

That diagnostic is not an acceptance runner and always exits nonzero. Its
hash check is only local evidence consistency, not the separate stale/altered
trial-file admission guard. It adds only a disposable caller/descriptor and
reserved Thread setup to RAM; it preserves Mint executable bytes.

The historical candidate with SHA-256
`3865d202eea948926e97bb16ce6fba32e1550333b84abfc66b06cedf97c879eb`
fails during CALL at 0x7018: its table word `0xb8000004` has condition EQ,
where ChurchCall requires AL. Zero Mint instructions retire. The canonical
builder used by the successful suite emits supported bare method offsets.
The historical candidate is **not** promoted by the new source acceptance;
regenerating its executable pins and private bindings is separate work.

## Limits and broader checks

No catalog, live Namespace, approval, installation, published service, synthesis,
bitstream or board was modified. This is first-base single-threaded RTL
simulation, not credential authentication, legal service provisioning, timing
closure or physical FPGA acceptance.

The final diff against main contains no `server/lumps` changes. Existing Mint
catalog/approval records belong to upstream history and do not certify the
corrected editable source or the synthetic private binding used here.

The broader `test_phase1_authority.py` / `test_phase1_operands.py` run had ten
failures in Thread admission, SAVE and runtime CALL fixtures. The same ten
failures were reproduced on the unchanged upstream checkout; they are not
counted as passing or repaired by this task.
