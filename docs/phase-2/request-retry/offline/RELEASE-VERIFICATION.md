# Local GPL release preparation — 2026-11-10

This is a preparation record, not publication approval or a new hardware
result. No historical input was edited. No hardware was operated.

## Verified candidate

- Local output: `generated-artifacts/request-retry-offline-gpl-combined/`
- Archive: `request-retry-offline.zip`, 44917 bytes
- SHA-256: `f0fde1a4eb2090bba7630aa972915673f7ddf2668ea5e28fc865b320c6a89061`
- Adjacent `SHA256SUMS` matches the archive.
- Adjacent `manifest.json` records the source/evidence inventory.
- 17 ZIP members: the 16 files listed in SOURCE.md plus manifest.json.
- ZIP integrity check passed; exact member-set, every size and every SHA-256
  matched the manifest.
- All six original pinned input hashes still matched repository/upload bytes.
- COPYING matched both GNU's downloaded GPL-3.0 text and the system copy:
  35149 bytes, SHA-256
  `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`.

## Checks performed

`python3 -B -m unittest discover -s docs/phase-2/request-retry/offline -p 'test_*.py'`
passed all 23 tests, including the newly merged independent reader tests.
These include standalone replay with site packages
disabled, standalone repacking identical to the original ZIP, repeated-build
identity, no overwrite, pinned historical inputs, sanitization scope, tampered
hash rejection, semantic evidence mismatch rejection, compliance-source
inclusion, and unexpected-directory/symlink rejection.

The final candidate also passed offline replay: RX 302212, TX 188, two
attempts and completions, expected frame offsets, CRC and snapshot.
The independent reader and its guide were preserved during integration;
both initial packaging and standalone repacking run that reader as well.
The explicit inventory excludes vendor binaries/checkpoints/reports, serial
driver, credentials, keys, environment files and unrelated uploads. References
inside the unchanged historical report are not included artifacts.

Generated output remains excluded by both .gitignore and .replitignore.
This record is outside the archive to avoid a self-referential archive digest.
No old archive was replaced. Future builds after source changes require a
new directory, new verification and a new digest. A future public release
still requires separate authorization; these checks do not independently
verify title or patent ownership.
