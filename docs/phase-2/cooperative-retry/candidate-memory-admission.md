# Candidate stage 1: checked RAM and stopped image admission

Local implementation only. No synthesis, board operation, saved LUMP change,
live Namespace change or installed-image replacement.

## Integration boundary

`CandidateAdmission` composes real banked RAM, `StarterTransport`,
`StarterLifecycle` and `ReceivedImageSHA256`. It accepts decoded UART bytes.
It deliberately does **not** instantiate ChurchCore, physical UART pins,
Namespace-aware Amoeba delivery, Boot fault bindings or a software scheduler.
The checked core-facing ports are explicit integration seams, not substitutes
for executing native programs. This is not a runnable FPGA top.

The existing `StarterTop` still implements the historical 64 KiB profile.
Connecting these new ports and mapping errors into the real core belongs to
the next reviewed integration stage. Unconnected new behavior is not claimed
as active in existing hardware.

## Memory contract

| Physical byte range | Contents | Access |
| --- | --- | --- |
| `[0x00000, 0x10000)` | Allocation bank 0 | Checked core ports or stopped image writer |
| `[0x10000, 0x20000)` | Allocation bank 1 | Same; not automatically a separate Namespace |
| `[0x20000, 0x24000)` | Isolated staging | Maintenance scrub / explicitly enabled receiver; read-only internal inspection |

The 64/64/16 KiB banks each have three synchronous read channels and a shared
broadcast-write arrangement. This describes RTL geometry, not measured BRAM
mapping or new timing evidence.

Namespace, C-list and data requests share one channel, with that priority.
Fetch and internal inspection have separate channels. One physical write is
accepted at a time: stopped image, staging scrub, CPU, then receiver.
Maintenance excludes CPU/receiver access. A CPU read does not block a staging
write. Fetch is allocation-only; inspection is read-only and can see staging.

Addresses are full 32-bit byte addresses. Check range/alignment and operation
before bank selection is enabled. Rejected accesses return explicit errors
without a write commit. Read responses arrive one cycle after acceptance,
with bank selection and request ownership latched. High-address and MMIO
values are rejected, not reduced modulo RAM size. Future MMIO routing must
remain separate; this foundation implements no peripheral register device.

These controls enforce the physical bus aperture, not GT permissions or
Namespace authority. The core remains responsible for its normal checks.

## CSI3 profile

The new mode requires `general_image=True, combined_image=True`.
CSI1 and CSI2 retain their original 65,536-byte profiles. Each mode rejects
other profile magics rather than interpreting them with a different size.

CSI3 uses a 16-byte header:

| Bytes | Meaning |
| --- | --- |
| 0–3 | ASCII `CSI3` |
| 4 | BEGIN=1, FINISH=2, START=3, ABORT=4 |
| 5–7 | Zero |
| 8–11 | Big-endian u32 epoch |
| 12–15 | Big-endian length: 131,072 for BEGIN, zero for other operations |

BEGIN names the current epoch and advances it without wrapping. It is followed
by 32 SHA-256 digest bytes, then exactly 131,072 image bytes. Image RAM words
are little endian. FINISH and START name the new epoch. FINISH starts hashing
actual received allocation RAM, not received-stream assertions. SHA includes
both banks and the last word; staging is excluded.

BEGIN invalidates previous admission and execution, restarts staging scrubbing,
and resets transfer state. The single writer gives image words precedence over
scrub words; scrub uses other available stopped cycles. START is gated on
successful validation and complete staging initialization. The runtime receiver
is disabled in this stage, so there are no fabricated pending LUMP requests.

Physical maintenance authorization is an input from the eventual board wrapper,
not supplied by CSI3. Loss of that input during installation fails the operation;
loss during RUNNING does not reset the application. The existing partial-frame
timeout applies to image installation, not to future Lazy waits. Incomplete,
malformed, wrong-digest or interrupted installation cannot release execution.
No prior-image rollback, sender authentication or code provenance is claimed.

## Reproduction

```
python docs/phase-2/cooperative-retry/run_candidate_memory_admission_tests.py -q --disable-warnings
```

The suite tests the real banked memory and SHA with an independent hashlib
oracle. Fabric tests drive explicit bus requests; admission tests drive decoded
bytes, not physical UART pins. Nonzero initial staging tests actual scrubbing.
The historical lifecycle and SHA tests remain part of the suite.

## Observed local result

- First-stage memory/admission plus historical lifecycle/SHA suite:
  **46 passed in 150.28 seconds**, one warning.
- Existing general-image admission regression suite:
  **24 passed, 1 skipped in 45.00 seconds**, eight warnings.
  The skip is the opt-in exact Boot2/ChurchCore replay; it was not requested
  or run in this stage.
- Total: **70 passed, 1 explicitly unrun optional replay**.
- The new runner also collected all 46 first-stage cases successfully.

The compatibility suite imported the maintained hardware package, appended
this local directory for the admission modules and used the retained
`generated-artifacts/amoeba-remap-rtl/hardware` directory only as a fallback
for missing diagnostic dependencies. This is module-level compatibility
evidence, not a composed-top or maintained-core execution claim.

Verified behaviors include two successive full images with different contents,
independent hashlib agreement, changed last/high word rejection, explicit
START and staging-readiness gating, epoch non-wrap, nonzero staging scrub,
bad lengths/magic/reserved bytes, partial digest/data, extra data, UART error,
authorization loss, no high-address/MMIO alias, and read/write arbitration.

Exact-image ChurchCore replay, Namespace-qualified delivery, trusted Boot
fault wiring, 100-attack software execution, synthesis and physical acceptance
remain separate. No success in this suite closes those gates.
