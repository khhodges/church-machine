# Boot fault RTL implementation boundary

The full fault-entry path is **not implemented or enabled**.

`hardware/fault_stash.py` implements only the direct Boot-home writer.
It stores original GTs first, then fault facts, zeros remaining homes, and
primes the poison root. Every store uses a single selected write edge followed
by a fixed-latency readback. Missing grant/response, mismatch or loss of its
external safety prerequisite enters a terminal catastrophic state, without
retry. It contains sequencing state but no event/expected-data capture bank.

Its `safe` input is a prerequisite, **not an implemented admission check**:
the caller must establish trusted image binding, checked Thread geometry,
non-overlap, exclusive final-port ownership and stable event sources.
The isolated testbench supplies these prerequisites; it does not prove them
in ChurchCore or the Wukong memory mux. `catastrophic` is an output, not yet a
connection to the physical LED.

## Integration still required

- Hold existing issuer/fault sources stable without an event bank. Current
  instruction FSMs leave their fault states; `defer_fault_reset` prevents reset
  but does not freeze those FSMs. Current telemetry also copies the instruction
  into a fault latch. Neither is the approved direct-stash source-hold mechanism.
- Drain accepted writes and derive completion from the actual Wukong port,
  retaining installation hold and rejecting high-address aliasing.
- Stream one outgoing save, write DR3/DR5, and terminate memory failures with
  the approved THREAD_CONTEXT code. The existing OrdinaryChange SNAPSHOT
  path is not an approved substitute.
- Validate/preserve foreign CR1/CR2 under the original root and connect the
  shared Namespace/Thread activation without another save.
- Connect terminal LED priority independently of bridge/debug recovery holds.
- Prove the whole path with full-core/top-level tests, including ordinary
  CHANGE/SWITCH regressions.

The primitive is deliberately unconnected: wiring unstable sources to it would
produce incorrect evidence. No saved image, selection, synthesis, programming
or hardware activation was performed.
