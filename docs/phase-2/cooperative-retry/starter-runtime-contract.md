# Starter runtime contract — initial implementation boundary

Status: reset/load/validate/start approved by the user on 10 November 2026.
An isolated control block and reset-domain tests are implemented; full-top
UART/validator/core integration is not yet qualified.

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

Next integration gates are the protected command decoder, received-memory
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
