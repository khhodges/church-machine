# Next Factory Build — approval specification

**Status: Scope approved to proceed. Detailed target bindings and faulted-turn
disposition remain unresolved approval gates. No authorization to flash or
activate hardware.**

## 1. Purpose and operator boundary

Deliver one hardware installation flow through the published IDE at
**lab.cloomc.org**:

**Check hardware → Select image → Confirm → Installation hold → Load →
Read back → Verify → Explicit Start**

Include both LightningBolt options, controlled by **Amobea in round-robin
turns using GTs in CR0 and CR1**.

Routine operation requires no terminal, local application, or manual JTAG
steps from the operator. The existing bridge communicates with the FPGA over
UART. Initial installation of the upgraded Factory Build is a separate,
explicitly authorized programming operation; this specification does not
claim an existing UART bitstream-update facility.

## 2. Hardware checks — before changing the board

The IDE must check and display:

- Exact board identity and a fresh, responsive bridge session.
- Installed hardware build identity and advertised support for installation
  hold, memory readback, and the selected image's execution requirements.
- Current execution state: Running, Halted, Faulted, or Unknown.
- No conflicting hardware command or installation.
- Existing control authorization; this change does not redesign authentication.

Unsupported firmware, an unknown target, stale evidence, or missing authority
blocks installation. Never silently reflash, reboot, or choose another board.
Check image-specific compatibility after selection and before taking hold.

## 3. Exact selected image

Select an approved immutable Namespace revision. Show its name, revision,
projected memory size, and entry target. Validate its retained bytes and
configuration and derive the exact board-format image.

Pin the revision, projected bytes, board identity, session, and operation ID.
Neither a newer catalog revision nor a selector change may alter an operation
already in progress. A changed board/session requires fresh checks, not an
automatic continuation against a different target.

Require confirmation that replacement discards runtime data and Thread
progress. State that execution remains stopped until explicit Start.

## 4. Installation hold

The hardware control path must remain usable independently of the executing
Church program.

| Starting state | Required behavior |
| --- | --- |
| Running | Halt and obtain correlated hardware confirmation. |
| Halted | Confirm installation hold rather than trusting a cached badge. |
| Faulted | Retain fault evidence, then clear fault-recovery hold directly into installation hold without running the old program. |
| Unknown/disconnected | Block the operation. |

Installation hold prevents instruction execution and other memory writers
from altering the image throughout upload and readback. Only the authorized
loader may write the replacement region. Do not implement this as reboot
followed by a best-effort Halt.

Hold acknowledgement must identify the operation and board session. Preserve
the hold across communication loss once established; the IDE must nevertheless
report state as unknown when it cannot confirm current hardware state.

## 5. Load and verify

1. Transfer the complete board-format image with bounded framing and progress.
2. Treat loader acknowledgement only as **Loaded**, not **Verified**.
3. Do not automatically reboot or execute after upload.
4. Read the full uploaded region from actual FPGA memory while held.
5. Compare every byte against the pinned board-format image, with explicit
   address coverage, length, and wire-endianness handling.
6. Mark **Verified** only after complete matching readback for this operation.

An echoed upload buffer, host-side digest, partial snapshot, or UART write
success is not installed-memory verification. Readback frames must be
correlated and distinguishable from trace, snapshot, and control traffic.

Readback is a privileged installation operation, not a new general capability
for applications to inspect protected live memory.

On mismatch, show the first differing address and expected/actual values,
plus the compared length and mismatch count where available. On truncation,
timeout, or framing failure, report incomplete verification instead of success.
Keep execution held and disable Start.

There is no automatic rollback promise: after the first write, the previous
runtime may already be destroyed. Never resume it from partially replaced RAM.
Retry requires explicit action and fresh checks; it is not silent recovery.

## 6. Explicit Start

Success ends at **Verified — ready to start**, with a separate
**Start selected image** action.

Start is permitted only for the verified operation on the same board, with
the hold and unchanged-image conditions still valid. Reset, intervening writes,
or lost correlation invalidate readiness until re-established.

Initialize execution through boot ROM using the newly installed RAM image.
Do not restore or execute the previous software image. Report startup evidence
separately as **Started**, **Faulted during startup**, or **Start unconfirmed**.
Readback success proves transfer equality, not program correctness.

## 7. Two LightningBolt targets under Amobea

The next Factory Build must include both options in the same approved image.
Amobea owns their round-robin control; the IDE must not alternate them through
host-timed commands, and hardware must not substitute unrelated target choices.

The requested CR0/CR1 GT arrangement is required. Exact binding and scheduling
details must be approved before implementation:

| Approval item | Required selection |
| --- | --- |
| CR0 target | Exact selected LightningBolt abstraction/revision: **unresolved** |
| CR1 target | Exact selected LightningBolt abstraction/revision: **unresolved** |
| Register/context ownership | Specify whose CR0/CR1 contain the two GTs and how existing startup and application bindings are preserved. |
| Turn boundary | Specify the approved completion, yield, or scheduling event that advances Amobea to the other target. |
| First turn | Specify initial target and fresh-start/reset behavior. |

The existing Amobea design leaves parts of bootstrap/CR0 binding unresolved.
Do not treat historical Alice/Mallory startup assignments as implicit approval
of this new pair, invent a timer quantum, or overwrite CRs to satisfy a display.
Respect existing capability checks and protected Thread state. Mallory's
denied-access fault must be reported without halting the whole FPGA.
The denied operation must not complete or acquire additional authority.
Preserve the faulting instruction, actor/Thread identity, and denial reason
as evidence; show the contained fault separately from board execution state.

Amobea must retain control of scheduling so the other authorized work can
continue. The exact disposition of Mallory's faulted turn (including whether
and how it becomes eligible again) remains an approval detail. This requirement
does not authorize silently skipping the faulting instruction, retrying it,
restarting Mallory, or weakening capability enforcement. It supersedes a
whole-board halt as the required Mallory demonstration endpoint, not the
handling of unrelated or uncontained hardware faults.

Acceptance must demonstrate repeated A → B → A → B turns through the approved
Amobea path, with trace evidence identifying the actual selected executable
and relevant GT/context. Merely showing alternating UI labels is insufficient.

## 8. Operator presentation and installation receipt

Use one progress view with distinct states:

**Checking → Ready for confirmation → Holding → Loading → Reading back →
Verified/stopped → Starting → Started**

Show a failure or unknown state at the actual failed stage, with whether RAM
may have changed and the next permitted action. Do not display a queued
command as a completed hardware operation.

Retain a receipt identifying the board/session, Factory Build, approved
Namespace revision, exact projected-image hash and length, operation ID,
hold evidence, upload result, readback coverage/result, and separate start
result. Preserve any preceding fault incident without exposing credentials
or publishing raw protected-memory contents in ordinary logs.

## 9. Acceptance gates

Before a candidate build is accepted:

- RTL tests cover installation hold from running, halted, and faulted states,
  including no old-program execution between fault clearance and upload.
- Tests prove no unauthorized memory writer runs during transfer/readback.
- Protocol tests cover malformed lengths, truncation, stale acknowledgements,
  interleaved traffic, timeouts, reconnects, and conflicting commands.
- Readback tests inject memory differences and prove they block Start.
- Exact-image tests cover immutable revision selection and byte order.
- Amobea tests demonstrate the approved two-target turn sequence and GT
  bindings without bypassing normal runtime authority checks.
- The Mallory denial is reported with matching instruction and Thread evidence,
  its forbidden effect does not occur, the FPGA does not enter a global halt,
  and other authorized work demonstrably continues under Amobea. Verify the
  approved faulted-turn disposition separately; a running badge alone is not
  proof of continued execution.
- IDE tests cover both success and failure paths, explicit Start, and no
  false installed/verified/started claims.
- A separately authorized physical acceptance run repeats the flow from
  running, halted, and faulted states using exact retained build/image bytes,
  then confirms both LightningBolt targets execute in the approved order.

Simulation results, synthesized build results, and physical evidence must
remain separately identified. None may stand in for the others.

## 10. Approval and release boundary

1. Review this scope and resolve the binding/scheduling items in section 7.
2. Explicitly approve the completed specification before building.
3. Implement, validate, and produce the next Factory Build with retained
   source, inputs, bitstream identity, and test evidence.
4. Obtain separate authorization for programming and physical acceptance.
5. Accept the exact tested Factory Build and publish compatible IDE changes
   through the normal release approval process.

No build, physical upload, reset, flash, activation, or publication is
authorized merely by preparing this document.

## References

- [Namespace layouts and full-image reload](namespace-layouts-and-full-image-reload.md)
- [Existing bounded physical reload evidence](installed-image-reload-result.md)
- [Amobea V1 design and unresolved bootstrap contract](Amobea-V1.md)
