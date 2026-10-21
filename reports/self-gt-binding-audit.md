# SELF GT and binding audit

## Status and scope

Audit completed against the workspace code and saved artifacts on 2026-10-21.
This is a diagnosis and remediation specification, not a claim that the
implementation has been corrected. No saved LUMPs, binding snapshots, Namespace
assignments, or hardware were rewritten during this audit. Tests used temporary
fixtures. Published data and physical FPGA behavior were not inspected.

The governing requirement is that SELF is the owner's GT. An implementation
constant does not establish a separate architectural capability mechanism.

## Executive finding

There are three interacting defects:

1. Compiler/save/admission paths accept incompatible representations of SELF.
2. Bind produces destination-specific bytes, but the ordinary saved-LUMP preview
   continues to fetch the original file without showing the binding transition.
3. The newly added popup conceals the architectural decoding of two magic words;
   its Abstract-GT field labels also use the wrong bit positions.

The inspected bound snapshots do contain E-only Inform SELF GTs. The problem is
not evidence that every binding failed. It is inconsistent saved representation,
special-case interpretation, and inadequate presentation of exact bound bytes.

## 1. Actual GT decoding contradicts the popup

The authoritative bit fields are in `shared/architecture_contracts.json`.
Ordinary and Abstract GTs have different layouts.

`0xFEED5E1F` decodes under the Abstract layout as:

| Field | Bits | Value |
|---|---|---|
| GT type | 26:25 | 3 — Abstract |
| Abstract type | 31:27 | 31 |
| R | 24 | 0 |
| W | 23 | 1 |
| Generation | 22:16 | 109 |
| Abstract data | 15:0 | 0x5E1F |

This is a bit-level decode, not evidence that this Abstract subtype is valid,
authorized, or the correct SELF for any destination. It is not the expected
destination E-only Inform owner GT.

`simulator/app-lumps.js::_savedGtDecodeHtml` currently exits early for
`0xFEED5E1F` and `0xFEEDDA7A`, replacing decoding with a “placeholder” explanation.
That exemption was introduced in the recent popup work. It must be removed:
display the actual decoded fields and separately identify any implementation
special case and mismatch with the declared SELF role.

The same popup labels Abstract R/W as bits 26/25 and generation as 24:16.
Those labels are wrong. The parser itself uses the architecture contract;
the presentation must use R[24], W[23], generation[22:16], and not apply
ordinary domain/B/permission semantics to an Abstract word.

## 2. Mixed SELF representations are deliberately accepted by different paths

Evidence:

- `simulator/capability_tokens.js::materialize` writes `0xFEED5E1F` for
  `symbolic_self`.
- `server/symbolic_binding.py` accepts either zero or `0xFEED5E1F` for compact
  SELF, but requires the marker for expanded historical definitions.
- `server/portable_binding.py::validate_unresolved_clist` requires
  `0xFEED5E1F` for its SELF contract.
- `simulator/simulator.js` contains explicit installation handling for the
  marker, zero with embedded compiler-owned SELF evidence, and proven source
  or destination SELF GTs.
- `server/boot_image.py::materialize_compiler_self` has another authenticated
  SELF materialization path.

Thus the mixture is not merely stale text or a single bad popup. Changing only
the renderer or replacing one constant cannot resolve the contract mismatch.

### Read-only inventory

Among 55 nonarchived manifest records with readable LUMP C-lists:

| Stored row-zero form | Records |
|---|---:|
| Zero | 18 |
| 0xFEED5E1F | 19 |
| Other words | 18 |

These are manifest-record counts, not a count of selected or running LUMPs.
The “other words” group was not assumed valid merely because it was nonzero.

Examples:

| Artifact | Revision | Stored row zero |
|---|---:|---|
| ide.Alice | 2 | 0x4A00000E |
| ide.Alice | 3 | 0xFEED5E1F |
| ide.Alice | 6 | 0x00000000 |
| ide.AliceDriver | 2 | 0x00000000 |
| ide.MalloryDriver | 2 | 0xFEED5E1F |

## 3. Bind stores a bound derivative, but the preview does not display it

`server/namespace_binding_report.py::binding_report` reads exact selected files,
checks their hashes and binding evidence, and invokes destination localization.
It returns each row's previous and new word, status, and a derivative hash.

For symbolic artifacts,
`server/simulation_preparation.py::_localize_symbolic(bind_now=True)` also
persists the localized bytes and report under `.symbolic-bindings`.
Therefore the earlier explanation that Bind only calculates a temporary report
was incomplete. Bound snapshot bytes already exist.

`simulator/namespace-design-v1.js::acceptSavedResult` opens binding-results
windows. The ordinary history/exact-LUMP preview instead retrieves the original
artifact through its saved filename and hash. Its GT popup then decodes the
word from that original response.

Consequently, clicking a word in this preview after Bind does not prove which
word was produced by Bind. Zero in that view does not establish failed binding.

### Snapshot evidence

All 48 existing symbolic snapshot files inspected:

- matched their recorded SHA-256;
- contained row-zero words shaped as E-only Inform GTs with B=0;
- had row-zero report `newGT` equal to the actual row-zero bytes.

This is not proof that all snapshots are current, selected, activated, or
correctly bound to today's Namespace. Those require exact destination and
generation correlation. No hardware acceptance claim is made.

## 4. Additional lifecycle differences

- Legacy artifacts lacking authenticated relocation evidence are deliberately
  blocked by the binding report rather than silently reusing their old GTs.
- When no symbolic snapshot exists, simulation preparation can mint destination
  SELF while leaving other references unresolved.
- When a snapshot exists, preparation checks its identity/hash and consumes it.
- The simulator has a separate compiler-owned SELF installation path.

These paths need one explicit invariant for destination SELF and one consistent
inspection model. A successful report alone must not authorize a stale or
different execution image. Preserve the existing rule that unresolved external
references fault only when executed; this audit does not authorize a new
all-references-resolved startup gate.

## 5. Verification performed

Command:

    python3 -m pytest tests/server/test_namespace_binding_report.py \
      tests/server/test_symbolic_binding.py \
      tests/server/test_portable_binding.py -q

Result: **27 passed, 2 failed**.

Failures:

- `test_boot_generation_rejects_empty_approval_ledger`
- `test_locator_only_manifest_boot_path_localizes_exact_approval`

Both encountered the required exact SelfTest Namespace binding
(slot/token/canonical filename/hash) during boot generation. They do not
establish successful boot-path conformance for this audit and must be repaired
or supplied with complete isolated fixture inputs before that gate can pass.
Passing tests for existing marker handling do not establish that the marker
convention complies with the user's SELF requirement.

## Complete remediation requirements

### A. Correct inspection immediately

Decode every word using its actual GT type. Show declared SELF independently
from decoded word fields. Report a role/encoding mismatch explicitly. Correct
Abstract labels and test NULL, Inform, Outform, Abstract, both magic words,
malformed ordinary permissions, and unsigned values.

### B. Make Bind visible in the same LUMP inspection

Use the exact persisted derivative and matching report, not reconstructed
labels or a current-by-name catalog lookup. Identify the selected Namespace,
source artifact hash, destination slot/generation, bound hash, and status.
The displayed C-list, full hex, and GT popup must all consume the same bytes.
Retain access to the original saved revision without presenting it as bound.
Changing a selection or generation must invalidate that binding view.
Do not conflate bound with installed/running.

### C. Unify SELF production and validation

Require bound SELF to be the owner GT with E-only Inform encoding, B=0, and the
exact selected destination slot/generation. Apply the same rule to compiler
handoff, browser/server admission, linking, simulator installation, and boot
construction. Eliminate magic-word exceptions from newly produced artifact
contracts; do not merely rename them.

The pre-binding representation remains an architectural decision: when no
destination slot/generation exists, this audit cannot invent those values or
silently choose another special mechanism. Specify how that state is represented
using the established GT and relocation rules before changing producers.

### D. Preserve history and correct artifacts deliberately

Do not patch immutable historical files, signatures, or hashes in place. Keep
their bytes inspectable, label discrepancies, and create explicit corrected
revisions where required. A migration must inventory exact selected artifacts
and require deliberate adoption of replacements. Do not flash hardware.

### E. Acceptance gates

Use the same program through new compile, all save profiles, reload, Bind,
rebind after slot/generation change, exact preview, simulator preparation and
boot generation. Require agreement between named rows, report GTs, derivative
words and consumed image. Verify mixed legacy artifacts report explicit
failures, unused unresolved imports do not cause an early fault, and used
unresolved imports fault at execution.

Fix the two failing boot fixtures without weakening production checks.
Physical FPGA validation is a separate final gate, not covered by this audit.

## Conclusion

The full fix is a coordinated contract/lifecycle correction, not a cosmetic
rename. Existing bound snapshots provide evidence that the linker can produce
ordinary owner GTs. They do not excuse incompatible saved representations or a
preview that conceals the actual state. The underlying issue remains open
until the producer, validator, bound-byte display and execution gates agree.
