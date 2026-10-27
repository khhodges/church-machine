# Next Factory Build — approval specification

**Status: Scope and Mallory fault disposition approved to proceed. Detailed
target bindings and normal turn scheduling remain unresolved approval gates.
No authorization to flash or activate hardware.**

## 1. Purpose and operator boundary

Deliver one hardware installation flow through the published IDE at
**lab.cloomc.org**:

**Check hardware → Select image → Confirm → Installation hold → Load →
Read back → Verify → Explicit Start**

Include both LightningBolt options, controlled by **Amobea in round-robin
turns using GTs in CR0 and CR1**.

### Factory tutorial: fault handling and reliable LUMP development

The Factory Build must include a tutorial that establishes fault handling,
containment, and evidence-based reliability as part of developing software
as LUMPs. It is not merely a loader demonstration.

Teach the complete development cycle: pinpoint a fault in an individual
object; explain the security check; contain its effects; evaluate reliability
against Amoeba's configured minimum; place underperforming objects in Must
Resolve; enforce version-defined OFFLINE; have Amoeba stop polling; correct
the design; explicitly adopt the corrected LUMP; and demonstrate safe
side-by-side evolution and eligible fallback.

The goal is calibrated reliability that can meet or exceed the minimum
required by the target fault-tolerant application. Use the user's PP250
50-year software MTBF example as the high-reliability reference. This is not
an independently verified historical claim or a measured result for the
Factory Build, and does not set every object's threshold to 50 years.

State the workload, exposure, fault definition, revision, estimation method,
and uncertainty behind any reported MTBF. Keep object-level fault occurrence
and application-level service failures distinct: meeting each object's
threshold does not by itself establish the whole application's MTBF.
Containment and intentional fault tests demonstrate behavior, not decades
of measured reliability. Do not promise suitability for every fault-tolerant
application without its own requirements and evidence.

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

### Explain the security boundary: one RW data object in Mallory

The user identifies this example's error case as **one RW data object in
Mallory**. Pinpoint the instruction at error; do not replace this explanation
with a generic whole-Abstraction, Thread, or FPGA failure badge.

The operator-facing evidence must show:

- The exact affected RW object identity and its relationship to Mallory.
- The executing Mallory revision, faulting instruction address/offset and
  disassembly, and the corresponding source location when an exact source
  mapping exists. If the mapping is unavailable, say so instead of guessing.
- The attempted operation and the capability/GT used, resolved to its object
  identity, with the relevant actual permissions and bounds.
- The precise failed runtime check and why that operation was not permitted.
  RW rights do not authorize access outside the capability's object or bounds;
  do not invent the particular failure reason before inspecting the evidence.
- What effect was blocked, whether any state changed, and the evidence that
  effects did not propagate outside the affected object.
- What authorized work continues on the Thread and FPGA.

Keep the executing Abstraction, affected data object, capability, and Thread
distinct in the report. Attribute per-object reliability evidence to the
actual affected object rather than collapsing every Mallory incident into one
generic counter. Do not conflate denied access with demonstrated corruption:
report the actual observation. This example must explain security, not conceal
the mechanism behind a success badge or expose unrelated protected contents.

Amobea must retain control of scheduling so the other authorized work can
continue. **Approved disposition: the Mallory Abstraction remains faulted,
not the Thread.** Do not mark the Thread faulted or remove it from scheduling
because of Mallory's denied operation. Keep Mallory's fault evidence available
and do not automatically re-enter the faulted Abstraction.
The affected object's OFFLINE state is defined through its Namespace slot
version, not an independent UI flag. Authorized software management owns
version changes; hardware validates versions and never changes them itself.
Previously issued GTs become stale after the slot version changes. Do not
silently refresh those GTs or mint matching replacements to bypass OFFLINE.

**Caller responsibility:** This analysis directs Amoeba, as the user/caller
of Mallory, to stop polling Mallory. Amoeba must stop issuing further
requests to Mallory and continue other eligible work. Repeated stale-GT
faults are not a substitute for the caller respecting the OFFLINE decision.
This is an Abstraction-level calling decision, not removal of the Thread
from scheduling. Hardware version enforcement remains the independent
protection if a stale capability is nevertheless used. No particular
notification or control ABI is implied by this requirement.

OFFLINE requires a design correction. In this demonstration, the correction
is **removing Mallory's attack**. A reset, retry, or operator acknowledgement
alone is not that correction and must not restore the unchanged attack.
Return to service requires the corrected design and explicit authorized
adoption; the detailed admission procedure remains to be specified.
This requirement does not authorize silently skipping the faulting instruction,
retrying it, restarting Mallory, or weakening capability enforcement. It supersedes a
whole-board halt as the required Mallory demonstration endpoint, not the
handling of unrelated or uncontained hardware faults.

Acceptance must demonstrate A → B → A → B turns while both targets are eligible
through the approved Amobea path, with trace evidence identifying the actual
selected executable and relevant GT/context. After Mallory faults, demonstrate
that the faulted Mallory Abstraction is not re-entered, the Thread is not
disabled, and other eligible work continues. Do not require
Mallory to execute again merely to produce an alternating trace outside that
authorized demonstration loop. Merely showing
alternating UI labels is insufficient.

### Reliability basis: one Abstraction fault

The user defines the single event as **one Abstraction fault**, not a Thread
failure, physical single-event upset, or automatic whole-system failure.
Assess the full flow against that event and its containment.

- Record one incident for the faulting Abstraction, with exact revision,
  instruction, reason, and execution context. Repeated telemetry for that
  incident must not be counted as additional faults.
- Measure Abstraction fault occurrence separately from propagation into loss
  of other authorized work. Mallory's intentional denied-access test verifies
  protection and containment; it is not an unplanned system-service failure.
- For an MTBF estimate, declare the workload, observation boundary, exposure
  clock, and counted fault population. Report measured operating exposure
  and qualifying fault count together. A single demonstration cannot establish
  MTBF, and zero observed faults does not establish infinite MTBF.
- Keep intentional fault-injection results separate from operational MTBF
  data. Do not combine differing revisions or workloads without identifying
  them, or use time spent inactive/faulted to inflate active exposure.
- For each containment test, prove that the denied effect did not occur,
  Mallory remains faulted as an Abstraction, the Thread is not disabled, and
  other authorized work continues under Amobea.

No numerical MTBF target, observation duration, or statistical confidence
requirement has yet been approved. Report those as unspecified, not passed.
The priority remains exposing the fault at its first occurrence and fixing
its cause, not masking it with retries or recovery claims.

### Per-object reliability and Must Resolve queue

When corruption is confirmed contained within one Abstraction, unaffected
authorized work continues; that incident alone must not halt the Thread or
FPGA. Containment must include effects on other objects and shared state,
not merely the location where the fault was reported. Unknown containment
must not be reported as proof that nothing else was harmed.

The approved escalation rule is:

**Measured MTBF of an individual object < its allowed minimum MTBF →
add that object to the Must Resolve queue.**

Track object identity and revision alongside the qualifying incidents,
measured exposure, measured MTBF, and applicable allowed minimum. Update an
existing open queue entry rather than duplicating it for repeated telemetry.
The queue records required corrective work; it does not itself authorize
global halt, additional capabilities, automatic retry, or resumption of a
faulted Abstraction.

A missing threshold or insufficient evidence must remain explicitly
unassessed, not silently treated as meeting the reliability requirement.
The numerical thresholds and measurement policy remain to be specified.
Queue resolution must not erase the retained incident evidence.

Acceptance must check the strict less-than comparison (including equality
and values on either side), per-object attribution, incident deduplication,
and continued unaffected execution when containment is established.

### Repeatable security demonstration

The user explicitly authorizes the demonstration to loop based on the default
MTBF setting until its message is understood. Provide an explicit demonstration
start and a visible Stop control so the viewer decides when to finish.

Each cycle must explain the affected RW data object, exact instruction at
error, attempted access, failed security check, containment evidence, and
continued unaffected execution. Keep prior incidents available across cycles.
The loop must exercise the security checks, not merely animate a successful
result or silently skip the offending instruction.

**Default MTBF is an Amoeba setting.** The demonstration must use Amoeba's
configured value, not a separate IDE default or demonstration-only override.
Display that value with its units and role in the demonstration.
Its numeric value and mapping to loop
timing/eligibility have not yet been established here. Do not invent a value,
treat an MTBF threshold as a retry timer without a defined mapping, or use a
clean-run score as a time-based MTBF.

Starting this mode authorizes controlled demonstration repetitions while
the relevant objects remain eligible; it does not bypass version-defined
OFFLINE status. Once an object is OFFLINE, do not revive the unchanged
attack to keep the loop running. Keep its explanation and evidence visible
until the design is corrected. The implementation must define how each
eligible cycle is prepared under existing authority without granting new
rights, erasing evidence, faulting the Thread, or globally rebooting the FPGA.

Retain the per-object Must Resolve queue rule during the demonstration, with
intentional demonstration events clearly identified and kept separate from
operational MTBF claims. Test repeated cycles, Stop, evidence retention, and
that repetition does not become implicit recovery outside demonstration mode.

### Close the example with corrected Mallory

Include a revised Mallory with the attack removed as the final demonstration
stage. Preserve the original attacking revision and its incident evidence;
do not rewrite history or make the old GTs valid again.

Show the complete sequence:

1. Identify the RW object, attack instruction, failed check, and containment.
2. Show the applicable MTBF analysis, Must Resolve entry, version-defined
   OFFLINE state, and Amoeba stopping its polls of Mallory.
3. Show the source/design change that removes the attack, with the original
   and corrected revision identities clearly distinguished.
4. Explicitly approve and adopt the corrected revision through the authorized
   binding/admission path. Do not silently refresh stale GTs or weaken checks.
5. Let Amoeba resume requests to the corrected Mallory and demonstrate its
   intended authorized work completing without error under the same protection
   rules. Other eligible work must continue.
6. Attach the corrective revision and observed successful execution to the
   Must Resolve item. Close it only through the defined resolution process,
   preserving the original fault evidence.

Success must be demonstrated by the expected work and execution evidence,
not merely by absence of a fault badge or replacing Mallory with a no-op.
Label the observed error-free run duration/cycles; it does not establish an
unmeasured operational MTBF. This is a design correction and explicit adoption,
not automatic recovery of the original attacking object.

### Side-by-side LUMPs, evolution, and upgrade fallback

The example must also demonstrate side-by-side LUMPs and code evolution.
Retain distinct immutable revisions instead of overwriting the old LUMP.
Show which exact revision Amoeba currently uses and make adoption of the
replacement explicit; coexistence alone does not switch callers.

Demonstrate controlled fallback during an upgrade to an approved, compatible,
still-eligible known-good LUMP. The original attacking Mallory may remain
available as historical evidence, but its OFFLINE status makes it an invalid
fallback target. To demonstrate executable fallback, retain a safe baseline
alongside an upgraded safe candidate rather than revive the attack.

Fallback must use authorized bindings and respect slot versions, capability
checks, and state compatibility. Code selection is not automatic restoration
of older data or reversal of external effects. Identify any state transition
requirements explicitly; never assume that retaining old code makes current
state compatible with it.

Acceptance must show side-by-side identities, deliberate upgrade selection,
actual execution of the selected revision, and a controlled return to the
eligible baseline without disturbing unrelated work. Reject fallback to the
OFFLINE attacking revision. Retain the upgrade/fallback evidence alongside
the original denial and corrected-Mallory evidence.

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
  and other authorized work demonstrably continues under Amobea. Verify that
  subsequent scheduling opportunities do not re-enter the Mallory Abstraction
  or erase its fault state outside an eligible demonstration cycle or the
  authorized corrected-design adoption path. Verify stale GTs cannot bypass
  version-defined OFFLINE and a reset cannot restore the unchanged attack.
  Verify Amoeba stops issuing Mallory polls after acting on the analysis,
  rather than repeatedly provoking stale-GT faults, while other eligible
  work continues.
  Verify the Thread
  itself remains available for authorized work. A running badge alone is not
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
