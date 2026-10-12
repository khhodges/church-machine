# Target Namespace device aliases

The user authorized preparation, not installation, of:

- `kjhh1.LED0` → `LED_DEV`
- `kjhh1.UART_TX` → `UART_DEV`

`scripts/prepare_namespace_device_aliases.py` creates a review-only addendum to
the exact frozen Namespace layout review. It verifies the parent digest and
every frozen input before selecting unique destination descriptors. The aliases
are scoped to that parent Namespace revision, not a global alias cache.

The current frozen target places LED_DEV at slot 3, version 0, and UART_DEV at
slot 8, version 1. These are existing **proposed** descriptors; the addendum
does not move UART or advance its version. Historical live UART slot 2 is not
the destination: slot 2 in the target layout is the entry Thread.

No permissions or GTs are minted. No saved catalog, artifact, configuration,
resident policy, running Namespace or hardware is modified. This is not a
runtime schema cutover. Destination serialization, linking and combined SWITCH
acceptance remain unfinished; approving the alias names does not approve execution.

Reproduce in a new output directory:

```sh
python3 scripts/prepare_namespace_device_aliases.py \
  generated-artifacts/namespace-layout-review \
  generated-artifacts/namespace-device-aliases
```
