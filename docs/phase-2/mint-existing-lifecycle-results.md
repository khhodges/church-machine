# Existing Mint lifecycle — bounded local RTL result

## Selected route

The user selected the existing lifecycle as the shortest testable route,
excluding Passcode authentication. This explicitly permits the bounded
CREATE/DESTROY check despite the earlier deferral of outdated Mint testing.
It does not authorize broad legacy cleanup, new GTMint hardware, live
provisioning or physical operations.

## Result

Command:

```sh
python3 -m pytest tests/hardware/test_mint_destroy_core.py -q --disable-warnings
```

Observed result: **4 passed in 95.50 seconds**.

| Case | Verified behavior |
|---|---|
| CREATE → write/read → DESTROY → CREATE → write/read | Exact DATA RW result, usable access, release, same-slot/storage reuse with advanced generation, all eight reused words zero before delivery |
| Read old GT after DESTROY | Machine rejects the invalidated descriptor with SEAL |
| Read old GT after reuse | Machine rejects the previous generation with VERSION |
| Write through a read-only GT | Machine rejects with PERM_W; target remains unchanged |

Release does not synchronously erase the object. The verified confidentiality
boundary is zeroing before reuse is delivered, not erasure at DESTROY.

## What changed

Only the disposable test harness changed:

- Retain the compiler-generated caller method table; current bootstrap CALL
  requires it just like other CALLs.
- Provide the current Mint source's reference-input C-list row explicitly.
- Compile a visibly test-only unchecked verifier instead of consuming the
  current production verifier, which now performs native comparisons.

The first run failed before Mint entry because the old caller fixture omitted
its method table. The final run exercised the real compiled Mint and Cleaner
through CALL/RETURN without changing their source or production RTL.
No machine permission, version or integrity checks were bypassed.

## Evidence boundary

- Execution uses ChurchCore's byte-addressed RTL model and disposable RAM.
- Service instruction and dispatch-table words remain exact compiler output.
  The harness asserts retired instruction equality and forbids code writes.
- Initial headers, descriptors, C-lists and boot context are synthetic fixtures,
  not an installed Namespace or a replay of saved LUMPs.
- Test caller privileges include inspection of internal state and explicit
  token scratch aliases. This is not a proof of private-view containment against
  hostile callers. Correct initial placement is not proof of exclusive custody.
- The verifier intentionally returns approval. No Passcode authentication,
  verified-originator attribution or production authorization claim follows.
- MakeOutform/MakeInform, exhaustion/wrap completeness, live integration,
  exact installed-image behavior and physical FPGA operation are not qualified.
- The proposed GTMint port and dedicated seventeenth GT.M are not used.

This establishes a working bounded existing lifecycle, not a complete deployed
Mint service or acceptance of the new hardware design.
