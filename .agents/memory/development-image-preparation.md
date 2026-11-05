---
name: Development Image preparation authority
description: Development builds must use the latest compilation of every included LUMP; historical replay and physical transfer remain separate.
---

## Governing development-build rule (2026-11-05)

The user requires: “the development image must be built from the latest copy
of each and every LUMP of any kind.” Every included LUMP uses its latest
compilation, including system, application, Thread and Namespace LUMPs and
their dependencies. An older saved selection, cached binding, historical build
or private candidate must not override a newer compilation.

**Why:** A corrected WukongCallHome went into an isolated image used for a
bitstream while the saved Development Image still selected an older compiled
copy. The user rejected this split as an unacceptable development workflow.

**How to apply:** This supersedes the former saved-binding-only/no-rebinding
rule for NEW Development Image builds and the explicit-adoption rule where it
would retain older development inputs. Resolve a coherent latest input set,
rebuild derived bindings/layout as needed, and preserve exact identity evidence
for the resulting build. A cache is usable only if it matches those inputs.
Do not silently fall back to an older compilation to hide an error. Distinguish
historical exact-byte replay from a new development build; keep history immutable.
Source revision and compiler identity jointly define freshness: unchanged
source can require different instruction bytes after a compiler correction.

Fresh builds must reuse the normal compiler's authenticated source and
relocation contracts, including unresolved SELF, rather than treating an old
binding snapshot as authority or manufacturing replacement capabilities.
**Why:** A private build must not become a second, less strict compiler-admission
path merely because it does not publish its intermediate LUMPs.

Image construction does not itself authorize physical transfer, FPGA
reprogramming, or replacing an image already running. Preserve authentication,
target/session checks, transfer serialization and replacement consent.
Do not add a manual installed-BIT certification gate; the existing programmer
compatibility-choice rule below still applies.

Keep the operator's goal focused on loading the new development image.
**Why:** The user corrected a diversion into UI cleanup and a separate
“Amoeba retry readiness” exercise when they were trying to load a new image.
**How to apply:** Distinguish an inspection-only historical image from the saved
design to be prepared and sent; do not substitute the historical image as the
upload target or turn the loading workflow into unrelated maintenance work.

The user requested a one-button operation on Build Approval for loading the
selected development image.
**Why:** Many competing build, install, UART, and download buttons obscured the
actual task. Preparation and compatibility checks belong inside the loading flow.
**How to apply:** Keep one primary loading action, with advanced maintenance
separate and collapsed. Preserve explicit runtime-memory replacement confirmation;
selection, navigation, and refresh alone must never initiate a load.

Development-image loading must not require a manually certified installed-BIT
record or a fresh operator compatibility approval.
**Why:** The user explicitly said “Its the programmers choice to make mistakes
dont get in the way” after the hidden installation-record gate blocked loading.
**How to apply:** Treat installed-bitstream compatibility as the programmer's
responsibility, not a veto. Retain authorization, exact-byte/target delivery,
transfer serialization and replacement consent. This supersedes the earlier
manual installation-evidence requirement for this loading flow.

For unavailable Send operations, disable the button and explain the reason on
hover or keyboard focus, rather than displaying the verbose connection warning.
**Why:** The user identified the UART/authorization/live-session warning beneath
Send as confusing and explicitly requested a disabled button with a popup.
**How to apply:** Use a short, actionable explanation; retain actual transfer
results and server-side enforcement without exposing internal security bookkeeping.

Attempt automatic recovery before asking the operator to correct a disabled
Send action, then give specific help if it remains unavailable.
**Why:** The user requested guidance rather than a disabled dead end, with the
IDE trying automatically first.
**How to apply:** Retry safe connection checks, observe automatic bridge recovery,
and re-enable Send when live evidence returns. Never describe polling as repairing
credentials, auto-approve unknown authority, or automatically retry a transfer.

Explicit image replacement consent includes obtaining the board's STOP
acknowledgement automatically before upload; do not require a separate manual
STOP or ask the operator to race an acknowledgement expiry.
**Why:** The user reached Send after reconnecting but was blocked because the
one-button flow never obtained the installer's required fresh stop evidence.
**How to apply:** Prepare first, stop the exact target, correlate acknowledgement
to the issued command and session, then upload. Timeout, changed target or failed
STOP aborts the upload; never reset or release a fault as a fallback.

Trace names must follow the exact staged upload allocation, not the saved
authoring layout.
**Why:** Source-frame removal during staging can relocate resident LUMPs;
the authoring projection mapped CapabilityTest addresses to Mint even though
the reconstructed upload digest matched the acknowledged image.
**How to apply:** Freeze the map alongside the upload, bind its use to the
artifact and bridge session, and keep mapped words distinct from observed words.

Boot-sentinel expectations come from the selected frozen BIT build, never
from the new uploaded Namespace or today's mutable boot sources.
**Why:** The installed hardware retains its initializer count when runtime
memory is replaced. Using the observed sentinel as its own expectation or
importing newer boot sources would make validation circular or incorrect.
**How to apply:** Verify dependency-free profile constants against retained
vendor evidence; a sentinel match is not full installed-bitstream attestation.

Development Image belongs inside the established IDE, using the same shared
header and view navigation as Namespace, not a separate page with a copied menu.

**Why:** The user explicitly rejected its standalone presentation and approved
integration with the existing IDE on 2026-11-05.

**How to apply:** Preserve the approved review contents and explicit send
confirmation when changing presentation; integration must not rebind or send.
