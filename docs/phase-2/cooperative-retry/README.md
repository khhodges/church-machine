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

## Current acceptance

Both delayed-delivery cases now complete the full UART baseline and nonce
challenge exchange with the matching host state machine. The one-second
watchdog remains enabled throughout. Local UART uses 5,000 baud at a 20 kHz
clock; delivery remains delayed by three seconds. The board export remains
25 MHz / 57,600 baud.

The 2,500-baud fixture is retained as an expected-expiry regression. At expiry,
trace stall is asserted, UART owner is the diagnostic producer (7), and its
report request is held; step halt, step mode, snapshot busy and recovery hold
are all zero. This confirms report/trace bandwidth, not a hidden step halt, as
the remaining cause. No hardware exemption, timer change, dropped trace event,
or bypass of trace backpressure was introduced.

Real timer expiry is also tested at the first, middle and last saved-word
deadlines of an actual CHANGE. The test never forces internal timer signals.
DMEM, Namespace, C-list and pet-name exported write enables stay low for
100 cycles afterward, and the fixture memory stays unchanged during that
period. This is bounded mid-CHANGE containment evidence, not all-instruction
coverage or Boot recovery proof.

The matching host drains RX during its three-second delay instead of sleeping,
records all received bytes and attempted writes, refuses duplicate requests,
and verifies CRC, nonce, progress, renewals and unchanged buffer/memory.
Errors and short writes stop without reconnect or resend.

Final local evidence is `generated-artifacts/cooperative-retry-final.xml`.
Build-only export instructions are in [build-instructions.md](build-instructions.md).
No vendor build, physical result, or installation approval is claimed.

## Historical evidence and limits

Earlier terminal-only local run: **10 passed in 96.93 seconds**, recorded in
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

**Earlier candidate was not build-ready.** Those tests stopped at the parent's terminal
stop event. The parent's UART observation protocol does not report B progress
or watchdog renewal evidence, and its halted final state cannot continue
renewing an always-enabled timer. Do not reuse the old responder as acceptance
for this candidate. A watchdog-compatible observation/host protocol and
end-to-end evidence are still needed before export.

The 100-cycle write-suppression test does not qualify arbitrary mid-instruction
expiry, every write destination's accepted-write boundary, or Boot fault
recovery. The parent snapshot uses its historical held-fault diagnostic path;
this is not a production watchdog integration or healthy-Thread recovery proof.

### Earlier continuing observation candidate — qualification failed

The current preparation adds UCV3 reports with renewal, USER B progress,
pending-loop CHANGE, sticky fault, and remaining-tick fields. UCP3 challenges
check the accepted buffer and installed words again. USER A explicitly reloads
SYSTEM's Thread capability and yields after the retry; SYSTEM's continuation
then self-CHANGEs. The inherited terminal latch, forced step halt, and terminal
snapshot request no longer stop this isolated profile.

That earlier candidate was **not qualified**. Its full-top run was
`generated-artifacts/cooperative-retry-continuing.xml`: **1 passed, 2 failed**
in 108.91 seconds. Both delayed scenarios still reach WATCHDOG at NIA `0x400C`
during the extended observation: cycles 117,670 (all waiting) and 127,393
(USER B). The unrenewed SYSTEM expiry/write-suppression case passes.
The seven unchanged timer tests passed in the preceding run
`generated-artifacts/cooperative-retry-observation-wired.xml`.

Removing the additional forced step halt did not resolve the expiry.
UART report traffic competes with the inherited instruction trace stream,
whose backpressure halts execution; this was subsequently confirmed by the
signal capture described above. The failed evidence is preserved.

At that stage the serial responder and mid-instruction expiry tests were
still outstanding. Earlier failed candidates and XML files are
preserved; that source snapshot is
`generated-artifacts/cooperative-retry-continuing`.

The current locally qualified source snapshot is
`generated-artifacts/cooperative-retry-qualified`. The initial containment
harness failures are preserved too: it needed the standard post-instruction
settle cycles, had to exclude pre-watchdog Boot writes, and needed CHANGE's
busy signal rather than the distinct SWITCH signal.

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
