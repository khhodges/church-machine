---
name: TPERM domain-purity SelfTest rule
description: Explains why a SelfTest must not execute a cross-domain TPERM and expect ordinary false-result control flow.
---

`TPERM` is an attenuation operation, not a boolean permission probe. A requested
permission set must be a subset of the capability's existing domain and
permissions. Otherwise the hardware takes the `DOMAIN_PURITY` fault path; it
does not complete with `Z=0`.

**Why:** The factory SelfTest's `TPERM CR0, X` against its Church-domain E-GT
reached the predictable `DOMAIN_PURITY` fault path on physical Wukong hardware.
The test source expected a normal failed condition and attempted to branch
afterward, which is incompatible with the hardware security contract.

**How to apply:** Keep cross-domain or authority-increasing TPERM cases out of
continuing resident self-tests. Same-domain exact mismatches may test the Z=0
path; cross-domain cases require a deliberately isolated fault test with an
explicit terminal expectation and snapshot handling. `TPERM CLEAR` is the
non-mutating valid-GT existence check and succeeds with Z=1 for any valid,
in-bounds non-NULL GT regardless of its current permission set.