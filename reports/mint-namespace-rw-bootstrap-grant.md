# Mint Namespace-table RW bootstrap grant — review proposal

Status: specification only. No image construction, publication, admission,
installation, board command, or flash programming is authorized by this document.

## Exact reference pair

- Boot BIT SHA-256: `a4acb0ef9a39ba985d7769031cf146edb68fb65ff96e0b4f4a895093b54e5d4e`
- Frozen image SHA-256: `5603d8e105e47ca0f6524e4553989387c088de19ac0e6b3f6fd9897e170cf16d`

The image is 64 KiB, with an ascending 64-slot table. Words 0–3
are metadata; the Namespace self-descriptor is at slot 1. Its raw words are
`00000000 000000FF DEB25EEF 00000000`.
The table covers words 0–255, bytes [0,1024).
This is not the historical isolated Mint trial's larger 256-slot table.

## Proposed grant

Use a separate descriptor alias, named `ide.MintNamespace`, at proposed slot 22.
That slot's four words are zero in the exact reference image. Zero words prove
vacancy in this snapshot, not that the slot has never been issued.
Slot 20 from the historical trial must not be reused: it is occupied here.

| Field | Proposed value |
| --- | --- |
| Descriptor slot | 22, subject to reservation/history review |
| W0 base | `0x00000000`, matching the root exactly |
| W1 | `(sequence << 21) | 0x000000FF` |
| W2 | `integrity32(W0, W1)` |
| W3 | `0x00000000`, matching the reference root's identity word |
| GT kind | Inform |
| GT domain | Data |
| Permissions | R and W only; no X or Church L/S/E |
| GT bit 31 | 0 |
| GT word | `0x32000016 | (sequence << 16)` |

For an explicitly established fresh sequence-zero slot, the exact descriptor is
`00000000 000000FF DEB25EEF 00000000`, and the GT is `0x32000016`.
These values were calculated with the project's GT encoder and integrity helper.
They are conditional review values, not a token approved for a live/reused slot.
If history requires a different sequence, both W1/W2 and the GT must change.

The descriptor occupies image words 88–91, bytes [352,368). Its payload
is an alias of the existing table, not another allocation or copy.
The reference root, metadata, boot entry, other descriptors and UART scheduling
control word 255 must not be modified merely to introduce this alias.
Any required metadata accounting belongs to a separately reviewed image build.

## Mint binding

Provision this GT privately into Mint's C-list row 5, matching the current
`ide.MintNamespace RW` declaration. The slot-writing block already uses
`LOAD CR10, CR6, #5`. Descriptor slot N is accessed at data word offsets
`4*N` through `4*N+3`, followed by readback.

Do not place this authority in ordinary callers' C-lists or accept a
caller-supplied replacement. The RW grant covers the complete table, including
metadata and existing descriptors; it does not enforce an empty-slot-only policy.
Mint's software owns that policy. Four descriptor writes are not atomic.

## Review gates before building or executing

1. Establish slot 22 reservation and sequence history for the new candidate;
   never infer fresh history from its four zero words.
2. Select the exact Mint artifact and validate its actual row-5 declaration.
   This proposal does not identify a Mint executable in the reference image
   by guessing from archived names or slot numbers.
3. Confirm that the frozen BIT resolves this data-domain alias and permits
   ordinary DREAD/DWRITE at the stated bounds. Encoder arithmetic is not
   execution or hardware acceptance.
4. Review the remaining Mint bindings: pool/Cleaner, allocation state,
   scratch, result delivery and lawful invocation.
   This grant supplies table access only; it does not by itself complete CREATE.

## Passkey scope for this demonstration

The user directs that the passkey parameter remain in the interface but be
ignored, as with Mint.CREATE. This path must not require an Abstract-passkey
load or verifier call, and must not report the ignored passkey as verified.
The Namespace-table grant remains an Inform RW capability. Normal capability
permissions, bounds, sequence, and integrity checks remain in force.
This is a demonstration-specific interface decision, not removal of passkey
enforcement from other profiles. Executable changes and installation remain
separate steps.

The next proposed check is read-only verification of this grant against the
frozen BIT's source contract and the chosen Mint artifact. No RTL replay or
physical operation is included.
