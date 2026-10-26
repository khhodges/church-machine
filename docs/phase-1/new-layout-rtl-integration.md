# New Layout RTL integration — incomplete

## Latest progress: relative continuation handoff verified

The user selected program-relative saved NIA. The active Master and RTL
CALL/RETURN/CHANGE handling now use that convention. The unchanged retained
image passes the first CHANGE, CALL to Alice, RETURN and caller instruction
at byte `0x3910` in the full Wukong model. See the runtime trial README and
`relative-nia-return-header-result.json` for bounded evidence.

The next instruction is AmoebaStartup's historical duplicated-field CHANGE at
`0x3914`, requiring a separately approved corrected trial revision. Complete
program execution and physical reload remain pending. Earlier blockers below
are historical findings; no synthesis, upload or flash operation has occurred.

The user authorized RTL correction and offline verification, not synthesis,
physical image upload, FPGA flashing, or alteration of saved Namespace/LUMPs.
Do not treat a boot-slot renumbering as completion.

## Approved contract

Use `01-isa/instruction-set.md`, particularly the reset-only activation marker,
boot-image matching guard and reset-ROM fetch authority sections. These supersede
older assumptions that the boot pair is always version zero:

- Metadata is at address zero; ascending descriptors have self at slot 1 and
  entry Thread at slot 2.
- An explicit, retained 18-bit guard supplies expected slot versions, each in
  0–510. Hardware compares them; it never copies expected versions from memory.
- Check slot 1 during Namespace admission and slot 2 during Thread admission.
  Mismatch is VERSION with failing-slot identification, not a new fault category.
- Marker `0x27000001` is accepted only once per reset at its immutable-ROM
  position. Consume admission on acceptance, including subsequent failed Thread
  validation. Software M bits never authorize or re-arm it.
- Final ROM CALL CR0 must perform normal validation and end reset-ROM fetch
  authority only on successful transfer. CR13 remains untouched.

## Implemented offline building blocks

- `hardware/ascending_namespace.py`: reads the original first twelve image
  words over a byte-addressed memory bus; checks metadata geometry and seals,
  exposes the actual slot versions, and calculates the Thread bus address.
  It does **not** establish expected guard values or validate Thread body/frames.
- `hardware/boot_pair_guard.py`: independent per-stage VERSION comparison
  against explicit elaboration constants; latches transaction inputs.
- `hardware/reset_marker.py`: one-shot marker admission, with explicit
  machine-owned context inputs. This grants no data-memory privilege.

The retained image fixture is exactly 65,536 bytes, SHA-256
`47966de85a7a8561b838a6c85f3ea6de447a7c54b0ea3b9c198527992ea4c565`.
Tests pin its hash before reading metadata. Altered fixtures and synthetic guard
values exist only in test memory; saved artifacts remain unchanged.

## Verification boundary

The focused tests cover actual retained metadata, malformed metadata/seals,
independent stage mismatches, input latching, reserved guard values, wrong marker
context, replay, fresh-reset re-arming and handoff revocation:

```sh
python3 -m pytest \
  tests/hardware/test_ascending_namespace_bootstrap.py \
  tests/hardware/test_boot_pair_guard.py \
  tests/hardware/test_reset_marker_admission.py -q
```

These are **component tests, not full-image execution evidence**. The metadata
reader, slot-1 comparison and incoming-only reset Thread activation are now
connected to the guarded core. The checked final CALL now reaches ActorManager's
first authored LOAD in both the core and full Wukong models. The longer UART
observation exposes INVALID_OP at fetch PC 0x350c; clean continuation, complete
UART evidence and the physical upload endpoint remain unverified for this image.
The reset-marker block has the fail-closed core integration below.
Passing these checks does not make the current core compatible or authorize an
upload.

### First core integration: reject unadmitted reset markers

ChurchCore now routes the exact marker through ResetMarkerAdmission, rather
than allowing it to start an ordinary CHANGE. Rejection uses INVALID_OP and
blocks CHANGE dispatch and sequential PC advancement. Existing fetch/bounds
fault precedence is retained.

WukongTop supplies the actual ROM/data-memory mux tag and a synchronously
captured fetch address, aligned with returned instruction data. A current-PC
comparison is not used as proof of immutable-ROM provenance.

**Initial integration boundary (now superseded by the Namespace stage below):**
the Namespace-admitted input was held false pending slot-1 validation. Boot completion,
retirement count, a ROM tag/address and software M state cannot substitute for
that validation. The old ROM has not been replaced, and successful new-marker
Thread activation is not implemented by this step.

Verification:

- Real-core tests at the designated marker address, with both ROM-tag values,
  reject repeated marker issue without memory writes, M-state changes or PC
  advancement. Tests use Wukong's deferred fault-reset policy.
- Together with existing boot-helper, marker-unit and guarded-candidate tests:
  **14 passed**.
- Full Wukong simulation-mode top-level elaboration passed. This is a structural
  check, not synthesis or complete image execution.

Namespace validation is now connected as described below. Instruction issue
remains disabled until the incoming-only Thread path and reset sequence are wired.

### Guarded Namespace admission integrated

An explicit `expected_boot_guard` build parameter now connects the metadata
reader and slot-1 comparison through ChurchCore and WukongTop. This is a retained
build constant, not a value inferred from the incoming image. For the retained
candidate the expected Namespace version is 46.

The Namespace stage reads only the first eight words (metadata and self).
Thread contents cannot mask a Namespace-stage failure. On success it installs
CR15 from the verified descriptor and expected version, then holds before
Thread activation. The marker receives the verified Namespace-admission state,
but boot completion/instruction issue remains disabled at this staging boundary.
Historical CR12/CR6/CR14 initialization states are not entered.

Invalid metadata or seal hard-faults; a correctly re-sealed but mismatching
Namespace version produces VERSION and slot 1 on the core diagnostic output.
No CR15 installation occurs on those failures. A fresh explicit reset clears
admission and revalidates rather than retaining the previous Namespace.
Guard failure never selects the historical bootstrap. Existing callers without
an explicit guard remain historical callers, not an ascending-image fallback.

Verification: **45 focused tests passed**, including real-core tests using the
retained candidate bytes, actual CR15 snapshot contents, no memory writes or
Thread activation, stage ordering, and reset after successful admission followed
by a mismatching image. Guarded Wukong simulation-mode structural elaboration
also passed. No synthesis was invoked. Fault-slot evidence here is from RTL,
not from a new physical-board snapshot or bridge protocol test.

Slot-2 structural validation is now integrated as described below. Successful
Namespace admission alone is not a boot.

### Slot-2 structural validation integrated

`BootThreadValidation` runs only after Namespace admission, using the same
retained expected guard and checking Thread version 419. It reads the original
slot-2 descriptor and body without rewriting or translating the image.
Resident word locations are multiplied by four only at the memory-bus boundary.

The read-only checks cover:

- Expected version and descriptor seal; free-state and in-range allocation.
- Thread type, supported size, twelve capability homes, nonempty stack/heap
  geometry, and the declared allocation limit.
- Protected indicator structure, in-range poison-root position, structural
  executable Inform root GT, canonical poison frame and matching CR0 home.
  The live indicator's flags are retained, not confused with frame NIA bits.

This is boot-only root validation: it does not resume the poison root or
invent a program-counter-zero continuation. The eventual explicit CALL CR0
still requires ordinary target validation. Other capability homes and their
destination authority have **not** yet been validated/restored by this block.

The core latches `boot_thread_validated` only on structural success. It remains
held before activation in both success and failure cases. Slot-2 errors report
their existing fault type and slot 2; already-installed CR15 is not rolled back.
CR12 remains NULL, with no memory writes or instruction execution. Fresh reset
clears validation and rechecks; an altered, correctly re-sealed slot-2 version
cannot reuse previous success.

Verification: **20 targeted real-core tests passed** across Thread validation,
Namespace admission and marker rejection. Cases cover the exact retained image,
version/seal/location/limit/type/size/stack/indicator/root-GT/root-frame/CR0
failures and successful-check/reset/mismatch sequencing. Guarded Wukong structural
elaboration also passed, without synthesis or physical access.

Capability-home checks and incoming-only activation are now connected below.
Full-image boot, loader integration and physical verification remain pending.

### Incoming-only activation connected

After Namespace admission, the guarded core advances to the designated reset
marker position. Guarded Wukong ROM uses exact marker `0x27000001` there.
The marker can start `BootThreadActivation` only with validated Namespace and
Thread structure, aligned immutable-ROM provenance, and unconsumed reset admission.
It never dispatches through the ordinary CHANGE implementation.

The activation unit latches its accepted inputs, validates all twelve homes and
buffers their resolved values plus DR1–DR15 before any restoration writes:

- Inform homes must pass slot bounds, original descriptor version/seal/free-state
  checks and supported address bounds. Stored resident word locations become
  internal cached byte addresses only after those checks; MMIO addresses retain
  their explicit address form. Original descriptor authority is preserved.
- NULL homes discard all cached authority. Abstract operands retain opaque GT
  values without resident caches. Outform homes fault OUTFORM_UNAUTH: this path
  has no authenticated Outform-to-resident admission and must not invent one.
- CR0 must still match the validated root GT. Its eventual executable geometry
  and CALL rights remain the responsibility of normal CALL validation.

Only after these checks does the unit restore homes, CR12, the derived CR5 heap,
DR1–DR15 and saved flags. It never writes CR13/CR14, grants M bits, writes memory
or saves an outgoing Thread. Active Thread ownership is published on completion.
The core then holds at the final CALL position, byte address 8.

Marker admission is consumed when accepted, including subsequent home-validation
failure; changing software M state cannot re-arm it. Validation failure leaves
all architectural registers as they were before activation, including the
already-admitted Namespace. Replaying/copying the marker after success faults.

Verification: **27 targeted tests passed**, including exact-candidate activation,
synthetic nonzero DR/flags and MMIO/Abstract/NULL restoration, stale home versions,
bad entry seals, forbidden metadata-slot references and unadmitted Outforms.
Tests use a CR13 sentinel to detect even an accidental clearing write and check
the restored CR0/CR12/CR5 triples, unchanged M state, no memory writes and consumed
admission on failure. Guarded Wukong structural elaboration also passed.

This proves the core activation boundary, **not complete Wukong reset or program
execution**. Full ROM sequencing/retirement trace, final CALL, ordinary memory
address handling and post-handoff fetch validation remain to be verified.
The stock initializer has not been replaced with the guarded candidate, and
structural elaboration alone is not evidence that a full top-level model or
physical board installed those candidate bytes. No synthesis or hardware action
was performed.

### Checked code-load prerequisite for final CALL

Guarded core cLoad now explicitly selects the ascending profile. The shared
Namespace gate checks the original stored descriptor and its version at bit 17;
only after successful validation does cLoad convert resident word locations to
internal byte addresses. The historical profile retains its bit-21 version
layout; this is an explicit constructor choice, not detection or fallback.

Guarded cLoad rejects out-of-table slots before reading them, freed descriptors,
nonresident executable addresses, malformed executable headers and allocation/
public-body limit mismatches before publishing CR6/CR14. It cannot disable seal
validation. Same-code comparisons use the converted byte address. Header reads
also have a stale-valid guard between Namespace lookup and payload access.

The retained ActorManager entry resolves to the expected CR6 and CR14 locations
in the real cLoad RTL model. Negative fixtures exercise seals, versions, E
permission, headers, limits, free state and table bounds. A separately resealed
nonzero-version fixture ensures success is not an accident of the entry's zero
version. These fixtures modify in-memory copies only, not retained bytes.

The guarded core no longer enables the historical first-three-retire blanket
privilege window. That is not a replacement for trusted-ROM fetch authority:
the final CALL remains held at byte 8 until its full path is implemented and
verified. cLoad success is **not** CALL completion, stack-frame verification,
reset-trace completion or observed program execution.

Remaining integration includes the other CALL/mLoad and cached-authority
consumers: legacy cached authority views use a 21-bit limit, while the retained
ascending Namespace uses 17 bits. Their representation boundaries must be
resolved explicitly; do not merely enable the decoder or rewrite the retained
image. No synthesis, physical transfer, flashing or saved-artifact changes
were performed.

### Checked reset-to-ActorManager handoff in the core model

The guarded core now has a distinct final-CALL phase. Only aligned, immutable
ROM provenance at byte address 8 with exact `CALL CR0` can issue there. Ordinary
permission, Namespace version/seal, code geometry and stack checks remain
enabled; the historical blanket boot privilege window remains disabled.
Root-frame construction has a separate machine-owned context, not M elevation.
The validated incoming Thread header is retained for CALL/RETURN stack sizing
and advances only on successful Thread activation/change.

Successful normal CALL completion ends ROM execution authority and completes
bootstrap. Failed final CALLs retain their original fault and cannot silently
retry; a fresh reset is required. Post-handoff ROM provenance is rejected before
decoding. Marker retirement records its accepted instruction and position.
Namespace admission remains a hardware admission phase, **not a fabricated
retirement of ROM instruction zero**.

Stronger end-to-end checks exposed an ordinary CALL defect: CR6 was still
rewritten to L-only, concealing missing CR6.M. CALL now preserves its Enter token
and establishes the existing simulator's successful-CALL M boundary: clear
prior M state and set CR6.M only. CR13 descriptor words are untouched; CR12.M
is not granted. A register-file check verifies this with nonzero prior M state
and a reserved-register sentinel, alongside the existing simulator CALL contract.

For retained candidate SHA-256
`866886bca3670f74e9e5ee3726c26302741d3557b2fef40622ffa9e9ee994879`,
the real core model observes these byte-addressed retirements:

| Core byte PC | Word | Observation |
|---|---|---|
| `0x0004` | `0x27000001` | Incoming-only reset marker completes |
| `0x0008` | `0x17000000` | Checked direct-entry CALL CR0 transfers |
| `0x3504` | `0x00000002` | Exact retained first word under selector-zero semantics |
| `0x3508` | `0x07130010` | First authored LOAD commits NS[11]'s capability into CR2 |

No body-PC substitution or instruction translation is used. The test samples
the LOAD result after its commit edge. It verifies CR6 keeps `0x4a000014`,
CR14 has X-only `0x42000014` at byte base `0x3504` with limit 6, M state is
CR6.M only, the canonical poison root frame is unchanged, and Namespace
locations/versions/limits remain unchanged through that LOAD.

Negative core cases inject a wrong application version, bad seal, bad header,
missing E permission and untrusted ROM provenance **after** Thread admission.
They fault before program entry and hold at CALL. A separate case rejects ROM
provenance after successful handoff. Bootstrap/activation, indexed CALL and
the simulator CALL-contract checks passed; guarded Wukong structural
elaboration passed.

Final focused verification: **37 passed** using
`python3 -m pytest tests/hardware/test_guarded_call_handoff.py tests/hardware/test_call_m_boundary.py tests/hardware/test_indexed_call_cr6.py tests/hardware/test_core_thread_activation.py tests/hardware/test_core_reset_marker_gate.py tests/hardware/test_core_namespace_admission.py tests/hardware/test_core_thread_validation.py -q`.
`node tests/simulator/sim_call_cr6_l_perm.js` also passed. Structural elaboration
used `ChurchWukongXC7A100T(sim_mode=True, expected_boot_guard=23971)` and did not
invoke synthesis or connect to a board.

This is **core-model execution evidence**, not full top-level Wukong reset/UART
trace evidence, numbered-method dispatch proof, complete ActorManager/Thread
execution, loader acknowledgement, installed-byte verification or physical
board success. The top-level stock initializer still is not the retained
candidate. No synthesis, upload, flashing or saved-artifact change occurred.

### Full Wukong reset and UART probe — continuation blocked

The full top-level model now accepts an explicitly **simulation-only** complete
image input. Hardware builds reject that input; default factory initialization
and synthesized behavior are unchanged. The retained 16,384 words pass through
the real initializer with preinitialized simulation RAM disabled. No PC,
register, validator or halt-state override is used.

The real top-level RAM ports, ROM provenance, initializer and trace backpressure
reach the same first four retirements and the committed CR2 result documented
above. Extending observation to decode the actual UART TX pin reveals a failure:

- At model cycle 13804 (clock/baud ratio 8), fault code 11 (`INVALID_OP`) asserts.
- Current fetch PC is `0x350c`; the presented instruction is `0x27110000`
  (`CHANGE`). Fault stage is 7, the broad DataRW/Other category. This does **not**
  yet identify the responsible subunit or prove that the fetched instruction
  caused the fault.
- The marker's three trace packets, CALL's three packets, the direct-entry
  word's two packets, and the authored LOAD's shadow packet have arrived.
  The LOAD-new packet is still missing its final byte at fault detection.
- Captured UART bytes at detection:

```text
bc280214
aa0000000403000000000000
aa000000040403a300020000
aa000000040533a300020000
aa00000008064a0000140000
aa0000000807420000140000
aa0000000808000000000000
aa0000350401000000000000
aa0000350402000000000000
aa0000350801000000000000
aa00003508020200000b00
```

The last line is partial, not a complete trace frame. The sentinel is model
output, **not board identification**. The UART probe stops at this failure;
it does not bypass the fault to claim clean execution.

The existing bridge handler also received the exact guarded candidate under
mock serial/network interfaces: its full frame equals `75 00 01 00 00` followed
by all 65,536 bytes converted from little-endian words to big-endian wire words.
A simulated ACK permits the requested `f` restart; an injected write failure
does not send a restart. This tests host framing/order, not actual FPGA receipt
or installed bytes, and is not an end-to-end UART upload into the full model.

Verification:
`python3 -m pytest tests/hardware/test_guarded_wukong_boot.py tests/hardware/test_retained_reload_transport.py -q -rx`
returned **6 passed, 1 expected failure**. The expected failure is narrowly
restricted to this exact continuation fault, with strict unexpected-pass
handling; other failures remain failures. It is an unresolved acceptance
blocker, not a passed program test.

Next: identify the faulting subunit and correct the first cause before declaring
the candidate runnable, preparing hardware programming, or attempting a physical
reload. No hardware commands, synthesis, flashing or saved-layout changes occurred.

### Continuation fault isolated: incompatible CHANGE encoding

Model-only signal observations identify `OrdinaryChange` as the sole asserted
fault source. The fault's latched instruction is `0x27110000`, not an earlier
LOAD. The ordinary-CHANGE entry guard rejects nonzero unused destination bits
before Thread transition work. For the first instruction, destination bits
[22:19] contain 2, source bits [18:15] contain 2, and low bits are zero.

This is the hardware enforcing the approved implicit-CR12 / one-source encoding,
not a reason to relax its guard. Both retained CHANGE words use the older form:

| Fetch byte address | Retained word | Destination | Source | Approved direct encoding |
|---|---|---|---|---|
| `0x350c` | `0x27110000` | 2 | CR2 | `0x27010000` |
| `0x3514` | `0x27198000` | 3 | CR3 | `0x27018000` |

The current assembler was independently invoked with `CHANGE CR2` and
`CHANGE CR3`; it emitted those same retained older words, with no diagnostics.
Thus this is a compiler/ISA alignment issue, not merely corrupt historical
bytes. Simulator success and current assembler round-trip tests do not establish
hardware compatibility.

No instruction bytes were patched, no validation weakened, and no artifact
revision was regenerated. Correcting compilation and producing a separate
immutable ActorManager trial revision requires explicit approval of changed
artifact bytes; the existing saved Namespace and retained candidate remain
untouched. After correction, replay must continue through actual CHANGE; clearing
this encoding check alone will not prove Thread switching or complete execution.

### Approved separate ActorManager compilation

The user approved correcting CHANGE encoding and preparing an isolated trial
revision, without replacing the original image or saved Namespace.
Direct `CHANGE CRn` now emits zero destination/low fields and source CRn.
The simulator consumes that source and rejects reserved CR13. The separately
approved simulator-only indexed form is unchanged. Historical duplicated-field
words remain explicit in disassembly and retain software-only compatibility;
that is not approval for hardware execution.

`scripts/prepare_actor_manager_change_trial.py` retained the new revision in
`reload-evidence/new-layout-change-trial/`, with full-source, compact-source and
API-only compiler outputs, source text and hash-bearing `report.json`.
The primary API-only build is 1,024 bytes (256 words), SHA-256
`77c842aafb8728355e279774931154ce886f90b1825463328431be7271ff7faa`.
Its **entire binary differs from the original only at words 3 and 5**. The
header/allocation, API, dependencies and remaining words are identical.

The retained original contains API only, not original editing text. The new
source is the existing ActorManager example with imports explicitly pinned to
the retained API's `ide.Thread2`/`ide.Thread3` names. It is not falsely described
as recovered original source. Compilation verifies identical API/dependencies
and the exact permitted code differences before writing a new directory.

Focused checks passed:
`node simulator/test_change_canonical_encoding.js`,
`node simulator/test_change_one_gt.js` (40 cases), and
`node simulator/test_change_petname_compile.js`.
The broad `node simulator/assembler_test.js` run stops at line 7256 with
`TypeError: ChurchAssembler is not a constructor`, after 21 earlier CALL/alias
failures. Running it with the original HEAD assembler reproduces the same
21 failures and exception. No broad-suite pass is claimed.

This revision is inert and unpublished: no catalog revision number, signing
or admission claim, destination-localized image, upload or FPGA change.
The original image's expected-failure probe remains unchanged. Next, bind this
exact primary build into a separately retained runtime image and replay it
through CHANGE; neither the new image hash nor hardware compatibility is yet
established.

Validation for this increment: 11 code-loader/configuration checks passed,
including a separate historical-format regression fixture; the six activation
and two reset-marker core checks also passed after integration. Guarded Wukong
structural elaboration passed. These are offline model results, not an installed
image receipt or a complete CALL/boot execution result.

### CALL/mLoad cached-authority boundary aligned

The guarded path now explicitly converts stored ascending authority
(limit17/version9/reserved4/G/F) to the existing internal cache layout
(limit21/version9/G/F). Integrity is checked against original stored words;
the converter neither changes GTs nor writes a converted descriptor to memory.

Namespace admission, incoming Thread/home restoration, derived heap authority,
and shared mLoad now populate that cache representation consistently. The
derived heap retains the admitted Thread version, rather than accidentally
producing a version-zero cache for a nonzero-version Thread.

Guarded mLoad selects bit-17 stored versions, converts resident word addresses
to bytes, preserves MMIO addresses, and checks full descriptor bounds before
publishing results. Namespace bounds cover all four descriptor words, not just
a slot number. An asserted elevation input cannot bypass guarded descriptor
version/seal/table-bounds checks. The ordinary G-bit maintenance write uses the
saved original stored W1, not the converted cache authority.

Focused checks include nonzero Namespace and Thread versions, MMIO, rejected
versions/seals/table bounds with elevation asserted, and a separate historical
format regression fixture. Namespace admission, activation, structural Thread
validation and code-loader checks passed alongside guarded top elaboration.

This completes the checked representation boundary for these producers, not
the full CALL handoff. Final CALL remains held; normal root-frame handling,
reset-ROM fetch retirement, execution tracing, other Namespace consumers and
writeback paths still need end-to-end verification. No physical commands,
synthesis, image upload or saved-artifact changes occurred.

## Remaining integration

1. Replace core hardcoded bootstrap capabilities and ROM sequence using the
   approved reset contract. Wire marker admission to actual immutable-ROM fetch
   and accepted instruction issue, not merely a software-visible address.
2. Reconcile Namespace word locations with internal capability state and all
   memory consumers/writers, including CALL/RETURN, CHANGE/SWITCH, M-window
   writeback and MMIO. Converting a descriptor and then sealing its converted
   value is not valid; the stored canonical words own the seal.
3. Retain all Thread/body/frame validation and ordinary post-handoff fetch
   checks. Remove obsolete broad bootstrap bypasses rather than extending them.
4. Implement retained guard provisioning without deriving trust from whatever
   versions happen to be in the uploaded image. The approved specification
   explicitly still leaves configuration identity, storage and provisioning
   mechanics TBD. The isolated candidate below now has an explicitly approved,
   retained guard; production provisioning is still unimplemented.
5. Align the existing loader with the exact format, then replay the complete
   retained image through upload, reset and expected program execution. A
   metadata-only success cannot substitute for this test.

## Approved isolated guarded candidate

The user subsequently approved preparing a separate guarded hardware candidate.
It is retained at `reload-evidence/new-layout-guarded/`, with guard 23971
(slot versions 46 and 419). The saved design and prior image remain unchanged.
The exact candidate hash, typed-reference patch ledger and deterministic
verification instructions are in that directory's README and evidence files.
This resolves guard selection **for this isolated candidate only**, not the
remaining production provisioning or full-core integration work.

No bitstream has been built; physical reload verification remains pending.

## Corrected CHANGE runtime replay

The separately compiled ActorManager has now been bound into a retained full
image without modifying the baseline. See
`reload-evidence/new-layout-change-runtime/README.md`.
The exact full-top replay gets past INVALID_OP but stops at THREAD_CONTEXT:
ordinary CHANGE reads the incoming Thread header at byte `0x900` instead of
byte `0x2400`, consuming the Namespace's word location without conversion.
The prior LOAD correctly produced a byte-addressed cached CR2, but CHANGE
independently resolves its supplied GT. Align its gate/home-loader profile and
raw-to-cached descriptor conversion; do not change saved placement or weaken
checks. No ordinary CHANGE RTL fix or hardware operation is included in this
replay milestone.

### Ordinary CHANGE address handling corrected

The guarded profile now propagates into ordinary CHANGE's gate/home loader.
Stored seals and versions remain checked before byte-address/cache conversion,
and direct resident resolutions retain bounds checks. Legacy mode is unchanged.
The same retained image now reaches the correct Thread and AmoebaStartup headers,
but stops at the entry continuation range check: saved NIA 1 is interpreted as
absolute byte 4, outside AmoebaStartup code. See `address-correction-result.json`
in the trial directory. The next step is to reconcile the continuation contract,
not to relax this check, mutate the saved design or upload the failing image.
