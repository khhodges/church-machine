# Local Boot fault-entry integration

The approved direct-stash contract is connected to the core and Wukong wrapper
through an explicit `FaultBootBinding`. This is local RTL evidence, not a
Factory Build selection, vendor build or physical acceptance.

## Configuration boundary

Hard Fault entry resumes **Boot.Thread's retained continuation**. It does not
restart the LightningBolt program or select a separate recovery executable.
The IDE Namespace and its prepared startup state remain authoritative.

`FaultBootBinding.from_prepared_image` consumes the exact selected 64 KiB
ascending image, its SHA-256 and boot guard. It derives the foundational Boot
Namespace and slot-2 Thread from that image's descriptors. The lower-level
`from_image` supports explicitly supplied root/Thread identities for isolated
fixtures. Neither API accepts a handler E-GT. Both validate sealed descriptors,
versions, Thread geometry and descriptor non-overlap.

`guarded_build_profile.bind_prepared_boot` carries those identities into the
explicitly selected profile's RTL inputs and records continuation semantics in
the preparation metadata. It does not select a profile or consult the catalog.
The wrapper reconstructs and compares the binding against the selected bytes,
not just a caller-supplied hash. No live image or latest-artifact lookup occurs.

No live binding was selected or installed. Profile preparation now supplies
the binding automatically from its already selected image; there is no second
user-facing handler selection. Unprofiled integrations without an explicit
binding retain their existing behavior. Vendor builds, image publication and
physical operations still require their separate authorization.

## Sequencing and ownership

The issuing engine is clock-enabled off on fault acceptance and held through
direct stash, outgoing save and status finalization. Its live registers and
existing delayed issuer signals feed Boot stores directly. There is no new
event register bank. Already accepted memory writes take their original edge;
the next cycle gives the fault sequencer exclusive access.

Boot immutable binding words are checked first. Boot receives the original
CR12/CR15 GTs in CR1/CR2 homes and fault facts/status in DR1–DR5 homes.
CR0, CR3–CR11, DR0, DR6–DR15 and the retained stack/frame are not rewritten
by the stash. Each Boot
write receives one actual-port grant and one scheduled readback, without
rewrites or retries. The outgoing context is streamed once from the held
registers, with checked geometry. A missing outgoing grant/response reports
THREAD_CONTEXT (0x1D), DR3=2; Boot status write failure is catastrophic.

After status finalization, the existing diagnostic snapshot captures the
still-held source. Activation waits for capture, **not UART delivery or bridge
approval**. Execution-unit transaction state is cleared without FAULT_RST,
without clearing architectural registers, changing Namespace ownership or
rewinding boot. The shared ordinary transition validates the original root
and Thread into incoming working CR2/CR1, then validates Boot's Thread,
retained frame's executable, homes and continuation. Normal transition checks
validate the executable's descriptor, SELF and resume offset; no release-time
handler pin overrides that frame. Saved condition flags are restored. Ordinary
activation pops the retained indicator, rather than manufacturing a root frame.
Original references never resolve under Boot's
colliding slots. It bypasses only the already-completed outgoing save and
publishes through the existing Namespace/Thread commit states.

The wrapper releases the fault-pending and scheduler-veto state on successful
activation. Fault entry does not manufacture a debug step hold. Explicit debug
holds survive, including a UART halt received during fault entry; that command
cannot replace pending fault evidence with a reason-3 snapshot. Upload cannot
start during entry. Legacy bridge `g` and testing `k` do not authorize or skip
the configured local path. Manual external reboot remains a separate control.

The normal trace serializer is unchanged. UART-disconnected tests exercise a
running transmitter, not arbitrary stuck clocks or every possible transport
backpressure condition.

## Local acceptance

`hardware/test_fault_entry_integration.py` authors a disposable exact image
with distinct original and Boot roots and colliding Thread slot 4. Its Boot
continuation resumes at a nonzero offset with retained flags and data; the
startup instruction traps, making an unintended restart observable. It then
explicitly loads a healthy Thread GT and executes CHANGE. Full-wrapper
tests observe repeated IADD progress through a loop without any bridge input,
reset, skip, forced NIA or trace bypass. Separate tests cover a real delayed
LOAD fault, pending scheduler request, corrupt binding/original reference,
outgoing-save failure, stash grant/response/readback failure, status-store
failure and activation-response failure. They check original evidence,
no repeated outgoing writes and no CR13 publication.

Full-wrapper UART tests preserve an explicit debug halt, reject an upload
racing entry, and verify that a subsequent fault in Boot.Thread enters the
catastrophic loop. The existing heartbeat continues toggling LED[1] there
with UART RX idle; no useful-work continuation is claimed for that outcome.

Malformed retained frames and stale resume E-GTs fail without publishing
Boot's context. Stash tests seed every Thread word and assert that only the
seven fault-ABI homes change, including readback/grant failure cases.
Prepared-image tests check derived identities, exact hashes, malformed input
and forged binding fields. These are local tests, not physical acceptance.

## Continuation correction validation

The corrected suites cover 181 cases, including the prepared-image binding
tests. The combined run passed 176 cases; four continuation assertions initially
used the wrong Amaranth structured-flags comparison. After correcting that
test assertion, all 13 core-entry cases passed. The eight prepared-binding cases
(including the added guard-mismatch case) passed separately.
Full-wrapper no-bridge progress, UART halt/upload races, malformed continuation
denial and local netlist cycle checks were included in the combined run.

Read-only preparation of the existing factory-continuation profile also
confirmed that its exact image hash derives Boot Namespace
`000000ff0000000002000001` and Boot.Thread
`000000ff0000040002000002`. This is binding evidence only, not a new release
selection or acceptance of that historical program's application behavior.
No saved image, catalog artifact, hardware configuration or board was changed.

### Fault-reference lifetime limit

The user selected **immediate handoff only** on 2026-11-08; see
[the lifecycle decision](../phase-1/boot-fault-engineering-resolution.md#lifecycle-decision--immediate-handoff-only).
The tests above establish the original pair at fault-entry activation and
subsequent healthy-work progress, not preservation of foreign-root association
after Boot suspension/restoration. They do not establish retirement enforcement.
GT-only homes cannot supply that association; matching slot numbers in Boot's
Namespace must not be mistaken for the original fault references.

No later-lifecycle storage or restoration extension is authorized. Before a
hardware release, review the program resumed by Boot.Thread against the
immediate-only lifetime, including how it finishes using and retires the pair
before leaving. This is not a separate handler-selection mechanism.
The existing test totals below are historical RTL results, not new evidence
for that handler obligation or a resumable-reference contract.

Local netlist elaboration checks the whole wrapper for combinational cycles.
In particular, scheduler acceptance must not feed its aggregate fault decision
back through shared operand reads or instruction-valid gating. Registered
pending/active scheduler ownership gates fetch, while independent front-end
faults exclude acceptance.

The regression command includes direct stash, boot CHANGE, ordinary scheduler,
LLR, guarded LLR and snapshot protocol suites alongside the new integration
suite. Historical boot-ROM test failures recorded in the investigation remain
separate; this change does not turn those earlier failures into passes.

After syncing the protected monitor-clear changes, the integration,
monitor-clear and status-LED suites passed 39 checks. Monitor-port denial is
computed from the issuing engine's selected request, before recovery takes
the physical memory port, so direct stash cannot erase that fault source.

Completion review identified coincident breakpoint/command snapshot races.
Fault reason 2 now has final request priority, including on the initial fault
edge before the entry-active register is set. Two additional full-wrapper
regressions passed: an armed breakpoint at the authored fault NIA, and an
actual UART halt nonce decoded on exactly the initial fault edge. Both observe
reason-2 evidence capture and Boot activation while retaining the debug hold.
The nonce test calibrates the real UART receiver and fixture fault cycle;
it does not inject decoded commands or force execution state.

Pre-merge local regression: **171 passed**:

```sh
python3 -m pytest hardware/test_fault_entry_integration.py \
  hardware/test_fault_stash.py hardware/test_boot_change.py \
  hardware/test_wukong_thread_scheduler_contract.py \
  hardware/test_phase2_llr.py hardware/test_phase2_guarded_llr.py \
  tests/hardware/test_wukong_snapshot_protocol.py -q --disable-warnings --tb=short
```
