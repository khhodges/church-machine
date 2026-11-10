# Local qualification and build-only handoff

Local suite: **21 passed in 157.87 seconds**, with three existing Amaranth
monitor-domain deprecation warnings. Evidence:
`generated-artifacts/cooperative-retry-final.xml`.

- All-waiting: 12 pending-loop self-CHANGEs; renewals increased 15 → 17
  across the observation exchange.
- USER B: eight progress retirements; renewals increased 19 → 21.
- Both: one LLR, one successful retry, five exact destination writes, 128
  post-claim challenge bytes with matching nonce/CRC, unchanged accepted
  buffer and installed words, and no observed fault.
- Slow-UART negative control: confirmed watchdog expiry under trace
  backpressure while the diagnostic report owned UART; no step/recovery halt.
- Mid-CHANGE containment: real expiry at timer ages 200, 216 and 232,
  covering first/middle/last saved-word deadlines; exported writes suppressed
  at expiry and for the next 100 cycles.

## Downloadable package

`generated-artifacts/cooperative-retry-build-only.zip`

- Size: **7,331,393 bytes**
- SHA-256: `41c1c1105ebedb271d739697a004a754e8969c512d4b180b05a2bdd25f3327d4`
- Two independent manual-build directories: `user-b` and `all-waiting`.
- Each contains generated RTL, exact image, source snapshot, host responder,
  evidence, unchanged parent board/timing/DRC scripts, and a manifest verifier.
- The only export-only source change is the exact image hash accepted by
  `guarded_build_profile.py`; each variant rejects any altered image. Both
  tested-source and build-source maps are recorded, rather than claiming
  byte-identical maps.

`check_export.py` passed for both independently extracted variants: ZIP CRC,
clean verification, changed-image guard rejection, tamper rejection for image,
host, core, RTL, route script and evidence, negative timing, wrong vendor
version, receipt hash/flag correctness, and refusal to overwrite receipts.
All synthetic vendor outputs used by those checks were temporary and are
absent from the package.

The first export correctly rejected the inherited old fixture hash. Its partial
directory is retained as `generated-artifacts/cooperative-retry-build-guard-rejected`;
it is not a handoff package.

No Vivado run, BIT generation, remote connection, board programming, serial
transmission, Namespace mutation, production RTL change, or persistent-flash
operation was performed. Build and physical acceptance remain separate.
See [build-instructions.md](build-instructions.md) for the operator commands.
