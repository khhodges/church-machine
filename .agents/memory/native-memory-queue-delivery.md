---
name: Native memory queue delivery
description: Required execution boundary for the isolated CLOOMC FIFO/TRANSFER allocator
---

The requested memory-queue solution must execute its services in native CLOOMC,
not in a JavaScript/Python allocator or host service callback. Documentation or
passing component probes alone must not be presented as functional completion.

**Why:** The user explicitly clarified that a functional CLOOMC solution is the
objective, while retaining the requirement to report genuinely missing approved
mechanisms instead of faking surrender or introducing a new ISA.

**How to apply:** Host code may compile, provision disposable offline fixtures
and drive the faithful simulator. It must not perform allocation, versioned
release, queue transfer or Cleaner service execution. Keep historical prototype
evidence distinct from the new independent-Thread lifecycle.

For the new memory queues, resolve the GTMint interface first rather than
substituting the historical private RW/L result-memory construction mechanism.

**Why:** On 2026-11-11 the user explicitly selected “Resolve GTMint interface
first” when offered those two implementation paths.

**How to apply:** Preserve old prototype evidence but do not treat its earlier
bounded approval as permission to choose that path for the new queues. The user
subsequently resolved the construction path as SecurityMonitor.Create(GTvars):
pack a data word and read it back as a GT under the monitor's M authority.
See gt-construction-port.md for that clarification. No FPGA approval follows.

Native-service evidence must distinguish machine instruction modeling from host
implementation of the requested services.

**Why:** A faithful JavaScript simulator necessarily models hardware operations,
including reconstruction of executable views at CALL/RETURN. Banning every
internal GT helper indiscriminately can reject legitimate native execution
instead of detecting a host allocator.

**How to apply:** Prohibit host creation of the requested allocation/result
authority and host lifecycle callbacks. Permit only the simulator's existing,
specifically constrained machine operations; never use that exception to
construct the service's DATA result or advance its version.
