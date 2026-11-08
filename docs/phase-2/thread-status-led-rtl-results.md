# Thread status LEDs — bounded local RTL trial

## Result

```sh
python3 -m pytest hardware/test_thread_status_leds.py \
  hardware/test_wukong_thread_scheduler_contract.py::test_full_core_failed_thread_switch_preserves_source_context \
  -q --disable-warnings
```

Observed: **10 passed, 5 warnings in 5.52 seconds**.

The new isolated `ThreadStatusLEDs` unit implements:

- Two-bit successful-CHANGE completion counter, modulo four; LED0 is low bit.
- Active-low pin outputs.
- Latched Hard Fault display, both LEDs blinking at 2 Hz independently of
  completion pulses. A sustained fault does not continually restart the blink.
- Counting continues behind the fault display.
- Explicit monitor clear restores the current count; a simultaneous fault wins.
- Explicit board reset initializes the count and indication.

Nine unit cases cover normal counting, idle cycles, wrapping, active-low
polarity, fault blinking with no completions, sustained faults, continued
completion counting, clear/re-latch/priority, reset and invalid clock parameters.
The modeled failed CHANGE supplies no successful-completion pulse.

The tenth case is an unchanged existing full-core regression: a rejected target
Thread switch preserves the source context, and the pending source instruction
subsequently executes. This is not a general multi-Thread Hard Fault recovery
test and must not be described as one.

## Core and candidate-wrapper integration

The next authorized local trial connects the LED unit to an observation-only
core completion pulse and the real core fault signal. The completion pulse
captures decoded CHANGE ownership at acceptance, then emits only on successful
completion. It includes the boot CHANGE and excludes external scheduler requests,
SWITCH and internal LLR handoffs. It does not infer success from opcode decode
or instruction-retirement activity alone.

`hardware/test_thread_status_leds_core.py` provides five passing integration
cases, verified in core-harness and full-wrapper selections:

- Real decoded CHANGE increments exactly once; target code executes.
- External scheduler handoff executes target code without incrementing the
  instruction counter.
- A real failed CHANGE sets the fault indication without incrementing; blink
  continues after the fault pulse. Clearing preserves retained core diagnostics.
- Full Wukong candidate LED pins display the real successful count.
- Full Wukong candidate LED pins blink after a real CHANGE fault and restore
  the count on a simulation-only monitor-clear stimulus.

The final full-wrapper selection passed **2 tests in 13.31 seconds**.
The unchanged scheduler contract suite then passed **51 tests in 66.25 seconds**:

```sh
python3 -m pytest hardware/test_thread_status_leds_core.py -k candidate -q --disable-warnings
python3 -m pytest hardware/test_wukong_thread_scheduler_contract.py -q --disable-warnings
```

The full wrapper uses its real UART trace backpressure; tests allow time for
trace output rather than bypassing execution holds. Clock/baud are scaled for
local simulation. Memory is a synthetic Thread fixture, not a saved release image.

## Remaining integration boundary

Completion, fault and authorized monitor-clear inputs are synthetic in the
LED unit tests. The new unit has no scheduler, execution-enable, reset-request
or fault-record outputs: it cannot itself halt working Threads or erase their
fault records. Continued counting proves passive indicator behavior, not
end-to-end scheduler liveness.

The Wukong wrapper enables the new display only with the explicit
`phase2_status_leds=True` candidate option. Default builds retain the existing
display until release selection. The status unit uses the normal ungated sync
clock and cannot drive execution controls. CM reboot and skip do not clear it.
The original trial supplied clear only in simulation. The subsequently approved
protected DWRITE interface now supplies it in candidate hardware too; see below.

This does not establish general multi-Thread Hard Fault recovery. The existing
Wukong fault-recovery controller still holds core execution for fault capture
and explicit recovery. Its behavior was not redesigned by this LED integration.
The approved requirement that unaffected working Threads continue therefore
remains a system-level acceptance obligation, not a result of these LED tests.

No live artifacts, serving workflows, vendor builds, board contact, reset,
upload or flashing were performed. The installed LEDs retain their old behavior.

## Protected monitor-clear implementation

The approved contract and delegated address choice are recorded in the
[address map](hardware-address-map-and-diagnostic-mmio.md#protected-monitor-clear-port-at-0xffffff19).
The chosen port is `0xFFFFFF19`. Exact one-word W capability admission occurs
in DWRITE, with a dedicated completion pulse carried by ChurchCore to the
opt-in wrapper display. No live capability is provisioned. The test-only
clear stimulus remains available for the original isolated fault-display test;
it is not the production path.

```sh
python3 -m pytest hardware/test_monitor_clear.py -q --disable-warnings
```

Observed: **18 passed**. Cases cover exact successful admission, disabled
feature, invalid payloads/reserved bits, NULL and missing W, Abstract and
oversized capabilities, nonzero offsets, neighboring-base access, accepted
input capture, denied read without DR write, and no clear from neighboring
or legacy-aliased addresses. A core test creates a real fault record and then
executes the clear instruction, checking preserved diagnostic fields/count and
subsequent healthy instruction execution without reset. A full-wrapper test
executes DWRITE using a synthetic grant and observes the hardware clear wire
with the simulation-clear input held zero.

The existing LED tests cover simultaneous fault/clear priority, a concurrent
CHANGE completion, relatching, and uninterrupted counting behind the display.
The LED unit/core-wrapper suites and DWRITE acceptance-capture regressions
passed in the combined run. The unchanged scheduler-contract suite subsequently
passed **51 tests in 55.25 seconds**; `git diff --check` was clean.
These remain bounded local tests, not evidence of live SecurityRegulator
provisioning or general multi-Thread recovery. In particular, the full-wrapper
instruction test clears an already-clear indication; recovery from a captured
fault still depends on the separately tracked fault-hold work.

The broader `tests/hardware/test_data_access_full_width.py` run has two
pre-existing failures in its `65536-0-1-True-4096` read/write cases: the fixture
uses the retired immediate-mode encoding, whereas current units decode indexed
plus/minus offsets. Replaying the unchanged HEAD versions of DREAD/DWRITE
reproduced both failures (24 other cases passed). They are not changed here.
