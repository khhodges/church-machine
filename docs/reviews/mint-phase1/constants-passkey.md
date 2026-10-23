# Constants and Passkey — Phase 1

The user approved two separate CLOOMC function abstractions in place of the
combined AbstractGTManager. Constants must supply usable numerical values,
not merely identifying tokens. Passkey retains the original embedded proof
pool and named issuance.

## Files and verification

- `simulator/cloomc/constants.cloomc`: `ide.Constants`.
- `simulator/cloomc/passkey.cloomc`: `ide.Passkey`.
- `simulator/cloomc/constants_circle.cloomc`: executable numerical example.
- `simulator/abstract_gt_phase1.js`: Genesis-side catalogue/state preparation,
  not a runtime implementation of either abstraction.
- `node simulator/test_constants_passkey.js`: compiled native CALL/RETURN
  tests, including all 100 values and all 100 proof tokens.
- The existing `node simulator/test_abstract_gt_phase1.js` command runs that
  same suite for continuity.

The old combined CLOOMC source was removed. Neither new abstraction is
automatically installed in a saved Namespace. No ISA change, host dispatch,
new numerical opcode, FPGA programming or live boot-image change is involved.
The unrelated historical JavaScript Abstract manager is not used.

## Constants API

| Method | Source selector | Input | Output |
|---|---:|---|---|
| Get(name) | 0 | CR2: name DATA R | CR1: Abstract constant token; DR1=1 |
| value(token) | 1 | CR1: Abstract constant token | DR1=16; DR2: signed real component; DR3: signed imaginary component; CR1 retained |

`CALL CR0, #0` and `CALL CR0, #1` use the existing assembler selectors. The
standard LUMP builder emits their method table.

Names are exact and case-sensitive. A name DATA object contains its LUMP
header, length (1..31), then one ASCII character per word. PHI is an alias of
GOLDEN_RATIO and shares both token and numerical value.

`value` uses native EXACT against the trusted catalogue identities. It does
not interpret arbitrary payloads as numbers. Proof tokens and unknown tokens
fault; NULL triggers the ISA NULL capability fault. The reference scratch
word is erased after every comparison. Private capabilities do not survive
RETURN.

### Numerical format

Phase 1 uses **signed Q16.16** for both components. This is an implementation
choice using the existing integer ISA, not a new hardware format:

```
real value      = signed32(DR2) / 65536
imaginary value = signed32(DR3) / 65536
DR1             = 16 fractional bits
```

DR1..DR3 are the existing CALL result registers; do not put a result in DR4
and expect it to survive RETURN (DR4..DR15 restore caller state).

Range per component is -32768 through 32767.99998474121. Values are rounded
to the nearest 1/65536; half-way cases round toward positive infinity.
Maximum quantization error from the supplied numerical approximation is
1/131072, approximately 0.00000763. Catalogue preparation rejects non-finite
values, overflow and incomplete records rather than silently truncating.
Named mathematical constants are represented by approximations at this
precision, not arbitrary-precision exact arithmetic.

Examples:

| Name | DR1 | Signed DR2 | Signed DR3 | Meaning |
|---|---:|---:|---:|---|
| PI | 16 | 205887 | 0 | 3.1415863037109375 |
| HALF | 16 | 32768 | 0 | 0.5 |
| NEG_ONE | 16 | -65536 | 0 | -1 |
| I | 16 | 0 | 65536 | +i |
| NEG_I | 16 | 0 | -65536 | -i |

The token remains a one-word exact identity even when two numerical components
are returned. Logical TRUE/FALSE remain distinct from numerical ONE/ZERO.

### Calculation example

`ide.ConstantsCircle.AreaRadiusTwo` performs this sequence in native CLOOMC:

```
LOAD CR2, CR6, #1      ; provisioned name "PI"
LOAD CR0, CR6, #2      ; Constants E
CALL CR0, #0          ; Get(PI) -> token in CR1
LOAD CR0, CR6, #2
CALL CR0, #1          ; value(token) -> DR1/DR2/DR3
IADD DR2, DR2, DR2    ; 2*pi
IADD DR2, DR2, DR2    ; 4*pi = area for radius 2
RETURNAL #2
```

Result: DR2=823548, or 12.56634521484375. The test runs the complete example
through CALL/RETURN; the numerical calculation is not performed by a host
callback. General fixed-point multiplication/division requires the appropriate
software arithmetic and rescaling; this work does not add a new arithmetic
library or silently interpret integer operations as floating point.

### Constants private data

SELF is followed by:

1. `ide.ConstantsScratch RW` — private DATA object, scratch at word 1.
2. `ide.ConstantsCatalogue R` — read-only name/token/value records.
3. `ide.ConstantsScratchLoad L` — exact one-word view of scratch word 1.

Catalogue: header, count (101 including PHI), then 36-word records:
name length, token, 31 character words, real, imaginary, fractional-bit count.
`catalogueImage()` prepares these exact records. Word zero is reserved for
the installer's DATA LUMP header; returned arrays are not standalone
installable artifacts. Genesis provides the correct bounds and bindings,
serializes scratch use, and does not export writable catalogue authority.

## Passkey API

`Passkey.NewProof(name)` is source selector 0. CR2 is the name DATA R
capability; success returns CR1=B=0 Abstract proof and DR1=1.

SELF is followed by `ide.PasskeyState RW` and `ide.PasskeyScratch L`.
The state is: header, issued count, capacity, cursor, scratch, reserved,
then 33-word records (name length, token, 31 character words).
Scratch L is an exact one-word view of State[4].

The same original 100 preformatted tokens are embedded as raw `.word` data.
A branch skips the table at entry. With one method the table starts at LUMP
word 3; a compiled-layout test guards that offset. No external random buffer
or catalogue capability is required by Passkey.

Duplicate names are rejected without changing state. Collisions skip a pool
entry; exhaustion faults and never wraps. The record count is committed only
after formation of the record/result. Genesis must serialize calls and retain
the issued records and cursor with the exact pool artifact across restarts.
Never recreate empty state while issued tokens remain provisioned. Capacity
is 1..1024 records, but the fixed pool permits at most 100 distinct issuances.

### Explicit private saved-image path

`simulator/passkey_saved_image.js` supplies Genesis-side file persistence:

```js
savePasskeyImage(filename, {artifactWords, stateWords});
const restored = restorePasskeyImage(filename, expectedArtifactWords);
// restored.artifactWords and restored.stateWords are independent Uint32Arrays.
```

Genesis must stop execution and serialize issuance before capturing both arrays
and keep it stopped until the save completes. `artifactWords` is the complete
selected executable LUMP (header, original embedded pool, code and c-list);
`stateWords` includes the DATA header, count, capacity, cursor, scratch/reserved
words and all allocated records. No pool generation or compilation happens on
restore. The expected artifact must come from Genesis's trusted selection,
not be copied from the untrusted saved image. Restore returns data only; it
does not install a Namespace, activate execution, or distribute capabilities.
The destination must retain the saved private-state and scratch bindings.

The single versioned JSON envelope retains both arrays and a SHA-256 checksum.
Save validates before touching the destination, writes a private mode-0600
temporary file, flushes it, atomically renames it, and flushes the directory.
Use a private Genesis-owned directory and a single serialized writer.
Restore rejects missing, truncated, corrupt, mismatched or invalid state;
there is no empty-state fallback. Issued names and tokens must be unique,
tokens must occur in the consumed pool prefix, and count/capacity/cursor
must remain in bounds. Cursor is retained independently of count, including
skipped entries and terminal exhaustion. Scratch must be zero at this boundary.

This checksum detects corruption, not malicious rewriting or rollback.
Genesis must retain the latest successfully saved image and must not resume an
older snapshot while later-issued tokens remain provisioned. This explicit
save path does not make unsaved issuance crash-durable or provide a monotonic
external rollback anchor. An interrupted in-flight call is not a save boundary.
No state is sent to diagnostics or public API endpoints.

Genesis alone distributes the Passkey E capability and approved result tokens.
Knowing a name grants no authority. The internal pool is readable in source
or binary; it is not a cryptographic secret. Mint still authorizes by EXACT
against its approved reference. No revocation, refill, replacement or generic
passkey lookup API was added.

## Evidence limits

Tests use isolated simulator RAM and ordinary compiled instructions. Negative
paths assert actual hard-fault sites (no signed diagnostic sidecars are loaded
in the fixture). All 100 numerical values, alias identity, negatives, complex
components, pi arithmetic, unknown/proof/NULL inputs, corrupted format,
all 100 proof issuances, collisions, duplicates, exhausted/full pools and
private capability cleanup are checked.

The same test command additionally saves into a disposable directory, restores
into fresh simulator RAM, and executes native CALL/RETURN to prove next-token
advancement, duplicate rejection without mutation, full-capacity rejection,
independent cursor retention and terminal exhaustion across repeated restarts.
It also rejects wrong artifacts, damaged/truncated/missing images and invalid
state without overwriting a valid save.

This is isolated saved-image/software execution evidence, not live
installed-namespace persistence or hardware evidence.
The former combined 33-word constants catalogue is not
compatible with the new 36-word Constants records; do not reuse it.
