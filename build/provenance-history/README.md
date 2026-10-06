# Preserved, non-release provenance

`church_wukong_xc7a100t.unverified-2026-10-06.json` preserves the exact
unverified record that had replaced the build-20 release record. It is
diagnostic evidence, not approval to release or flash a new FPGA build.

The canonical `../church_wukong_xc7a100t.provenance.json` is the original
verified record recovered byte-for-byte from Git commit
`a7c07570`. Its `.bit` and `.mcs` SHA-256 hashes and sizes match the existing
programming files; its source commit and build version match the unchanged
`.bit.meta.json` sidecar.

The restored record describes the historical build, not the current source
tree or the newer generated `.il` and `.v` files. Those newer inputs remain
unchanged and are not certified by restoring the historical release record.
No FPGA binary, Namespace, boot image, or hardware installation was changed.
