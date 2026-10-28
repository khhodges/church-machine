# Candidate reaches the intended denial; restart blocked

**Historical blocked observation.** See the appended resolution for the
subsequent approved correction and successful bounded simulator run.

The user selected the inspected AmoebaStartup baseline for this integration.
The offline candidate modules do not modify any selected artifact, Namespace
document, Boot.Thread, runtime fault semantics, installed image or hardware.
They are not loaded by the IDE.

## Reproduction

`python3 scripts/check_attack_progress_boundary.py`

This authenticates and stages the existing saved inputs, then compiles separate
candidate sources and binds their destinations before execution. The baseline
hash is pinned; a changed baseline fails explicitly. Temporary bytes are removed
on exit. No publication helper, host PC skip, fault-code substitution or
post-fault memory write is used.

The sources preserve the four actor roles, SelfTest calls, capability tests and
the three existing Threads. CapabilityTest performs complete actor turns before
CHANGE. Worker startup entry NIAs select distinct methods using the existing
fresh prepared-Thread contract. No new scheduler or Thread is added.
Boot.Thread's 256 initial words remain byte-for-byte unchanged.

Alice's initial unsigned 32-bit word is 41, initialized in the fresh compiled
image, not by an executable initialization routine. AliceDriver checks its
separately retained expected value before Stash, increments, calls Reveal and
checks read-back before advancing that expectation. WCH receives only the
numeric DR1 sample and retains it in its own diagnostic storage.

Planned acceptance budget: at least three denials, at most six actual Alice
updates and 20,000 instructions; 41 + 6 is below UINT32_MAX. That gate has
**not** passed. The diagnostic stops at the first denial.

## Measured diagnostic

Candidate image SHA-256 (little-endian Namespace bytes):
`a1d0e72a82844efb65ce47dc9911cec651952694e8d8c31d823190ef178e96dd`.
The diagnostic prints the exact source and localized binary hashes for each
candidate. These localized test bytes are not canonical signed release LUMPs.
The unchanged saved Mallory and SelfTest come from the pinned baseline.

Actual captured UART TX bytes:

```text
CM:WUKONG Alice=unavailable HF=none\r\n
CM:WUKONG Alice=42 HF=none\r\n
CM:WUKONG Alice=42 HF=none\r\n
```

There was exactly one protected-value change, 41 → 42, in Thread.2. Its update
did not interleave with another Thread. The repeated sample is real, not an
increment triggered by output. The diagnostic device model makes UART STATUS
busy for two reads after every byte; output remains exact and polling completes.

Mallory's unmodified `LOAD CR1, CR6, #2`, raw word `0x070b0020`, faults at
logical PC 1 in Thread slot 12. Row 2 is absent from its two-row C-list. This
is denied authority acquisition, **not a rejected DREAD**. Alice and the saved
Thread.2 body remain unchanged at this denial.

## Specific conflict requiring review

The simulator's `NO_CAPABILITY` classification has `faultCode: null`.
`BootFaultEntry.enter` requires an approved numeric machine fault code and
therefore stops with:

```text
Fault has no approved numeric machine code
```

The fault-entry state is catastrophic; outgoing-save attempts and fault-path
writes are both zero. No restart or subsequent scheduling happened. Assigning
an arbitrary code, changing the attack, bypassing the check, or forcing a
continuation would invalidate the intended evidence.

Review the **specific missing-C-list-row LOAD classification**, not a blanket
mapping of every `NO_CAPABILITY` occurrence (the same label is used for private
Bank custody). Hardware LOAD delegates to mLoad, whose indexed bounds check
uses the inclusive limit. Establish the exact approved hardware classification
for this instruction before any simulator correction; do not change protection,
hardware versions, or the existing Boot-entry mechanism.

## Timestamp boundary and remaining work

The inert source candidate defines numeric Sample and Fault methods for WCH.
Before a known event it emits `HF=none`; after notification it is intended to
retain `HF=unavailable`, because no board clock is available. That post-fault
path has **not executed** and is not accepted evidence. It does not manufacture
event time or present host receipt time as board time. Actual date/time would
require the separately reviewed clock/interface decision.

After resolving the classification conflict, repeat the complete bounded
scenario, including subsequent Alice reads, exact emitted lines, repeated
denials, retained other-Thread state and fault-field behavior. Admission,
explicit live review, RTL replay, synthesis and physical-board acceptance
remain separate. This report authorizes none of them.

## Approved resolution and bounded simulator acceptance

The user approved verifying and correcting this specific classification.
Hardware `ChurchMLoad` checks indexed access against an inclusive limit and
returns `FaultType.BOUNDS` (8). The dedicated RTL-model regression supplies
CR6.M's L authorization, limit 1, index 2 and verifies BOUNDS before a CR write.
The simulator now classifies the same LOAD failure as BOUNDS. The unrelated
software-only NO_CAPABILITY cases and Boot fault-entry implementation are
unchanged.

The same candidate image hash above was replayed with UART busy polling:

```text
CM:WUKONG Alice=unavailable HF=none
CM:WUKONG Alice=42 HF=none
CM:WUKONG Alice=42 HF=none
CM:WUKONG Alice=42 HF=unavailable
CM:WUKONG Alice=43 HF=unavailable
CM:WUKONG Alice=43 HF=unavailable
CM:WUKONG Alice=44 HF=unavailable
CM:WUKONG Alice=44 HF=unavailable
CM:WUKONG Alice=45 HF=unavailable
```

Each line ends in exact CRLF. Four commits (41→42→43→44→45), four Mallory
denials, and four successful existing fault-to-Boot transitions occurred
within the preselected 20,000-instruction / six-update budget. Each denial
still occurs at Mallory LOAD PC 1, word 0x070B0020, in Thread slot 12.
Rescheduling restores the saved **faulting LOAD**, not useful Mallory work
after it; DREAD and the driver HALT are not executed. Boot and Alice perform
ordinary checks/call-home work between denials. No host instruction skips or
state replacement occur.

Alice's initial/pre-write and post-write reads are exactly
41,42,42,43,43,44,44,45. The test verifies one complete update in Thread.2
without interleaving, unchanged Thread.2 saved state across each fault entry,
and no reinitialization. A separate fresh negative fixture with mismatching
Alice data halts before Stash and leaves the mismatching data untouched.
The UART model records 606 busy reads across the exact 303 emitted bytes.

HF=unavailable is the truthful retained last-event status: a fault is known,
but its event date/time is unavailable. It is neither a fabricated clock nor
host receipt time. Repeated events refresh that status through the ordinary
Boot handler and WCH numeric diagnostic ABI; none is claimed to carry a
distinguishable wall-clock timestamp. No new clock or host-to-board interface
was introduced. Full incident evidence remains in the separate fault records.

This is isolated exact-image **simulator** evidence plus a focused mLoad RTL
classification test, not full-image RTL, synthesis or physical FPGA acceptance.
The candidate source factory, offline builder, hash-pinned baseline and
printed binding/source hashes are the inputs for subsequent review.
Live adoption still requires the existing explicit compilation/save/binding
review path; these private localized bytes must not be directly uploaded.

Use `python3 scripts/check_attack_progress_boundary.py --export` to materialize
the resolved CLOOMC sources, exact little-endian simulator candidate and JSON
evidence under `generated-artifacts/attack-progress-review/`. That directory is
excluded from Git and deployment. Sources can be reviewed/compiled through the
normal IDE path; the simulator-only binary is not an upload artifact.

Regression checks passed: the bounded scenario with negative continuity
fixture; hardware absent-row bounds test; call-home parser (78 cases);
Mallory Thread fault, actor LUMPs, ascending actor lab, lab UI, LOAD decode,
compile audit, Mint/PkVerify call, and Boot fault-entry tests.

One unrelated pre-existing check still fails:
`node simulator/test_boot_fault_register_context.js` expects the short CALL
message instead of the existing contextual prefix. Replaying that check with
the unmodified HEAD simulator produces the same failure; this change does not
alter CALL fault messages.
