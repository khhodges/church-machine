# Execution watchdog: local unit, not integrated enforcement

The user approved local watchdog implementation and tests, with unresolved
interfaces/containment decisions brought back before integration.

`hardware/execution_watchdog.py` implements the settled timing/control logic:
one ungated-clock countdown, four integral durations, retained control word,
atomic accepted updates, delayed selector effect, exemption exit, successful
transition renewal input, latched expiry and expiry-before-renewal precedence.
Configuration initializes to 5; readback is configuration, not remaining time.

The unit has **no wired MMIO decoder, provisioned Namespace slot or
software-visible bypass**. Its control-write and transition inputs are internal
integration ports, not evidence of SecurityRegulator provisioning or validated
instruction completion. Its block-program-writes output requests containment;
it does not prove that any core/memory consumer implements it.

The [Phase 2 hardware-address map](hardware-address-map-and-diagnostic-mmio.md)
records `0xFFFFFF18` as the approved specification address for WDT control.
The possible full-range diagnostic MMIO interface remains a proposal.
Address approval does not authorize provisioning or integration.

Remaining integration obligations:

- Agree capability provisioning and the exact access path for the approved
  watchdog control-register address `0xFFFFFF18`.
  SecurityRegulator alone privately owns direct control; SYSTEM may use
  explicitly authorized methods. No Thread-name privilege.
- Wire real execution-start and successful CHANGE/SWITCH/LLR completion events
  using the actual ungated clock frequency. No retirement- or stall-driven clock.
- Validate control accesses and propagate malformed-control INVALID_OP without
  partial effects. Preserve same-edge instruction-fault reporting precedence.
- Stop all new program writes at expiry, prove the accepted-write completion
  boundary/bound, then follow the approved Boot fault-evidence/recovery contract.
  No timeout-based assumption of completion, automatic retries or rollback.
- Qualify integrated Debug/Trace, reset and control-capability behavior.

Unit-test timing uses a small explicit clock rate, with separate elaboration
checks of the 25/50 MHz period constants. These tests do not simulate seconds
on a physical FPGA and do not close A5/F.36–F.38 integration acceptance.
Logs/JUnit: `generated-artifacts/execution-watchdog/`.

Local result: **33 passed**. Six Amaranth unused-elaboratable warnings arise
from deliberately rejected constructor inputs; no test failed. The unit is
not connected to ChurchCore or a memory-mapped software access path.

No core/top, live images, application workflow or physical board was changed.
