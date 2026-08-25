---
name: Capability ABI result materialization
description: Runtime-bound capability APIs must deliver declared register outputs, including protected proof state.
---

For a dynamic LUMP, generated ABI metadata is a machine contract: every
declared capability result must be written to its CR and every scalar status or
result must be written to its DR. Returning a JavaScript result object alone is
not ABI delivery. Where an opaque capability requires proof material that does
not fit in the architectural GT word, retain that proof in protected
runtime-owned register state keyed to the CR while exposing only the GT in the
machine register.

**Why:** Otherwise a host-side test can consume a returned object while a
compiled caller cannot make the documented next call, silently splitting the
simulator API from the advertised LUMP ABI.

**How to apply:** When adding or changing a runtime-bound method, test direct
dispatch through the register-resident output, then test its failure path
clears the declared output register and writes a failure status.