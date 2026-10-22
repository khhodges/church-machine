# Isolated Mint private-binding candidate

This is a **fresh disposable saved design**, not a revision of the live Namespace,
the full Phase 1 baseline, or a bootable release. It supplies the five private
C-list grants declared by the current Mint source using existing GT encodings.
It does not authorize installation, simulator activation, publishing or flashing.

## Reproduce

```
python3 scripts/prepare_mint_fpga_trial.py
python3 -m pytest scripts/test_prepare_mint_fpga_trial.py -q
```

The generator creates a new `generated-artifacts/mint-fpga-trial-*` directory:

- `saved-design.json`: exact private layout, source hashes and explicit history origin.
- `candidate.bin`: 16,384 big-endian 32-bit words, with physical-byte descriptors.
- `native-code.json`: original sources, declarations and exact compiled method/table words.
- `evidence.json`: design/image hashes, checks and acceptance exclusions.
- Evidence also binds the complete native-code record (source, words and all
  declaration metadata) and the `mint-private-fpga-create-trial-v1` format.

Before downstream replay, verify the independently saved files:

```
python3 scripts/prepare_mint_fpga_trial.py --verify generated-artifacts/mint-fpga-trial-EXAMPLE
```

The command exits nonzero on missing, malformed, stale or inconsistent inputs.
Python replay consumers must call `verify_saved_candidate(directory)` and use its
returned `image` bytes (or `words`) directly, never reopen the files after checking.
It reloads all four files, reconstructs the exact pinned design, compares all
saved compiler fields with fresh compiler output, and recomputes the complete
evidence record. Hashes describe canonical JSON content, not whitespace or key
order; binary hashes cover the exact big-endian bytes. Identical content from two
generations is interchangeable; different content is not. Older evidence missing
the native-code hash must be regenerated, not silently accepted.

This gate checks integrity and current reviewed identity, not authenticity of a
signer or permission to replay on a board. It neither installs nor activates nor
programs hardware, and it does not implement the separate ascending-v1 endpoint
boundary. Current compiler/source changes require explicit review and regeneration;
the verifier never substitutes newly compiled bytes for saved bytes.

No catalog, manifest, approval store, saved live configuration or board is read
or written. Generated binary output is excluded from Git and deployment. The
tracked generator and tests are the reproducible deliverable. This deliberately
uses a distinct candidate format: it must not be passed to the legacy simulator,
Header V2 installers or the generic ascending-image approval endpoint. No signed
compiler attestation or canonical published-LUMP identity is claimed for this
instruction-image fixture. A subsequent execution trial must consume these exact
bytes rather than claim that a different linked artifact inherits this evidence.

## Physical layout

All addresses below are **bytes**; sizes and capability limits are **words**.
All provisioned sequences are zero and descriptor F/G bits are zero.

| Slot | Object | Base bytes | Size words | Mint C-list rows |
|---|---|---:|---:|---|
| 1 | privileged Namespace root | 0 | 1024 | none |
| 2 | reserved Thread homes | 24576 | 256 | none |
| 9 | ide.Mint | 4096 | 1024 | 0 SELF E |
| 15 | ide.PkVerify | 8192 | 64 | 4 E |
| 18 | ide.MintState | 12288 | 1024 | 1 RW, 2 L |
| 19 | ide.MintPool | 32768 | 2048 | 3 RW |
| 20 | ide.MintNamespace | 0 | 1024 | 5 RW |

The table occupies bytes `[0,4096)`, slot zero is its metadata, and CR15's
candidate base is zero. Namespace RW offset zero is exactly that same address.
`hardware/ns_gate.py` computes `CR15.word1_location + (slot_id << 4)`:
Mint's four word writes to offset `slot * 4` therefore address the same entry,
not a separate copy or a descending legacy table.

The Namespace RW descriptor and privileged root intentionally describe the
table itself; these are not extra public grants. No public C-list exists in this
closed candidate. PkVerify has only SELF E, Mint has precisely the six declared
rows, and the reserved Thread has no capability grants or prepared entry.
The Thread is reserved for later trial setup, not claimed to have a lawful CALL
frame or working boot context.

The pool is raw allocation storage, not a header-bearing public LUMP. Its cursor
is zero and exclusive end 2048; MintState word 5 is **32768**, not 8192.
Thus every initial allocation is outside metadata, executable and Thread space.

## Authoritative initial state

This candidate creates a new disposable universe. It does **not** use an empty
table as evidence about any existing slot's past:

- Queue words `[7,39)` explicitly enumerate slots 32–63 once each.
- History occupies MintState words `[64,320)`, indexed by slot.
- Each queued slot is explicitly declared never-used (`0x200`, current version 0).
- Every other slot, including unused holes, is unavailable (`0x400`, reserved).
- State word 1023 is the sole L-view scratch C-list row, initially NULL.
- Pool words `[0,2048)` start zero; no public object aliases any private extent.

History is authoritative **only for this new trial**. This image cannot be reused
as reset/reboot history after issuing anything. Retained history, lawful release,
recovery, migration and production provenance remain separately scoped.

## Evidence and limits

Initial generation produced:

```
image SHA-256   3865d202eea948926e97bb16ce6fba32e1550333b84abfc66b06cedf97c879eb
design SHA-256  a5ae0a027faf3e3ffc66616076584c3568fc443ddc306731bb2c74c20e0657fa
```

The validator first requires pinned source and compiled-code SHA-256 identities
for both Mint and PkVerify. Changing either requires an explicit reviewed pin
update; unchanged declarations alone never authorize new executable bytes.
It reconstructs the closed design from those exact inputs, checks exact
declarations and native words, then checks queue uniqueness, explicit history,
slot bounds, pool byte arithmetic, table identity and disjoint physical extents.
Any additional public alias, C-list change, descriptor change, source change or
permission widening invalidates the exact candidate contract. Read-back uses the
same four-file consumer gate after writing. Tests mutate each relevant boundary,
including scratch, history flags, duplicate slots, table base, public aliases and
code words, plus changed executable inputs with unchanged declarations, mixed
review generations, evidence metadata, truncation and current compiler drift.

PkVerify remains the explicitly documented Phase 1 always-approve implementation.
These checks do not establish credential authentication, lawful operational
provisioning, full-path CREATE RTL behavior, synthesis/timing, or physical-board
acceptance. No new instruction, runtime authority path or recovery behavior was
introduced.
