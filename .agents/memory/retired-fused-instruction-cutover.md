---
name: Retired fused instruction cutover
description: Defines the hard-cutover and boot-load policy for removing ELOADCALL and XLOADLAMBDA.
---

Retire ELOADCALL and XLOADLAMBDA with no automatic translation. Existing source is corrected manually, and any remaining retired mnemonic must cause a recompilation error.

**Why:** This Phase 1 cutover was explicitly approved on 2026-09-15. A hard error exposes every stale use and prevents old authority or encoding semantics from being silently carried into extended CALL and LAMBDA.

**How to apply:** The Phase 1 boot load contains exactly CapabilityTest, SelfTest, and WukongCallHome. Manually correct and rebuild those three; reject old opcode-8/9 binaries on the new ISA.