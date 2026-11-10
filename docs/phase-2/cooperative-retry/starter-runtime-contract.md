# Starter runtime contract — initial implementation boundary

Status: reset/load/validate/start approved by the user on 10 November 2026.
Genesis subsequently approved the bounded physical maintenance-enable and
fixed-image-allowlist mechanism described below. Local full-top acceptance
passed; this is not vendor-build or physical acceptance.

## Preserved requirements

- One new isolated starter configuration must support both application images.
- Never program, stop or replace the preserved working system incidentally.
- Lazy delivery must validate the complete supported LUMP and its authorized
  expected identity, bounds and destination before publication.
- Receipt, validation, publication and original CALL completion are distinct
  observations. A CRC alone does not authenticate executable content.
- Side-by-side revisions have separate allocations and may differ in size.
  Old authority and active continuations retain their old meaning.
- New callers adopt new authority explicitly; no silent retargeting of old GTs.
- Reserve bounded disjoint staging/allocation space for the first demonstration.
  Reject insufficient space; do not add GC or live-state migration to make it fit.
- Reuse the current compiler and capability contracts. No new GT format.
- Every failed delivery/adoption leaves the old published revision unchanged.

## Concrete preflight findings

### Local revision-adoption demonstration

[Revision adoption](revision-adoption.md) provides a runnable isolated
compiler/simulator proof of disjoint different-size allocations, explicit
new-caller selection, protected old continuations and fail-closed rejection.
It uses neither this lifecycle controller nor whole-image reset for adoption.
Its host-owned compiler approvals and synchronous publication are local harness
boundaries, not a replacement for the shared RTL/transport admission contract.
Full-top and physical qualification remain unclaimed.

The current isolated candidate inherits diagnostic UART routing that disables
the ordinary command parser while the diagnostic receiver is enabled.
Therefore its normal STOP/upload commands cannot simply be combined with the
diagnostic profile unchanged.

The fixed watchdog starts at boot completion, is renewed by successful
CHANGE/SWITCH completion, and continues counting on the ungated clock.
A fresh execution-start pulse does not clear an expired watchdog.

The existing native application image is 65,536 bytes. At 57,600 baud, 8N1,
data alone needs:

```text
65536 bytes × 10 bits / 57600 bits per second = 11.377777… seconds
```

That excludes framing, host pauses and acknowledgements. A one-second watchdog
cannot remain active and unrenewed through this stopped transfer.

These observations establish an integration conflict, not a fault observed
on a physical board. The preflight uses an actual timer RTL simulation,
arithmetic transfer bounds and source-level checks of the isolated candidate.
It does not yet exercise a UART STOP command through the complete top.

Preflight run on 10 November 2026:

```sh
python3 -m pytest docs/phase-2/cooperative-retry/test_starter_upload_preflight.py -q
```

Result: **3 passed**. These checks characterize the current obstacle; they do
not mean the new loader or starter has passed acceptance.

## Approved image replacement execution boundary

### Selected: explicit reset/load/start lifecycle

On the separately authorized experimental target only, enter a dedicated
hardware-controlled image-replacement state. Stop application execution and
hold its execution domain in reset while receiving and validating a complete
image. Start a fresh execution/watchdog epoch only after successful admission.
The watchdog remains mandatory whenever application execution is active.

This is an explicit new control boundary, not an implicit timer exemption,
software watchdog kick or automatic fault recovery. Authorization, routing,
reset scope, partial-transfer handling and startup must be tested before
hardware qualification. On failed/partial upload, remain non-executing; do not
promise restoration of overwritten application memory.

This is not proposed for individual LUMP upgrades: those remain side by side
with continued execution and ordinary watchdog renewal.

### Not selected for this release: SYSTEM remains executing during replacement

SYSTEM receives/stages the next image while continuing genuine transitions and
watchdog renewals. It must execute from protected memory outside all replacement
writes, preserve live contexts, and perform a separately defined final handoff.
The current whole-memory uploader does not supply those guarantees.

This requires additional memory/lifetime and handoff machinery. It may be a
better long-term architecture, but is not the smallest change for a four-week
bounded demonstration.

## Acceptance tests to implement after the decision

1. Both diagnostic delivery and image-control traffic route without ambiguous
   interpretation or unauthorized writes.
2. Partial, malformed or wrong-identity image never becomes executable.
3. No application instruction or program write commits during a declared
   reset/loading state, if that model is selected.
4. An accepted image starts with verified entry state and a fresh watchdog epoch.
5. A non-yielding program still expires; no load command can silently renew or
   exempt an executing program.
6. Lazy delivery and side-by-side upgrades retain execution, old references and
   normal watchdog behavior throughout their respective publication boundaries.

## Implemented control boundary

`starter_lifecycle.py` implements held, loading, verifying, ready, running and
failed states. A new authorized BEGIN increments the non-wrapping transaction
epoch and immediately denies program writes. Data must arrive in contiguous
word-index order, within the configured image size. FINISH is a separate beat
after all words; extra, reordered or incomplete data cannot reach READY.

Validation must name the current epoch. START requires both authorization and
the same epoch, after successful validation. Abort/bad-data takes precedence
over START. An exhausted epoch counter refuses a new BEGIN rather than wrapping.
There is no automatic retry, recovery or startup after failed admission.

The trusted decoder must serialize sessions; raw UART input must not directly
drive authorization or validation-success signals. The verifier must check
the received memory, expected identity and entry state for that epoch, not
trust a host-supplied PASS. The module itself is neither that verifier nor
an authentication mechanism.

`test_starter_lifecycle.py` connects the controller to a separate execution
clock/reset domain with the actual fixed-watchdog RTL. The controller lives
outside its own reset domain to avoid reset self-deadlock. A test counter
stands in for program commits; this is not yet a ChurchCore integration test.

Verified locally: long loading beyond the UART transfer lower bound, execution
held throughout loading/validation, restart with a fresh timer after an expired
epoch, continued watchdog expiry for a non-yielding run, invalid/short/extra/
reordered data, stale validation and start epochs, unauthorized control,
and abort precedence. The source-level preflight remains a characterization of
the old isolated top, not a claim that its UART routing conflict is fixed.

The original next integration gates were the protected command decoder, received-memory
verifier, memory-port arbitration, boot initialization, and complete-top
execution/reset behavior. No bitstream or board operation has been performed.

Local verification on 10 November 2026:

```sh
python3 -m pytest \
  docs/phase-2/cooperative-retry/test_starter_lifecycle.py \
  docs/phase-2/cooperative-retry/test_starter_upload_preflight.py \
  docs/phase-2/cooperative-retry/test_fixed_watchdog.py -q
```

Result: **24 passed**. This includes the full 16,384-word transfer geometry,
but not actual UART bytes, executable content verification or ChurchCore
startup. Validation-success inputs in these tests are controlled test stimuli,
not evidence of a completed cryptographic validator.

## Isolated full-top implementation

`prepare_starter.py` checks every retained candidate file against the pinned
historical parent plus reproducible watchdog edits. It copies that candidate
to a **fresh** ignored directory and adds the starter modules. Existing sources,
historical packages, saved designs, and board state are not modified.

`starter_top.py` uses the retained real ChurchCore (including its fixed watchdog),
reset ROM, UART blocks, packet arbiter and diagnostic receiver. It is a new
bounded diagnostic top, **not** a change to the production Wukong top. The legacy
debug/reboot/upload parser, startup RAM initializer, trace backpressure and
automatic recovery are not instantiated. There is no default application boot:
RAM starts unavailable for execution until an admitted upload is explicitly started.

### Approved authority and exact image identities

Genesis authorizes image selection and replacement. A synchronized physical
maintenance-enable input gates all lifecycle commands; it is not writable by
UART or application MMIO. This trusts the operator while maintenance is enabled;
it does **not** authenticate a remote sender. Pin assignment is still a separate
physical-integration operation.

The protected build-time SHA-256 allowlist is:

| Selector | Retained application | SHA-256 of all 65,536 little-endian bytes |
|---|---|---|
| 0 | All Waiting | `925fe029a47c8abc80c91ab7df80334d8015cae74fd116f41560174e6478e6d7` |
| 1 | USER B | `c55a7e0158fd2402cc492d43d58c7f376a12edc6ef2eb3c4a9508499d7b6d480` |

These are retained cooperative diagnostic application images, not a claim that
newer IDE-saved designs have the same bytes. No sender-provided digest, PASS,
CRC, filename or selector alone can admit an image. The SHA-256 RTL reads back
the actual written RAM while all writers are disabled, then compares against
the selected protected identity for the captured epoch. Exact equality pins all
entry bytes; real ChurchCore guarded boot additionally checks Namespace/Thread
entry state with the retained boot guard `(46 << 9) | 419`.

### UART ownership and framing

Maintenance enabled: RX belongs exclusively to the image-control parser.
Maintenance disabled: RX reaches the inherited diagnostic receiver only while
RUNNING. Diagnostic traffic can never be interpreted as a replacement command.
An operator must not change input ownership in the middle of a diagnostic frame.
BEGIN resets diagnostic execution state; any old in-flight observation packet
is abandoned (an already transmitting byte finishes). Loader status frames and
diagnostic packets otherwise share non-preemptive TX arbitration.

The 16-byte control header is `CSI1`, operation byte, selector byte, two zero
reserved bytes, 32-bit big-endian epoch, 32-bit big-endian byte length.

- BEGIN=1 requires maintenance, current epoch, selector 0/1 and length 65536.
  It increments the non-wrapping epoch and consumes exactly 65,536 raw
  little-endian image bytes. A stale BEGIN never stops a running application.
- FINISH=2, START=3 and ABORT=4 require zero length, the selected image and the
  new epoch. FINISH is separate from payload receipt; START requires READY.
- Missing bytes, invalid UART framing, or loss of maintenance during replacement
  leave execution held. An incomplete header/data stream times out after two
  seconds without a byte. A completed transfer without FINISH remains held.
- Payload is never scanned for command magic. A premature command is payload,
  not an escape from the declared transfer. Extra malformed control bytes fail
  an active transaction; stale complete controls cannot start it.
- Status is an eight-byte frozen frame: `CS`, state byte, selector byte, epoch
  big-endian. States are HELD=0, LOADING=1, VERIFYING=2, READY=3, RUNNING=4,
  FAILED=5. Status reports state changes; they are not admission inputs.

### Memory and execution domains

The controller, UART, status and SHA verifier run outside the execution reset
domain. ChurchCore and its watchdog, diagnostic receiver and boot sequencing
share the separately reset execution domain. This is a true reset, not a timer
pause or renewal. On START, a one-shot real boot request begins a fresh watchdog
epoch through the retained core's normal boot-completion signal.

RAM has one write port: lifecycle writes while loading, otherwise ordinary
Namespace > C-list > data writes while running, additionally gated by watchdog
containment. The verifier and observer have read-only ports. No initializer
rewrites received bytes on START. Failed or partial uploads do not promise
restoration of overwritten RAM. Watchdog fault remains latched; START or
unauthorized control cannot recover it. Only an explicit authorized replacement
transaction followed by successful admission and START can begin another epoch.

### Local acceptance entry point and scope

This is a **script-only** RTL suite, not a release-suite registry change:

```sh
python3 docs/phase-2/cooperative-retry/run_starter_tests.py \
  --output generated-artifacts/starter-runtime-NEW
```

The directory must not exist. It retains a hashed source/application manifest
and test report. The suite sends UART bits through the complete top, uses actual
received-memory SHA-256, and runs both applications sequentially in one
elaboration. The scaled UART transfer is longer than both the one-second timer
and the 57,600-baud physical lower bound. No lifecycle validation-success stimulus
is used for these admission tests.

The watchdog negative uses a **test-only** allowlist containing an exact
branch-to-self image. It is received and hashed normally; it neither changes the
two-image starter allowlist nor authorizes that image on a board.

The inherited five-word lazy-delivery diagnostic is retained only to prove
traffic routing and actual CALL continuation for these images. This work does
not turn it into the complete-LUMP publication/adoption implementation, prove
the other two release demonstrations, or integrate a separately developed
adoption top. Those remain distinct release gates. No vendor synthesis, timing
claim, pin selection, transfer, programming, publication or working-board
operation is part of this implementation.

### Verification record — 10 November 2026

25 distinct local checks passed across focused runs: 14 lifecycle checks,
3 independent hashlib comparisons, 2 derivation checks and 6 complete-top cases.
The complete-top cases cover both images in the same elaboration, actual
non-yielding watchdog expiry followed by an authorized full reload and fresh
execution epoch, partial/unauthorized/malformed controls, wrong image identity,
altered entry bytes and excess upload data.

Evidence is retained under `generated-artifacts/`: `starter-two-images-02.xml`,
`starter-watchdog-02.xml`, `starter-rejections-01.xml`, and
`starter-excess-01.xml`. The final source snapshot is
`starter-runtime-integration-02/starter-source-manifest.json`.
Negative image cases preceded an observation-only correction from CALL to
callee RETURN as the diagnostic terminal event; their admission path was
unchanged. Both-image execution and watchdog restart passed with the corrected
top. Result checks capture DR12 at RETURN, not after another Thread takes over.
Reset checks distinguish fault telemetry from instruction commits and respect
synchronous reset priority at the BEGIN acceptance edge.

Local RTLIL elaboration also succeeded; no vendor tools or board were used.
The suite reports Amaranth 0.5 domain-propagation deprecation warnings; these
are not a claim of compatibility with a future Amaranth version.
