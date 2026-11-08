# Local Boot fault-entry integration

The approved direct-stash contract is connected to the core and Wukong wrapper
through an explicit `FaultBootBinding`. This is local RTL evidence, not a
Factory Build selection, vendor build or physical acceptance.

## Configuration boundary

`FaultBootBinding.from_image` consumes explicitly supplied 64 KiB image words,
their SHA-256, the full Boot Namespace capability, the exact slot-2 Thread GT,
handler E-GT and boot guard. It validates sealed descriptors, versions, allocation,
handler SELF and non-overlap. The wrapper rejects a different image. No editor,
catalog, live image, mutable CR0 home or “latest” selection participates.

No live binding was selected. Integrations without an explicit binding retain
their existing behavior; enabling a concrete hardware release still requires
its separately authorized exact-image preparation.

## Sequencing and ownership

The issuing engine is clock-enabled off on fault acceptance and held through
direct stash, outgoing save and status finalization. Its live registers and
existing delayed issuer signals feed Boot stores directly. There is no new
event register bank. Already accepted memory writes take their original edge;
the next cycle gives the fault sequencer exclusive access.

Boot immutable binding words are checked first. Boot receives the original
CR12/CR15 GTs and fault facts, deterministic homes and poison root. Each Boot
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
handler, homes and root frame. Original references never resolve under Boot's
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
handler explicitly loads a healthy Thread GT and executes CHANGE. Full-wrapper
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
