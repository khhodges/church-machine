# Authored Thread startup — RTL regression

Run:

```sh
python3 -m pytest tests/hardware/test_authored_thread_startup.py -q
```

## Evidence boundary

This is an isolated **Amaranth RTL scheduler replay**, not JavaScript simulator
execution, full-core boot acceptance, vendor synthesis, or physical-board
evidence. It does not program an FPGA, publish artifacts, or modify the user's
Namespace. All server generation and provenance writes use a temporary catalog.

The public `generate_boot_image` path validates and applies two approved-design
inputs through `thread_initial_design`, with 256/32 and 512/64 word allocation/
stack geometries. All sixteen saved DR words differ between the Threads, as do
their tuple heaps and Alice/Mallory CR1 capabilities (nonzero versions 3 and 4).
The second Thread has a custom SelfTest CR0 continuation instead of the default
CapabilityTest continuation.

The tests compare the resulting bodies with `built_thread_view.inspect_threads`,
including named capability targets, geometry, registers, heap words, and both
root/resume entry words. A separate one-design case checks that the other two
Thread bodies remain unchanged.

Preparation uses newly generated, authenticated temporary evidence, not mutable
live runtime state. Older default entries and geometry must not overwrite either
approved initial design. Conversely, an unowned Thread's explicitly prepared
continuation is retained without importing its modified runtime DR value.

## Exact-image scope

The server image has a descending, word-addressed Namespace. The legacy
`ChurchChange` RTL consumes a forward, byte-addressed Namespace. The test uses
the production `build_wukong_upload_image` projection, asserting complete
byte-for-byte equality of **every generated Thread body** before replay.

That projection does not copy every selected non-boot resident. Before freezing
the isolated RTL fixture, the test explicitly copies the exact generated
SelfTest, Alice and Mallory allocations and their original authority/cache
words into disjoint native-memory locations, re-sealing only relocated
descriptor addresses. This is fixture provisioning, **not evidence that the
public upload path includes those dependencies**. No executable instruction or
Thread word is rewritten. The RTL bus subsequently reads the frozen image
directly, without address translation, synthesized responses, or lazy loading.

Each secondary Thread is entered independently through the real `ChurchChange`
FSM with no outgoing owner. Assertions cover restored DRs, CR0/CR1 identities
and resolved locations, derived CR6/CR14 views, PC-zero continuation, CR5 heap
bounds, and unchanged heap contents. The only allowed memory write is that
Thread's protected STO consumption; every other image word must remain equal.
This stops at first entry: it does not execute Alice/Mallory methods, claim
full-core DR0 semantics, or prove fault recovery or inter-Thread scheduling.

## Adjacent checks

The related initial-design and built-view tests pass (the endpoint test requires
isolated-server mode and is skipped without it). In the existing
`tests/boot/test_prepared_thread_entries.py` suite, two checks currently fail
independently of this new test:

- `test_independent_entries_not_runtime_state` changes an entry without updating
  all canonical initial-frame words, so image validation rejects it.
- `test_exact_selected_saved_root_faults_but_initial_frames_run_five_loops`
  expects `STACK_UNDERFLOW` from the retained image but observes `PERM_L`.

Those assertions have not been weakened or changed.
