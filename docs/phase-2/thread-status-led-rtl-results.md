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
Monitor clear authorization and its software/MMIO interface remain unimplemented:
simulation alone supplies a clear input, tied inactive outside simulation.

This does not establish general multi-Thread Hard Fault recovery. The existing
Wukong fault-recovery controller still holds core execution for fault capture
and explicit recovery. Its behavior was not redesigned by this LED integration.
The approved requirement that unaffected working Threads continue therefore
remains a system-level acceptance obligation, not a result of these LED tests.

No live artifacts, serving workflows, vendor builds, board contact, reset,
upload or flashing were performed. The installed LEDs retain their old behavior.
