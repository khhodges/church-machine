# FreeHandler CLOOMC++ example

The implementation is **[free_handler.cloomc](free_handler.cloomc)**, not a
JavaScript/Python model. It uses the existing compiler's typed CLOOMC++ method
syntax and native instruction bodies, like the saved Mint implementation.

In the IDE, open the top-left menu → **Source Library**, search **FreeHandler**,
and click **Load**. The existing source-replacement confirmation protects your
current draft. The raw source is also served at
`/simulator/examples/free_handler.cloomc`.

| Method | Input | Output |
| --- | --- | --- |
| Free64 | CR1 passkey, ignored | CR1 Inform RW, 64 words |
| Free128 | CR1 passkey, ignored | CR1 Inform RW, 128 words |
| Free256 | CR1 passkey, ignored | CR1 Inform RW, 256 words |
| FreeCList | CR1 passkey, ignored | CR1 Inform LS, 64-entry C-list |
| FreeThread | CR1 passkey ignored; CR2 application Inform E | CR1 permission-free Inform Thread GT |
| Release | CR1 passkey ignored; CR2 issued Inform target | NULL CR1 |

The inventory is three 64-word, two 128-word and one 256-word data objects,
one 64-entry C-list, and one 512-word Thread. The application capability goes
into the new Thread's **saved CR1**, not CR0. Its offline-primed CR0 and
protected continuation identify Amoeba. FreeThread never starts the Thread.
The input application GT must pass ordinary SAVE transfer/B checks; the API
does not grant missing authority.

DR1: 0 success; 1 empty; 2 foreign target; 3 target not issued.
Private-state corruption hard-faults. The public methods retain their functional
names; native registers and queues are implementation details.

## Compile the first example

From the workspace root:

```sh
node scripts/build_free_handler_example.js --base-word 7168 --first-slot 32
node scripts/test_free_handler_example.js
node scripts/test_free_handler_execution.js
```

Substitute numeric X and Y for the arguments to obtain B=X, FirstSlot=Y.
The generated directory contains:

- `FreeHandler-UNBOUND.lump`: compiled executable with embedded API.
- `FreeHandler.api.json`: the same API for inspection.
- `initial-state-le.bin`: the initialized private 64-word data block.
- `initial-objects-le.bin`: 1536-word pool including alignment gaps and templates.
- `empty-clist-le.bin`: 128-word body containing a header and 64 NULL entries.
- `thread-template-UNBOUND-le.bin`: 512-word fresh Thread skeleton.
- `AmoebaStartup-UNBOUND.lump` and API: exact compiled startup dependency.
- `setup.json`: exact object locations, required bindings, hashes and scope.

These are offline build outputs, not an installed Namespace image.

## Binding requirements

Use the normal trusted binding process, not arbitrary caller-supplied tokens.
C-list row 0 is SELF E; row 1 is private State RW; rows 2–7 are the six
Inform Data RW GTs; row 8 is the C-list LS GT; row 9 is the permission-free
Thread GT. Row 10 is a **private S grant to that same Thread**, used only to
SAVE the application input into home 1. It is not returned to the caller.
No scratch, Namespace-write or whole-pool grant is needed.

The C-list requires both L and S authority. All 64 entries start
NULL, including the immutable row 0. Existing ISA rules permit ordinary SAVE
to rows 1–63; this example does not change that rule.

The simulator permits LS, while rejecting combinations of E with L/S and mixed
Church/Turing permissions. The source/API contract retains LS, not S-only.
This simulator correction is not a claim of physical hardware qualification.

Pool offsets are `0,64,128,256,384,512,768,1024`; allocation sizes are
`64,64,64,128,128,256,128,512`. Allocations total 1344 words and the pool spans
1536 words including alignment gaps. State and executable storage are separate.

The Thread uses the shared layout: 32 stack words, twelve tail capability
homes, canonical poison root and initial Amoeba Start continuation. Three
symbolic relocations in setup.json must receive the same trusted Amoeba E GT.
The supplied Amoeba artifact also needs its Boot.Thread supervisor binding.
Until these are resolved, the template is **not runnable**. Its saved CR1
stays NULL until FreeThread supplies the caller's application GT.

The source is independent of B and FirstSlot: those select destination
descriptors, not embedded physical addresses. The builder checks geometry,
not live vacancy. It does not select the executable or state slot automatically.
Provision both privately and nonoverlapping, with the matching object bounds
and a fresh sequence-zero origin. The executable allocation must include the
complete embedded API and C-list, not just instruction words.

Raw state and data objects are not standalone header-bearing executable LUMPs.
The C-list and Thread templates do carry their respective headers.
The image validator's data-view restriction remains a separate installation
issue; this example neither bypasses nor changes it.

The canonical `.cloomc` source is the editable input; the generated binary is
unbound, so opening it alone is not a successful runtime setup. No saved IDE
catalog, selected boot image or live Namespace has been changed.

## Deliberately bounded first implementation

All six methods have executable bodies. Five distribute the prepared
inventory; Release validates by exact GT comparison and quarantines all eight
objects regardless of kind.
It does not revoke outstanding copies or replenish the free methods.

State retains the agreed ring representation. Because no refill exists, each
free ring is consumed in its initial order exactly once; its tail stays zero.
The C-list and Thread each use their private object-state word for one-shot
availability. Generation is explicitly zero in this fresh example. Later refill must update
both versions and retained GTs through an approved protected interface.

Use one exclusive caller. Do not continue after a fault during state mutation,
reseed queues while issued GTs survive, or claim concurrent-call safety.
Return clears private working capabilities and retains only CR1.

Compilation, binary-contract and isolated instruction-execution tests are
provided, using the existing simulator rather than a new queue model.
Instruction tests stop at the authored RETURN; they do not certify the full
Thread activation journey, physical execution or frozen-BIT qualification. Hardware
upload, boot changes, RTL replay and background refill are not part of this work.
