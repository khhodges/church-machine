# Root-frame candidate review — 2026-10-10

## Follow-up: executable-limit mismatch resolved

Boot CHANGE now accepts the two exact descriptor layouts in use: full allocation
and public body ending immediately before the C-List. It preserves the supplied
limit in CR0 rather than widening authority. Other limits still fail closed.
This follows the existing generator/regression contract and CALL's separate
header-derived C-List region; it is not a new instruction encoding.
The LUMP specification's separate CR14/CR6 regions support that separation;
the instruction-set text does not itself specify these two Namespace limit
encodings, so this is implementation-compatibility evidence, not a claim that
both encodings are explicitly mandated there.

87 boot-CHANGE and scheduler tests passed, including truncated/oversized
descriptor rejection. The exact candidate projection also passed the behavioral
replay with all 16 complete capability triples checked, no CR8 writes, and no
memory writes. Evidence: `generated-artifacts/root-frame-limit-corrected/`.
The 1,229 protected input files remained unchanged. No approval was frozen;
fresh elaboration provenance and release review remain outstanding.

The following records the initial failure before this correction.

## Result: candidate prepared, approval blocked

The merged boot CHANGE was replayed against a newly generated candidate's
Wukong memory projection. Generation and resident-artifact validation passed.
Boot.Thread has a canonical poison root. Thread.2 and Thread.3 retain
CapabilityTest entry continuations above their poison roots.

The behavioral replay fails with BOUNDS (8), before any capability-register,
data-register, flag, NIA, or memory write. This is not successful boot evidence.
No approval freeze was attempted.

Fresh generation reproduced the live generic image byte-for-byte:
SHA-256 `0ff1b24d76b7010c13b8b50737f4513a771b586be73b8d0fa80a748087070a5b`.
It is therefore a separate diagnostic copy, **not a new image revision**.
The generic image already contains the root frames. The older empty-stack
failure concerned the retained RTL initializer replay, not absence of roots
in these generic image bytes. Generic-image, projected-memory, and elaborated
initializer evidence must not be treated as interchangeable.

## Blocking contract mismatch

The selected CapabilityTest has a 1,024-word allocation and 11 C-List words.
The generator deliberately sets its executable descriptor limit to
`1024 - 11 - 1 = 1012` (`0x3F4`).
The Wukong projection preserves that authority.
The merged boot CHANGE entry-header check instead requires an executable
descriptor limit of `allocation - 1 = 1023` (`0x3FF`).

The candidate therefore passes the root-frame checks but fails the entry
geometry check. Changing the root again will not fix this.
Resolve the intended executable-limit/C-List access contract against the ISA
before changing either the descriptor or the hardware gate. Do not widen
authority, substitute a selected artifact, or bypass this rejection to freeze
an approval.

## Reproduction and retained evidence

Run with a fresh output directory:

    python3 scripts/prepare_root_frame_candidate.py --output generated-artifacts/root-frame-review

The command deliberately exits nonzero on a rejected candidate and still
records `evidence.json`, the generic candidate, its Wukong projection, and the
private input catalog. These are unapproved diagnostic inputs, not a bitstream.
The first run is retained under
`generated-artifacts/root-frame-candidate-2026-10-10/`.

All live catalog files, boot configuration, and retained Namespace revision
files were hashed before and after; every hash was unchanged. Selected LUMP
hashes were checked against their saved selections.

No live image replacement, historical snapshot repair, synthesis, routing,
FPGA programming, reset, or board command was performed.
Once the geometry contract is resolved, exact candidate replay and real
elaboration-provenance checks remain necessary before approval.
