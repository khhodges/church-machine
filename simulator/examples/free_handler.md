# FreeHandler CLOOMC++ example

The implementation is **[free_handler.cloomc](free_handler.cloomc)**, not a
JavaScript/Python model. It uses the existing compiler's typed CLOOMC++ method
syntax and native instruction bodies, like the saved Mint implementation.

| Method | Input | Output |
| --- | --- | --- |
| Free64 | CR1 passkey, ignored | CR1 Inform RW, 64 words |
| Free128 | CR1 passkey, ignored | CR1 Inform RW, 128 words |
| Free256 | CR1 passkey, ignored | CR1 Inform RW, 256 words |
| Release | CR1 passkey ignored; CR2 target | NULL CR1 |

DR1: 0 success; 1 empty; 2 foreign target; 3 target not issued.
Private-state corruption hard-faults. The public methods retain their functional
names; native registers and queues are implementation details.

## Compile the first example

From the workspace root:

```sh
node scripts/build_free_handler_example.js --base-word 7168 --first-slot 32
node scripts/test_free_handler_example.js
```

Substitute numeric X and Y for the arguments to obtain B=X, FirstSlot=Y.
The generated directory contains:

- `FreeHandler-UNBOUND.lump`: compiled executable with embedded API.
- `FreeHandler.api.json`: the same API for inspection.
- `initial-state-le.bin`: the initialized private 64-word data block.
- `initial-objects-le.bin`: 1024 zeroed words for the eight objects.
- `setup.json`: exact object locations, required bindings, hashes and scope.

These are offline build outputs, not an installed Namespace image.

## Binding requirements

Use the normal trusted binding process, not arbitrary caller-supplied tokens.
C-list row 0 is SELF E; row 1 is private State RW; rows 2–9 are the eight
Inform Data RW object GTs in formation order. No scratch L, Namespace-write,
whole-pool or C-list-write grant is needed.

The source is independent of B and FirstSlot: those select destination
descriptors, not embedded physical addresses. The builder checks geometry,
not live vacancy. It does not select the executable or state slot automatically.
Provision both privately and nonoverlapping, with the matching object bounds
and a fresh sequence-zero origin. The executable allocation must include the
complete embedded API and C-list, not just instruction words.

Raw state and object data are not standalone header-bearing executable LUMPs.
The image validator's data-view restriction remains a separate installation
issue; this example neither bypasses nor changes it.

The canonical `.cloomc` source is the editable input; the generated binary is
unbound, so opening it alone is not a successful runtime setup. No saved IDE
catalog, selected boot image or live Namespace has been changed.

## Deliberately bounded first implementation

All four methods have executable bodies. Three distribute the prepared
inventory; Release validates by exact GT comparison and quarantines returns.
It does not revoke outstanding copies or replenish the free methods.

State retains the agreed ring representation. Because no refill exists, each
free ring is consumed in its initial order exactly once; its tail stays zero.
Generation is explicitly zero in this fresh example. Later refill must update
both versions and retained GTs through an approved protected interface.

Use one exclusive caller. Do not continue after a fault during state mutation,
reseed queues while issued GTs survive, or claim concurrent-call safety.
Return clears private working capabilities and retains only CR1.

Compilation and binary-contract checks are provided, not a new simulator.
They do not establish physical execution or frozen-BIT qualification. Hardware
upload, boot changes, RTL replay and background refill are not part of this work.
