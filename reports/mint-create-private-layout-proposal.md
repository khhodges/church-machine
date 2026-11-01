# CREATE-only private binding and memory-layout proposal

Status: review proposal, not a constructed or installable image.
No live state, immutable artifacts, board configuration, or flash was changed.

## Pinned inputs

- Frozen BIT: `a4acb0ef9a39ba985d7769031cf146edb68fb65ff96e0b4f4a895093b54e5d4e`
- Reference image: `5603d8e105e47ca0f6524e4553989387c088de19ac0e6b3f6fd9897e170cf16d`
- CREATE word-address candidate: `683d9dfd8ed57a78be05df17bc7bb241b0aa3d5366536f32ec4d007250eb4bfe`
- Cleaner: `a3c09fb7ae2ff7e13a89adfcdbb20ec9ed326ff8cc4d5272cc107fce4776b8f2`

All addresses in the table below are physical **word addresses**, as stored
in resident descriptors for this BIT. Byte addresses are shown separately.
The original table has 64 slots and occupies words [0,256).
Slot zero is metadata; slot 1 is the Namespace root.

## Proposed placement

Ranges are half-open. Existing resident descriptor extents end at word 4736.
The proposed new independent allocations are zero-filled in the pinned image
and do not overlap any existing RAM descriptor extent.

| Slot | Purpose | Word range | Byte base | Words |
| --- | --- | --- | --- | --- |
| 22 | Namespace RW alias | [0,256) | 0x0000 | 256 |
| 23 | Mint CREATE candidate | [5120,6144) | 0x5000 | 1024 |
| 24 | MintCleaner | [6144,6656) | 0x6000 | 512 |
| 25 | MintState | [6656,6912) | 0x6800 | 256 |
| 26 | Private allocation pool | [7168,8192) | 0x7000 | 1024 |
| 27 | MintScratch L alias | [6911,6912) | 0x6BFC | 1 |
| 28 | CleanerState | [6912,6976) | 0x6C00 | 64 |
| 29 | Reserved demonstration caller | [8192,8448) | 0x8000 | 256 |
| 30 | Reserved caller Thread | [8448,8704) | 0x8400 | 256 |
| 32 | First dynamically issued object | initially absent | later 0x7000 | later 8 |

The two deliberate aliases are the Namespace-table view and MintScratch.
The issued object will deliberately occupy a subrange of the private pool.
Caller and Thread space are reservations, not existing compiled executables
or prepared activation state. Gaps and all other existing objects remain
untouched by this proposal. No boot-entry replacement is selected here.

Slots 22–30 and 32 contain zero descriptor words in the reference snapshot.
That proves vacancy only, not issuance history or present board state.

## History decision required

This proposal recommends an explicitly **fresh disposable candidate universe**
for the demonstration, with sequence zero for new bindings. It must not be
presented as a continuation of the live board's allocation history.
Approval of this proposal must establish that fresh origin before image
construction uses these tokens. A live/reused-slot installation would instead
require actual retained history and recomputed sequence-dependent words.

Mint's free queue contains only slot 32. Slot 22 and every service/caller slot
are unavailable to Mint allocation. Do not restore the initial history after
issuing a token and claim it represents the same continuing universe.

## Private C-list bindings

The following GTs assume the approved fresh sequence-zero origin.

### Mint, slot 23

| Row | Declaration | Binding |
| --- | --- | --- |
| 0 | SELF E | `0x4A000017` |
| 1 | MintState RW | `0x32000019` |
| 2 | MintScratch L | `0x1A00001B` |
| 3 | MintPool RW | `0x3200001A` |
| 4 | MintV4Verifier E | proposed NULL; unused in CREATE |
| 5 | MintNamespace RW | `0x32000016` |
| 6 | MintCleaner E | `0x4A000018` |
| 7 | MintApproval LS | proposed NULL; passkey ignored |

Rows 4 and 7 remain declarations in the unchanged API. Their proposed NULL
bindings need to pass ordinary image/admission validation; unused code paths
are not permission to bypass validation or silently delete dependencies.
No verifier artifact, Abstract token, or substitute always-approve service
is provisioned.

### Cleaner, slot 24

| Row | Declaration | Binding |
| --- | --- | --- |
| 0 | SELF E | `0x4A000018` |
| 1 | CleanerState RW | `0x3200001C` |
| 2 | CleanerPool RW | `0x3200001A` |

MintPool and CleanerPool are two private names for the same allocation extent,
not separate overlapping allocations.

The caller receives only its normal SELF/entry authority and Mint E
(`0x4A000017`); it receives no table, state, scratch, pool, or Cleaner grant.
It receives the created object's RW GT only through CREATE's normal result.
Its passkey input is present but NULL/ignored. Its Thread must be initialized
and entered through the approved ordinary mechanism; no host-forced CALL
frames, direct program-counter entry, or M-bit bypass are proposed.

## Initial state words

### MintState (offsets relative to word 6656)

| Offset | Initial value | Meaning |
| --- | --- | --- |
| 0 | `0xF9000001` | 256-word header; one final scratch/C-list word |
| 1, 2, 5 | 0 | unused legacy allocator fields on active CREATE path |
| 3 | 7 | free queue cursor |
| 4 | 8 | free queue exclusive end |
| 6 | 64 | history array offset |
| 7 | 32 | sole free slot |
| 64–127 | `0x400`, except offset 96 | reserved/unavailable histories |
| 96 = 64 + 32 | `0x200` | explicitly fresh, never-used slot 32 |
| 255 | 0 | private scratch word |

Other words start zero. MintScratch's L descriptor aliases precisely offset
255, with inclusive limit zero, so LOAD index zero reads the scratch token
rather than MintState's header.

### CleanerState (offsets relative to word 6912)

| Offset | Initial value | Meaning |
| --- | --- | --- |
| 0 | `0xF8000000` | 64-word header |
| 1 | 0 | pool cursor, words |
| 2 | 1024 | pool exclusive end, words |
| 3 | `0x7000` | pool physical byte base, kept in Cleaner's byte convention |
| 4 | 1 | one allocation-record capacity |
| 5–8 | 0 | record: offset, capacity, owning slot, status |

Other words start zero. This intentionally permits one allocation, not a
general allocator demonstration. The pool initially contains zero words;
CREATE must still execute Cleaner's normal zeroing.

## Expected first CREATE

Request eight RW data words: packed allocation DR2 = 12 (`8 | 4`),
permissions DR3 = 3. Passkey remains included and ignored.

Expected new slot-32 descriptor:

```
W0  00001C00   resident word base 7168
W1  00000007   inclusive limit 7, sequence 0
W2  DEA35EEF   integrity over encoded W0/W1
W3  B2000020   Mint-issued DATA RW Inform identity
```

Expected stored/issued GT is `0xB2000020` (the saved issuer sets bit 31);
it must not be silently replaced by the bit-31-clear provisioning token
`0x32000020`. The resolved byte base is `0x7000`.
Public return status is DR1 = 0, with the non-NULL result in CR1.
Mint's internal DR1 = 1 is not its public ABI success value.

Expected allocation bookkeeping:
- Mint queue cursor becomes 8.
- Slot-32 history becomes `0x400` (sequence zero reserved/issued).
- Cleaner cursor becomes 8.
- Cleaner record becomes `[0, 8, 32, 1]`.
- Mint scratch is cleared after loading the result.

Later execution acceptance must observe the ordinary CALL/RETURN result,
eight zeroed words, write/readback through returned CR1, and descriptor
readback. Offset 8 must fault in a separate negative run, not by continuing
after a fault. A second CREATE exhausts the sole slot queue.
These are expected outcomes, not results obtained in this proposal.

## Checks performed and remaining gates

Read-only arithmetic checks passed for exact input hashes and artifact sizes,
seven independent non-overlapping allocations, ten vacant descriptor slots,
scratch placement, state-array bounds, and preservation of UART control word
255. No source compilation or simulator/RTL execution occurred in this step.

Before constructing any image:
1. Approve the fresh-disposable history origin and proposed layout.
2. Check ordinary validation of unused NULL C-list declarations without bypass.
3. Specify and compile the caller, lawful Thread state, and explicit startup
   handoff. Existing boot/application code must not be silently replaced.
4. Bind exact artifact copies, preserving immutable originals and retaining
   the resulting localized-byte provenance.

DESTROY and the other Mint methods remain outside this CREATE-only proposal.
Physical upload, reboot, release approval, and flash programming remain
separately authorized operations.
