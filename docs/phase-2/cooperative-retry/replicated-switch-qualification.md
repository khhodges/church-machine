# Replicated resident handoff: local component qualification

## Status

The native two-Namespace handoff component works. **The full candidate is not
complete and these diagnostic inputs must not be published or installed.**
The saved Namespace drafts have not been bound to these diagnostic LUMPs.

The replay uses separate physical Amoeba and regulator bodies, distinct
Namespace generations, independent local C-lists and a separate AppSystem.
Each regulator's fixed C-list row names its next Namespace. The corresponding
Namespace GT is also retained in the local Amoeba C-list. There is no shared
instruction-body mechanism or change to the ISA.

## Implemented and exercised

- Explicit candidate M-control recipients are derived from exact image bytes.
  Recipient checks include Namespace base, extent and generation, and the
  executable GT, base, extent and generation. No configured recipient means
  no candidate M-control access. Historical configurations retain their
  existing gate when the candidate option is omitted.
- Ordinary native CALL enters the local regulator. Only that executable has
  the M-device grant in this diagnostic. Its DWRITE enables the existing
  CR15/CR6 M access, then SWITCH selects its local C-list row.
- SWITCH captures CR6's M-enabled read view without modifying the stored E GT.
  Other source CRs still require L; neither later M changes nor a different
  source register gain this access.
- The private candidate assembler now emits literal SWITCH rows using the
  existing compact DR0-plus-magnitude encoding. The earlier raw-literal
  encoding only worked accidentally for row zero.
- Native execution observes Boot → Application → Boot → Application → Boot.
  The application USER requests an absent target. Native Amoeba copies the
  verified delivery body and publishes the header last; the USER resumes,
  calls the target and returns normally.
- Removing the configured recipients produces PERM_S before switching or
  publishing any target code.

Both diagnostic SYSTEM entries use generation zero. Their frozen reset guard
was configured accordingly, rather than deriving a new expected version at
runtime or weakening the incoming Thread checks.

## Verification

```sh
python -m pytest \
  docs/phase-2/cooperative-retry/test_candidate_amoeba.py \
  docs/phase-2/cooperative-retry/test_candidate_m_control.py \
  docs/phase-2/cooperative-retry/test_candidate_switch_capacity.py \
  docs/phase-2/cooperative-retry/test_candidate_switch_compile.py -q
```

Result: **25 passed**. These include ordinary loading, corrupt delivery,
replicated handoff, missing M authorization, image-hash mismatch, identity
mismatches, source-M capture, memory bounds, nonzero literal rows, and
historical compiler-form isolation.

## Not established by this test

- Final regulator invocation and audit interface. The diagnostic SwitchM
  method is not a production security service. Follow the current regulator
  review: held authority expresses trust, and no historical Passkey/proof
  scheme or caller-purpose policy may be silently imported.
- Lazy AppSystem startup: AppSystem is deliberately preloaded in this
  component fixture to isolate switching and USER lazy delivery.
- Fresh Mallory retirement/reinitialization, software generation advancement,
  stale-GT rejection across 100 attempts and Alice progress between attempts.
- Exact selected-artifact binding through the saved-design linker, final
  disjoint physical placement, or complete image capacity.
- A physical build, synthesis, upload, activation or hardware acceptance.

The fixture's compiled instruction words execute directly in the maintained
RTL model. Its local C-list binding and prepared Thread homes are diagnostic
construction, not evidence of a completed saved-artifact admission pipeline.

## Fail-closed audit intent

The configurator selected **Hard Fault on delivery failure**, not local
queue-and-proceed behavior. The local regulator now submits an audit intent
and waits for its receipt before writing M or executing SWITCH. The wait is
bounded. An explicit rejection, missing receipt or stale receipt leads to
Hard Fault with no privileged effect; a late receipt cannot revive failure.

The isolated Home-IDE receiver commits intent records to SQLite with FULL
synchronous writes before returning their sequence as a receipt. An exact
duplicate is idempotent; a conflicting sequence replay and storage failure
cannot produce a receipt. Records identify the fixed image/session,
Namespace, Thread, executing regulator and switch intent. These fields do
not invent or replace the final Passcode audit identity.

The native replay uses this real local receiver through testbench transport
signals. **A production relay and authenticated acknowledgement channel are
not wired or qualified by this work.** This is also not complete outcome
auditing: the intent must never be displayed as successful execution.

Audit verification command:

```sh
python -m pytest \
  docs/phase-2/cooperative-retry/test_candidate_audit.py \
  docs/phase-2/cooperative-retry/test_candidate_service.py \
  docs/phase-2/cooperative-retry/test_candidate_amoeba.py -q
```

Result: **15 passed**, including native missing/rejected/stale-receipt
Hard Faults before M/SWITCH, successful acknowledged round trips, durable
receipt/idempotency checks, and unchanged delivery-service behavior.
