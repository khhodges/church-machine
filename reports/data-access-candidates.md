# ISA-correct data-access candidates — review only

The user approved compiler/simulator correction and preparation of candidates,
not publication or replacement of the saved Namespace.

## Candidate differences

Six sources were compiled through the running authenticated-compiler endpoint.
Instruction counts, method offsets and non-data-access words are unchanged.
Only retired immediate-only DREAD/DWRITE operand encodings differ:

| LUMP | Changed instruction words |
|---|---:|
| ide.Alice | 2 |
| ide.AliceDriver | 3 |
| ide.WukongCallHome | 16 |
| ide.MalloryDriver | 0 |
| ide.CapabilityTest | 0 |
| ide.AmoebaStartup | 0 |

For example, WukongCallHome's `DREAD DR8, CR2, #408` changes from
`0x87414198` to `0x87411980`. The latter selects DR0 plus magnitude 408.
These are newly compiled outputs, not patched saved artifacts.

Candidate compiler responses and the per-instruction diff are in
`generated-artifacts/data-access-candidates/`. Reproduce with
`python3 scripts/prepare_data_access_candidates.py`; this command has no
publish, save, bind, approve or activate mode.

The saved Namespace fingerprint was unchanged before and after compilation:
`49f48c9e2f55906f84d0921acb6fa5643f6e008c475610d5707ed2ec7cc4d5d3`.

## Compiler and simulator behavior

Ordinary assembly, disassembly, compiler-generated memory access, IDE routing,
and ordinary words executed inside the indexed execution profile use the
single-word sign/magnitude/DR-index layout. No legacy bit-14 immediate fallback
was added. The simulator rejects offset underflow/overflow before memory or
MMIO effects and avoids address wraparound.

Old saved words retain their bytes but are not compatible with the corrected
data-access decoder. The previous 8K simulator run is historical evidence;
it is not evidence for the corrected decoder or these unpublished candidates.

## Verification and limits

- `node simulator/test_compact_data_access.js`: passed exact encodings,
  disassembly roundtrips, invalid operands, actual simulator reads/writes,
  and underflow/overflow containment.
- `python3 -m pytest hardware/test_phase1_rtl_operands.py -q`: 39 passed.
- Six ordinary server compilation requests succeeded.
- `git diff --check`: passed.
- The existing `test_compact_load_save.js` reaches an unrelated worker fixture
  failure: its old `CompactIndex` source lacks the currently required canonical
  dot-name and explicit methods. It is not counted as a passing suite.

These candidates have not been bound into a new complete image or replayed
end-to-end. No saved LUMP, Namespace selection or physical FPGA was changed.
