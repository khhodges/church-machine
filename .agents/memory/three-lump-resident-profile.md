---
name: Three-LUMP resident profile
description: Validate the three initial abstractions before slot-lifecycle changes; historical boot profiles do not impose catalog reservations.
---

The three initial abstractions must be confirmed valid before implementing
changes to clearing, reassignment, and reloading.

**Why:** The user explicitly requested this prerequisite for removing legacy
slot restrictions. A correct initial set must be established first, not
assumed from catalog membership.

**How to apply:** Identify the exact initial artifacts from authoritative saved
configuration, then inspect their PetNames, immutable identities, bytes,
structure, and required bindings without modifying them. Missing PetNames
require programmer recompilation. Report evidence and blockers before
continuing; this validates LUMPs, not a capability-invalid state.

An explicit approved boot profile remains distinct from catalog-derived
membership. Historical fixed-slot boot profiles are not a general restriction
on the requested clear/reload lifecycle.

Phase 1 software loading should use a complete top-to-bottom runtime memory
reload, including a full copy of the baseline Namespace and resident code.

**Why:** The user explicitly chose the easiest loading approach, accepting
replacement of baseline-initialized memory rather than requiring incremental
installation or preservation of the running Namespace.

**How to apply:** Define and test the complete image in the simulator first.
Treat loading as a stopped, fresh-start operation, not live replacement.
Distinguish runtime memory replacement from FPGA configuration programming;
do not add a resident incremental loader as a Phase 1 prerequisite. This design
choice does not itself authorize a physical board upload.

The two Phase 1 layouts mean one minimal baseline and one full development/test
layout including a copy of that baseline.

**Why:** The user explicitly selected this interpretation when asked, rather
than two alternative placements of each code base for portability testing.

**How to apply:** Keep the two deliverables distinct; do not reinterpret this
as concurrent Namespaces or a requirement for duplicate placement variants.

Phase 1 must separate the FPGA bitstream with a minimal Namespace of resident
LUMPs from reprogrammable LUMPs undergoing development and test.

**Why:** The user explicitly requested this separation so the hardware baseline
is not coupled to the developing software inventory.

**How to apply:** Keep resident membership an explicit reviewed minimum, not a
catalog-derived list. Distinguish hardware-baseline acceptance from reloadable
software testing; this scope decision does not authorize rebuilding or flashing
hardware or changing current Namespace assignments.

**Why:** Manifest history can contain duplicate or newer-looking artifacts;
neither that history nor old fixed-map conventions may silently choose or
reserve the next Namespace's assignments.

**How to apply:** Preserve exact saved selections and historical approvals.
Keep architecture/hardware profile requirements explicit and separate from
generic Namespace editing.

The three-LUMP infinite loop (3LL) must include an open-ended breakout option.
The bootstrap/test profile must not become a permanent restriction on which
programs, abstractions or hardware drivers can run.

**Why:** The user explicitly requires that Phase 1 preserve open-ended progress,
using breakout from the 3LL as the concrete example.

**How to apply:** Treat a capability-checked handoff beyond the fixed loop as an
alignment requirement, not merely a future enhancement. Do not hard-code a
closed list of future targets or require an ISA change for each new program.
Preserve cooperative scheduling, validation and recovery rules. The trigger,
target-selection authority and continuation semantics still need specification;
this requirement alone does not authorize a saved-LUMP replacement or FPGA flash.

The breakout must be reprogrammable, not a hard-coded escape to another fixed
program. IDE reload and lazy loading must be considered as delivery mechanisms.

**Why:** The user explicitly clarified that open-ended progress requires changing
the breakout destination and brought IDE reload/lazy loading back into scope.

**How to apply:** Separate target selection, code delivery/admission, and safe
activation. Do not claim that configurable dispatch alone provides new-code
loading. Preserve the distinction between a stopped, validated fresh bootstrap
image and live Namespace rebind/re-sequencing; the latter exceeds the frozen-base
T === GT simplification. No choice of delivery mechanism has yet been approved.

The user expects the evolved 3LL to remain a pre-application hardware-check
stage, with a reprogrammable breakout potentially selecting a new set of
application Namespaces.

**Why:** Open-ended application delivery must not remove the startup diagnostic
role; applications follow the required checks rather than bypassing them.

**How to apply:** Separate the trusted diagnostic/bootstrap context from
application Namespace selection and entry-Thread activation. A pass establishes
only the specified diagnostic coverage, not absence of all hardware defects.
Keep application admission and hardware diagnostics distinct. The Namespace
transition, diagnostic rerun policy, return and fault-recovery behavior remain
to be specified; do not interpret this as a mandate to rerun 3LL at every
cooperative Thread switch or as authorization to replace CR15 arbitrarily.

The user calls for a standardized Namespace handoff that is safe and easy to use.

**Why:** Reprogrammable breakout should not require each application or delivery
mechanism to implement privileged transitions independently.

**How to apply:** Design a common checked activation contract for IDE delivery
and future lazy loading, keeping delivery separate from authority to activate.
The exact API, descriptor layout and low-level transition sequence remain
proposals until reviewed; do not invent a new ISA instruction by implication.

The user selected a System Namespace as the first handoff destination and system
validation environment before application Namespaces.

**Why:** It must prove the handoff and exercise lazy loading, cooperative
multithreading, Namespace garbage collection, I/O extensions (Ethernet, HDMI and
others), and application rules/contracts before relying on them for applications.

**How to apply:** Use the System Namespace to organize explicit per-feature
evidence, not just another fixed loop. Separate mandatory startup diagnostics
from development/system suites and application-specific requirements. Do not
equate this scope with approval of every ABI, dynamic lifetime mechanism or an
extra resident LUMP. Preserve reprogrammable selection and common activation.

IDE tunnels and networked Church Machines are explicit System Namespace and
alignment scope, not merely implied by the Ethernet driver.

**Why:** The user specifically requested that both be called out.

**How to apply:** Track tunnel/session and CM-to-CM authority tests separately
from physical network connectivity, including reconnect, peer restart and
cross-machine identity. Do not carry local bootstrap T === GT across machines.