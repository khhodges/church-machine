# Church Machine — Development Image

Separate implementation of the approved memory-glass design. The original IDE
and canvas mockup remain unchanged.

## Data and authority

- The saved Namespace catalog and exact saved rows come from the Church Machine
  backend, not copied demo fixtures.
- Viewing this artifact does not bind, save, regenerate, activate, or install.
- `location` is the saved word address; descriptor `limit` is inclusive, so an
  allocation occupies `limit + 1` words. MMIO is not counted as ordinary memory.
- Named designs store allocation policy rather than literal addresses. Their
  glass uses Namespace Table's shared read-only layout calculation over exact
  hash-pinned selections, not a new binding operation. Original saved rows stay
  available separately; design allocations are not claimed as installed memory.
- The Original format does not record total capacity. Its 16,384-word reference
  scale is labelled as a reference rather than asserted as image evidence.
- An unfinished or location-free design stays inspectable without invented
  placements, newer LUMPs, or a fallback to another image.
- Send uses the existing native UART installer and exact retained, certified
  Namespace revision. It preserves authentication, profile compatibility,
  operator installation evidence, current target session, and confirmed-halt
  checks. It does not convert or approve unsupported candidate images.
- The operator must explicitly confirm runtime-memory replacement. Merely
  opening the app or its confirmation dialog never queues a command.
- Delivery, upload acknowledgement, and memory readback are different facts.
  This app never claims full readback or verified startup from an upload ACK.

## Run and test

Use the managed `artifacts/development-image: web` workflow together with
`Church Machine IDE`. Vite proxies `/api`, `/hardware`, and existing IDE/status
links to that backend.

```sh
pnpm --filter @workspace/development-image run typecheck
PORT=22382 BASE_PATH=/development-image/ pnpm --filter @workspace/development-image run build
python3 -m pytest tests/server/test_development_image_view.py tests/server/test_uart_profile_install.py tests/server/test_saved_namespace_catalog.py -q
node artifacts/development-image/test-browser.cjs
```

The browser test reads real development data for inspection checks. Its positive
transfer tests intercept all hardware and image APIs with isolated fixtures, so
it never submits a real FPGA command. Physical delivery still requires an
operator-authorized test on the actual board.

The production build can also be served at `/development-image/` by the existing
Python server. Build the artifact before serving this static route.
