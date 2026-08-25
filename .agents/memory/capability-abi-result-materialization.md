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

For a native-bound dynamic LUMP, a source-level success branch must test the
declared capability register (for example, `CR0 != null`), not infer authority
from a nonzero DR status. If the static ISA cannot inspect a CR directly, its
serialized fallback must fail closed and the native binding must remain the
only evaluator of the live capability predicate.

**Why:** Bank error codes are nonzero too, so a DR0 truthiness check would
mistake a failed validation or commit for usable authority.

**How to apply:** Preserve the CR presence predicate in the embedded canonical
source, serialize only an explicit native-bound, fail-closed fallback, and
test that diagnostic registers are never substituted for capability authority.