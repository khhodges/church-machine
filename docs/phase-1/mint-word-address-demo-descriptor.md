# Unchanged-BIT Mint demo: descriptor-only adaptation

This is a demonstration-specific exception to the general byte-address W0
contract, not an architectural migration or a deployable Mint service.

Target BIT SHA256:
`a4acb0ef9a39ba985d7769031cf146edb68fb65ff96e0b4f4a895093b54e5d4e`.

`scripts/mint_word_address_demo.js` derives an isolated instruction program from
the current Mint private slot package. It does not edit the original source,
compile a full service, or write an image. Required source anchors must occur
exactly once; missing or duplicated anchors fail explicitly. This is a structural
guard, not a compiler attestation or complete source-version approval.

## Candidate behavior

- DR8 enters as a physical byte address; validate alignment before conversion.
- Require the complete allocation to fit the target's 16,384-word resident RAM.
  This geometric check is not evidence of ownership, free space, or safe placement.
- Preserve existing size, slot, history, sequence and retirement checks.
- On success only, convert DR8 to a word address before integrity calculation.
- W1 remains inclusive word limit plus sequence at bit 21, with F/G zero.
- W2 covers the encoded W0; W3 remains the issued GT.
- DR12 indicates descriptor readiness only. DR1 stays zero: CREATE is incomplete.
- Retired and rejected inputs do not receive a converted W0.
- No Namespace publication, allocator calls, capability issuance or DESTROY.

Cleaner state and its returned physical byte address contract are unchanged.
MMIO values are rejected here rather than converted into resident allocations.

## Software checks

Run:

```sh
node simulator/test_mint_word_address_demo.js
node simulator/test_mint_slot_descriptor.js
```

The demo checks execute assembled instructions in disposable simulator memory:
six valid cases, fourteen invalid cases, two retirement cases, and three source
drift cases. They check encoded integrity, GT identity, RAM endpoints, preserved
capabilities/context, and absence of non-register-home memory writes.

The existing byte-address package separately passes its 32 reference cases and
eight invalid cases. Its Python reference computes values; it does not run RTL.

These are component checks only. They do not exercise the frozen FPGA gate,
full CREATE, UART, Thread startup, live provisioning, or physical hardware.
No RTL simulation was run. A complete caller/service binding design and image
remain separately reviewed steps; omitted acceptance checks are not passed.
