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

## Integration boundary

Completion, fault and authorized monitor-clear inputs are synthetic in the
LED unit tests. The new unit has no scheduler, execution-enable, reset-request
or fault-record outputs: it cannot itself halt working Threads or erase their
fault records. Continued counting proves passive indicator behavior, not
end-to-end scheduler liveness.

The Wukong wrapper and core are unchanged. Before integration, connect exact
successful CHANGE completions (not attempts, stalls, or merely decoded
instructions), every relevant Hard Fault and the protected monitor clear.
Supply an ungated clock at the declared frequency. Monitor clear authorization
and its software/MMIO interface remain unimplemented, not bypassed.

No live artifacts, serving workflows, vendor builds, board contact, reset,
upload or flashing were performed. The installed LEDs retain their old behavior.
