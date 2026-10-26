# New Layout — corrected CHANGE runtime trial

**2026-10-24: first CHANGE/CALL/RETURN path now passes offline. Complete program
execution and physical reload remain pending; not ready for hardware upload.**

This is a separate 65,536-byte little-endian runtime image:

`53ac2da9f51b27aad253cc1c9f1335e6c340506f3cec9db2bbef2f10b1ae7017`

The parent guarded image remains unchanged:

`866886bca3670f74e9e5ee3726c26302741d3557b2fef40622ffa9e9ee994879`

The entire freshly compiled API-only ActorManager is localized through the
existing symbolic binder against the exact retained assignments, then inserted
as a complete LUMP. The original binding is independently reproduced first.
Prepared Thread display names (`Thread.2`, `Thread.3`) are reconciled using the
retained binding report's canonical names (`ide.Thread2`, `ide.Thread3`), not
guessed aliases. All capability words remain identical.

Only image words 3395 and 3397 differ from the parent. Namespace assignments,
descriptor seals, boot guard 23971, versions 46/419, allocation, entry Thread
state and entry program remain unchanged. The ascending image codec deliberately
emits zero cache words; no canonical token is invented in the Namespace table.
The new artifact hash/token and localized C-list hash are recorded separately
in `evidence.json`. This is not a signed catalog admission or installation.

## Observed result

`full-top-result.json` records a real full `ChurchWukongXC7A100T` Amaranth replay
using the retained image initializer (not patched model memory). Clock and UART
divisors are simulation settings, not physical-board timing evidence.

- Reset marker, CALL, ActorManager entry and LOAD CR2 retire.
- CR2 contains Thread.2 GT `0x0200000b` with correctly cached byte base `0x2400`.
- The next fetched instruction is corrected `CHANGE CR2`, `0x27010000`, at
  byte `0x350c`. It no longer faults INVALID_OP.
- At model cycle 13819 it faults **THREAD_CONTEXT (29)**, stage 7, originating
  in ordinary CHANGE. CHANGE does not retire; Thread.2 does not execute.
- NS[11] stores word location 2304 (`0x900`); its true byte address is `0x2400`.
  The memory signals show CHANGE reading byte `0x900`, obtaining `0xaf084008`,
  rather than the real Thread header `0xf900820c` at byte `0x2400`.
- Source inspection confirms ordinary CHANGE passes `gate.raw_base` straight
  into the cached Thread location and uses it as a byte address. It constructs
  its own Namespace gate/home loader with legacy defaults, unlike the
  profile-aware LOAD path. Keep integrity/version checks; do not repair this by
  changing the image's ascending layout or relaxing Thread validation.

The memory signal log includes normal preceding CALL/LOAD writes; the recorded
write to NS[11] authority writes the existing value 255, not a different layout.
The image file itself is never mutated by replay.

## Reproduction

From the repository root:

```sh
python3 scripts/prepare_actor_manager_runtime_trial.py /tmp/new-layout-change-runtime-new
python3 scripts/probe_actor_manager_runtime_trial.py /tmp/new-layout-change-observation-new.json
python3 -m pytest tests/hardware/test_actor_manager_runtime_trial.py -q
```

Use fresh output paths: existing evidence is never overwritten. Historical failed
probes exited **1** and retained diagnostics. The current probe exits **0** after
the first incoming instruction; add `--through-return` to check CALL, RETURN and
actual caller resumption. The full-top pytest case now requires that longer
path to pass. Historical failures remain separately checked as retained evidence.

Next: align ordinary CHANGE's Namespace descriptor decoding/address conversion
with the existing ascending profile, then replay this exact image again.

## Address-conversion correction and second observation

The guarded core now explicitly passes the ascending profile into ordinary
CHANGE. Its Namespace gate checks the stored 17-bit-limit/9-bit-version layout
with seals enabled; only afterward are word locations and authority converted
to internal cached form. Its home loader receives the same profile. Direct
Thread/code resolutions reject non-resident addresses and out-of-RAM extents.
The default legacy profile is unchanged.

`address-correction-result.json` records a second full-top replay of **the same
image hash above**, not a modified image:

- Thread header read at byte `0x2400`: `0xf900820c`, as intended.
- Protected continuation read at byte `0x27c4`: `0x000030f1` (NIA field 1).
- Entry E-GT resolves AmoebaStartup, whose header is read at byte `0x3900`:
  `0xf8801c02`, as intended.
- At cycle 13842 the first CHANGE still fails THREAD_CONTEXT, without retiring
  or activating Thread.2. The entry-range check treats NIA 1 as absolute byte 4,
  outside the entry's code starting at byte `0x3904`.

Thus the address-conversion blocker is resolved in source/model, but the
continuation representation is the next blocker. Establish the authoritative
continuation contract before changing either RTL or the isolated hardware
projection. Do not weaken the entry-range check or silently rewrite saved
Thread state. The generic `evidence.json` remains the immutable preparation
record; these dated observations supersede its pending-replay status.

Focused checks: 18 new nonzero-generation cases exercise successful descriptor
conversion, stale versions, corrupt seals, free entries and invalid extents;
three retained-evidence checks pass. The 36 existing boot CHANGE tests also
pass. The H08 fixture had still supplied the retired nonzero destination field:
it now uses the canonical zero field for its context tests and separately checks
that the old destination is rejected. At this stage the expected failure matched
only the continuation mismatch. Both historical observations remain retained.

## Approved relative NIA and successful caller resumption

The user chose program-relative saved NIA on 2026-10-24. The active Master now
records that decision. CALL receives a caller-relative word offset; RETURN
validates the saved offset against the resolved executable header before popping
and derives the physical address from its code base. CHANGE saves/restores the
same coordinate, including the scheduler path. The existing single-word LAMBDA
frame writer/reader were aligned with this coordinate without changing their
authority policy.

Two integration issues surfaced and were corrected without changing image bytes:
the home loader's ascending Namespace bound was being divided twice, and the
core sampled the previous registered Thread header on CHANGE completion. Header
publication now supplies the admitted header on the success edge, never during
speculative admission.

Evidence remains chronological:

- `relative-nia-result.json`: continuation check passed, home restoration failed
  before correcting the double division.
- `relative-nia-home-result.json`: first CHANGE and first incoming instruction
  retired. Outgoing frame write at byte `0x7c4` contains `0x70f1`, saved NIA 3.
- `relative-nia-return-result.json`: longer replay found STACK_CORRUPT on CALL
  before correcting the Thread-header publication edge.
- `relative-nia-return-header-result.json`: first CHANGE, AmoebaStartup CALL to
  Alice, Alice RETURN and actual caller instruction at byte `0x3910` all retire.
  The probe exits 0 at model cycle 26778.

The retained image hash remains unchanged. Focused RETURN/mask checks pass
(79 cases), including relocation and out-of-range rejection before frame writes.
Five legacy `tests/gates/test_call_stack_push.py` cases still fail; the same five
failures were reproduced with the unchanged HEAD CALL module. Those fixtures
contain old invalid header inputs. No broad-suite or complete-program pass is
claimed.

The next instruction at `0x3914` is AmoebaStartup's old `0x27110000` CHANGE
encoding, with the forbidden nonzero destination field. It has not been rewritten.
A separately approved corrected AmoebaStartup trial revision is needed to
continue the complete program. No installed-board claim follows from this model.

**No board commands were sent or queued. No synthesis, flashing, UART transfer,
installed-byte readback or physical execution verification occurred.**
The saved New Layout and original LUMPs remain unchanged. Physical testing stays
pending; this package does not authorize uploading or overwriting runtime RAM.
