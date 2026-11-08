# Wukong fault hold: investigation and approval boundary

Status: historical investigation and partial-change record. The subsequent
[local RTL integration results](boot-fault-local-rtl-results.md) now document
machine-owned Boot entry and full-wrapper healthy-work continuation for exact
disposable fixtures. No live binding, vendor build or physical acceptance is
claimed. The catastrophic-loop exception remains unchanged.

## Earlier partial implementation: pending scheduler exclusion

The core now excludes external Thread-switch acceptance while `halt_req` or
`fault_valid` is asserted, including a request racing the fault edge. The
wrapper cancels its pending M6 request on `core.fault_valid`, with priority over
a new click, and masks the request while the historical fault latch is set.
This does not clear the historical latch or release any execution hold.

The scheduler contract tests exercise the actual core with an authored
`0xF7000000` fault and a concurrent switch request, and separately with an
external debug hold. Both preserve the active owner, NIA and capability
registers without outgoing writes. Releasing the debug hold permits the
healthy request again. These are core-level exclusion tests, **not** the
full-wrapper continuation acceptance described below.

At this partial-change checkpoint, remaining work was: exact isolated Boot bindings, integrated direct
stash and source stability, real-port completion/readback, one outgoing save,
post-stash original-root reference staging, checked shared activation,
retained diagnostic transport, selective hold release, catastrophic indication,
and the complete local acceptance matrix. See the integration results for
the subsequent implementation and tests. No live image selection, vendor
build, physical operation, reset workaround or fault-skip recovery was added.

Local partial-change validation:

```sh
python3 -m pytest hardware/test_wukong_thread_scheduler_contract.py \
  hardware/test_boot_rom_no_false_halt.py \
  tests/hardware/test_wukong_snapshot_protocol.py -q --disable-warnings
# 89 passed, 10 failed
```

All 53 scheduler tests and all 21 snapshot-protocol tests passed. The 10
failures are in `test_boot_rom_no_false_halt.py`: consecutive SWITCH issuer,
successful SWITCH retirement, delayed CALL/SWITCH/CHANGE faults, arithmetic
register/immediate forms, nested CALL/RETURN, both saved-PC-three cases, and
root RETURN underflow. Loading the unmodified HEAD versions of the core and
that test module in memory reproduced the same 10 failures (15 passed).
They are not new failures from this exclusion change. They remain unresolved;
the combined command is **not** a passing Boot-entry acceptance result.

## Confirmed execution and ownership paths

`hardware/wukong_top.py` sets `core.defer_fault_reset=1`. A fault retirement
drives `fault_halt`, which independently:

1. Sets `FaultRecoveryControl.fault_pending`; this registered state gates
   `core.imem_valid` and asserts `core.halt_req`.
2. Forces `step_mode=1` and `step_halted=1`.
3. Requests a reason-2 diagnostic snapshot.

Snapshot completion alone does not release execution. The controller accepts
bridge command `g` only after the reason-2 frame drains, then requests reboot
at `reboot_safe`. Explicit manual reboot and the existing testing-only skip
are separate exits. Neither is a proposed solution here. A missing/rejected
bridge authorization can hold the shared core indefinitely.

There is a third barrier: the legacy `fault_latched` signal prevents M6 from
queuing another Thread switch. That signal clears on CM reboot, not on successful
Thread switching. The new optional LED observer is separate; clearing its
indication cannot repair these execution gates.

The M6 scheduler is button-driven, not an autonomous scheduler. It chooses from
configured slots using `active_thread_slot`, retains a pending request, and
passes it to the core. A request already pending at the fault is an additional
race to test: at investigation time the core's external switch acceptance
checked boot completion and unit busy state, not `halt_req`. The partial
implementation above closes that acceptance gap. Fetch hold alone is not a complete
ownership barrier for machine-controlled transitions.

In `hardware/core.py`, a deferred fault holds NIA. Without deferral a completed
boot's fault requests `FAULT_RST`. That reset clears execution units and active
Thread ownership; it is not an isolated healthy-Thread continuation mechanism.
Removing the wrapper hold can re-present a failing instruction. Advancing NIA
would skip it. Neither is acceptable.

Ordinary CHANGE receives the active Thread base/ownership and current CR12/CR15.
Successful restore updates the backing base/ownership and CR12 publication
updates the slot. SWITCH shares the CHANGE handoff and carries its accepted
NIA/flags. Fault attribution must therefore distinguish instruction issuer,
outgoing owner and incoming candidate at the commit boundary; a rejected
incoming candidate must not become the incident owner.

The snapshot FSM samples live registers and active backing base after trace
backpressure clears, then reads Thread memory. It is not an immutable fault
record captured completely on the initial fault edge. Allowing handler execution
before those reads finish without changing the evidence source risks mixed
contexts. Existing issuer-instruction latching is useful but not a complete
retained Thread/Namespace incident store.

## Existing approval governs the correction

The controlling document is
[`../phase-1/boot-fault-rtl-contract.md`](../phase-1/boot-fault-rtl-contract.md),
approved 2026-10-27. It already replaces Namespace reboot with:

- Direct first stash into configured Boot.Thread homes, without an intermediate
  event bank; retain original Thread/Namespace references as a pair.
- Prime Boot, attempt one outgoing protected save, and finalize its result.
- Load Boot Namespace and activate Boot.Thread through the checked shared
  transition machinery, without a second save.
- Enter the configured handler without waiting for IDE/bridge acknowledgement.
- Treat the failed context as evidence, never an implicit continuation.

`FaultStash` exists as a separately tested component; the inspected core/top
do not instantiate it. Its presence is not evidence of integrated recovery.

## Smallest safe correction proposed

Integrate the already-approved machine-owned Boot entry with the existing
core/shared transition machinery. Keep execution held while source state,
accepted memory operations, direct stash and destination validation require it.
Release the fault-induced wrapper/step hold only at successful Boot activation;
do not release unrelated debug or installation holds. Remove historical fault
indication as a scheduling veto only after that safe ownership transfer.
Exclude pending M6 requests during fault entry; do not let them race the stash.

Diagnostic transport must consume retained evidence consistently rather than
depend on indefinitely frozen application registers. UART/server delivery must
not authorize execution or erase the original incident. Preserve existing
trace serialization, without claiming that a disconnected receiver proves
all possible backpressure paths are bounded.

No new scheduler, alternate target search, automatic retries, version changes,
instruction skips, scratch incident bank or reset workaround is proposed.
The configured Boot program remains responsible for selecting eligible work.
Exact local fixture Boot bindings, memory-failure detection and original-root
reference loading must satisfy the existing engineering prerequisites.

This is a bounded integration, not a one-line gate deletion. This investigation
does not implement it or select trusted release bindings.

## Contract decision

The approved Boot contract deliberately enters a catastrophic LED loop if
safe stash/priming/activation fails, including unsafe entry from Boot.Thread.
It cannot guarantee healthy Threads continue when the shared trusted recovery
machinery cannot establish safe ownership.

The user answered the exception question with **“Keep looping.”** Retain the
indefinite catastrophic LED loop; do not replace it with a retry or an alternate
recovery target. This confirms the existing exception, not a stronger liveness
guarantee or approval of physical operations.

The correction boundary remains: continue eligible work after safely contained application
faults through approved Boot entry; retain catastrophic stop when that entry
cannot be established. A stronger guarantee for those catastrophic cases would
require a separately approved containment design, not weakening fault checks.

At investigation time, implementation and full-wrapper continuation acceptance
remained subsequent work and the hold was still present in RTL. The engineering resolution
(`../phase-1/boot-fault-engineering-resolution.md`) supplies the local-memory
write-edge/readback and post-stash foreign-reference staging design; do not
reopen those decisions or replace them with an invented timeout or event bank.

## Verification performed

Against unchanged RTL:

```sh
python3 -m pytest tests/hardware/test_wukong_snapshot_protocol.py \
  -k 'hardware_is_fail_closed or deferred_fault_hold or wired_into_top' \
  -q --disable-warnings
# 3 passed (the combined collection also deselected scheduler cases)

python3 -m pytest hardware/test_wukong_thread_scheduler_contract.py \
  -q --disable-warnings
# 51 passed
```

The first selection confirms the existing indefinite hold contract and deferred
NIA behavior, not recovery success. The scheduler suite confirms its existing
contracts. Its rejected-target case preserves the source context and executes
the pending source instruction in a core harness; it is not a full-wrapper
multi-Thread Hard Fault liveness proof.

Required implementation acceptance: a real application fault in the full
wrapper reaches the exact Boot handler with original evidence, then explicitly
scheduled healthy work makes repeated observable progress without bridge `g`,
reset, skip or trace bypass. Include delayed faults, pending M6 request,
distinct roots with colliding slots, outgoing save failure, stash/activation
failure, preserved debug/installation holds, and unchanged ordinary CHANGE/
SWITCH checks. Record catastrophic outcomes separately, not as liveness passes.

The passive LED evidence in `thread-status-led-rtl-results.md` remains valid
only within its stated scope. No live artifacts, workflows, vendor builds,
board operations or physical acceptance were involved.
