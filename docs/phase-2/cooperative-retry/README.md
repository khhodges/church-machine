# Cooperative retry: isolated local candidate

The operator approved a fixed, enabled execution watchdog with no software
control access for this diagnostic. This does not approve a general watchdog
control ABI or SecurityRegulator provisioning.

The candidate is reconstructed from the hash-verified request/retry build-only
source snapshot. Production RTL, saved LUMPs, Namespace state, remote builder,
and the physical board are unchanged.

## Implemented locally

- Fixed one-second ungated-clock timer; no software control/exemption port.
- Execution start and real successful CHANGE/SWITCH completion wiring.
  The internal LLR uses the same completed CHANGE event.
- Expiry takes precedence over renewal; watchdog fault is lower priority than
  existing same-cycle instruction faults.
- Expiry blocks exported DMEM, Namespace, C-list, and pet-name-memory writes.
- SYSTEM polls the real UART receiver and copies/publishes the fixed response
  only after acceptance.
- Pending USER A is not selected. In one fixture SYSTEM selects USER B, which
  increments DR11 and voluntarily returns. In the companion fixture SYSTEM
  executes CHANGE CR12 while A waits.
- B's Thread GT is reloaded through SYSTEM's C-list before each dispatch;
  scratch CR5 is not assumed to survive CHANGE/LLR.

## Evidence and limits

Final combined local run: **10 passed in 96.93 seconds**, recorded in
`generated-artifacts/cooperative-retry-local.xml`.

Passing evidence:

- Seven fixed timer tests: idle, expiry, renewal, expiry equality, sticky expiry,
  and elaboration with 25/50 MHz one-second periods.
- One full-top no-response test: an unrenewed SYSTEM loop emits WATCHDOG and
  exported memory write enables remain low for the next 100 cycles.
- Two full-top delayed-delivery cases: 60,000 cycles at 20 kHz (three watchdog
  intervals), with real UART pins and real CHANGE instructions. USER B advances
  while A waits, or SYSTEM self-CHANGE keeps executing with no eligible USER.
  Both reach one successful retry with exactly the five expected writes.

Evidence files under generated-artifacts:
cooperative-retry-watchdog-unit.xml, cooperative-retry-preflight.xml,
cooperative-retry-delayed.xml, cooperative-retry-delayed-scaled.xml,
cooperative-retry-delayed-reload.xml.

Preserved failures: the first 10 kHz/1250 baud simulation exceeded its
one-second execution interval during the copy; the 20 kHz/2500 baud fixture
removed that artificial transfer-time bottleneck without changing the timer
policy. The B fixture initially assumed scratch CR5 survived LLR and correctly
faulted THREAD_PERMISSIONS. Its explicit C-list reload fixed that fixture.
The original failed XML results are retained.

UART monitor-domain inheritance emits an Amaranth future-0.6 deprecation warning.
The combined run also emitted two pytest xunit2/record_property compatibility
warnings; both cooperative-result properties are present in the XML.

At terminal observation the all-waiting fixture had completed seven SYSTEM
pending-loop self-CHANGEs. The second-USER fixture had completed five dispatches
and five USER B progress-instruction retirements. Each fixture recorded one
LLR completion and one retry retirement, with 13,163 watchdog ticks remaining.

**Not build-ready.** Successful tests currently stop at the parent's terminal
stop event. The parent's UART observation protocol does not report B progress
or watchdog renewal evidence, and its halted final state cannot continue
renewing an always-enabled timer. Do not reuse the old responder as acceptance
for this candidate. A watchdog-compatible observation/host protocol and
end-to-end evidence are still needed before export.

The 100-cycle write-suppression test does not qualify arbitrary mid-instruction
expiry, every write destination's accepted-write boundary, or Boot fault
recovery. The parent snapshot uses its historical held-fault diagnostic path;
this is not a production watchdog integration or healthy-Thread recovery proof.

No new vendor package, BIT, physical result, or installation approval exists.

## Local commands

```sh
python3 docs/phase-2/cooperative-retry/prepare_candidate.py
cd generated-artifacts/cooperative-retry-candidate
PYTHONPATH="$PWD:/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages" \
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest \
  /home/runner/workspace/docs/phase-2/cooperative-retry/ \
  -q -p no:cacheprovider \
  --confcutdir=/home/runner/workspace/docs/phase-2/cooperative-retry
```

Preparation refuses an existing directory; preserve earlier candidates and
use --output with a fresh path for changed integration sources.
