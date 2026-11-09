# Resume/retry diagnostic build-only package

Archive: `generated-artifacts/resume-retry-build-only.zip` (3,464,469 bytes).
SHA-256: `c4984c9a2d815316b78c89f7b3738129df62b30038a531678c24440bcabab7f6`.

Manifest SHA-256:
`a4064fde8e1ae697cc2141897b3d84e8cae9725d12e7bb13569cbfa6c60c22e5`.

The package exports the isolated resume/retry top at 25 MHz with a 50 MHz
input clock, 57600-baud UART, guard 23971, and opt-in RETURN diagnostic stop.
The original first-handoff stop is disabled. The exact synthetic image hash is
`fe6e7cc5fe8d1ae99d840e77b762176a18b5d1d5888159576edb19d9abd19dc9`.

The included hardware source matches the locally tested candidate, except for
the package-private exact-image admission digest. No main production profile
was changed. Local RTLIL/Verilog export succeeded; this is not Vivado
synthesis or timing acceptance.

Verification accepted the package and rejected independently modified image
and Verilog files. Shell runner syntax passed; ZIP CRC and every archived
manifest file hash passed. The combined 18-case local evidence is included.

The retained runner requires Vivado 2026.1 on Linux, enforces a shared vendor
build lock and phase timeouts, and preserves board/clock checks, DRC-error
gates, precise setup/hold slack checks, and design-wide timing gates.
It records output hashes in a build receipt.

Expected terminal evidence: reason 3, NIA 0x400C, CR12 GT 0x02070004, DR12 13.
This marks a prepositioned body available; it is not a full loading service.
The execution watchdog remains absent.

No new BIT exists yet. The user runs the droplet build manually, in a fresh
directory. No JTAG, reset, upload or flash commands are included or authorized
by package delivery. Review the resulting timing and receipt before separately
approving physical testing.
