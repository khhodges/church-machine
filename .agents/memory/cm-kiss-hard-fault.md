---
name: CM KISS and hard-fault default
description: Prefer first-fault detection and correction over recovery strategies or hidden continuation mechanisms.
---

KISS is a confirmed standing CM design rule, not a pending review proposal.
Every instruction must stand alone and execute as the ISA-specified fail-safe
operation. Do not add implicit CALLs, initialization, preparation APIs, or
companion instruction requirements to make an instruction work.

**Why:** The user explicitly corrected the Thread-use investigation: “Do not
assume or add any actions beyond those specified in the ISA” and “Each
instruction is designed to stand alone and execute as a Fail-Safe operation.”

**How to apply:** Read the master ISA before treating simulator behavior or a
fixture restriction as architectural authority. Test the specified operation
and its hard-fault conditions; do not repair missing inputs during execution.

The user directs that faults default to a hard fault rather than initiating
new recovery strategies.

Intentional HARDFAULT has a selected word, but selection must not be treated as
approval of map binding, compiler emission, or target release. The detached
signed-map format is a proposal, not a user-approved trust policy.

On 2026-10-14 the user superseded the standalone exact-artifact HARDFAULT map
work as part of the Phase 1 bitstream. Carry its unresolved approval and release
gates into that work; do not restart standalone release validation for it.

**Why:** Encoding selection followed isolated candidate evidence while release
approval was explicitly deferred. Map authentication and hardware acceptance
are separate decisions.

**How to apply:** Obtain explicit binding/key-provisioning approval before
enabling reason attribution or lowering; never promote test signing keys into
production trust or infer intentional faults from identical WORD bytes.

**Why:** The user's engineering rationale is that sound software construction
exposes faults on first occurrence, they are fixed promptly, and removing
their causes improves MTBF. Recovery machinery is not the design priority.
The assistant had overcomplicated the Namespace review with speculative
recovery strategies and must not keep reopening those alternatives.

**How to apply:** Preserve the required authority, version, type, bounds, and
context checks; fail hard on violations. Do not add retries, alternate targets,
silent repairs, automatic continuation, transactional rollback, or new
recovery protocols to make a handoff succeed. Keep fault attribution and
diagnostic evidence useful for correcting the cause. Hardware never changes
version numbers; authorized software management owns version-based
blacklisting. Boot Thread faults retain the specified purgatory outcome.
The PP250 remote-spare example is separate system-level precedent, not
permission to add recovery machinery inside the CM.

Existing explicitly agreed architectural fault behavior is not authorization
to invent additional recovery mechanisms, nor does this principle authorize
silently deleting existing fault handling or altering retained artifacts.

The user reaffirmed this rule during the Phase 1 Mint Q&A: “Any fault is a hard
fault.” Apply it to Mint, its same-scope NSRW-GT LAMBDA and pkverify, including
failed authorization/verification/validation checks, rather than drafting
recoverable rejection returns. Hard faults do not imply rollback of prior writes.

Standard software hard faults need structured diagnostic data for the IDE.

**Why:** The user identified this common requirement while reviewing Mint and
pkverify's draft fault paths.

**How to apply:** Define a shared non-returning fault/reporting contract, not
ad hoc method-specific mechanisms. Keep proof material and private authority out
of diagnostics; reporting failure must not prevent faulting. Exact fields,
ABI and transport are not yet approved; do not infer a new opcode or recovery.

The user approved `HARDFAULT reason` as the starting compiler design: a
pseudo-instruction with an exact-artifact static IDE fault map.

**Why:** This permits consistent compiler-generated diagnostics without runtime
message construction, reporting calls, extra diagnostic registers or secrets.

**How to apply:** Map instruction offsets to reason/method/source/explanation.
Use the exact loaded artifact identity; missing maps show raw locations, not
guessed labels. Keep strings outside Tiny LUMPs if appropriate. Static data
only initially. Verify a non-returning lowering and pre-recovery fault-location
capture before implementation; neither HALT nor a new opcode is approved.

The user approved lowering HARDFAULT to one designated non-executable word
using the existing INVALID_OP path.

**Why:** It avoids a new executable opcode, reporting CALL and scratch registers
while using the exact-artifact map for software reasons.

**How to apply:** Select and verify the exact word, flags/register preservation
and original fault-location capture before use. Keep the word non-executable
in future ISA revisions. Do not interpret every INVALID_OP as intentional;
only an exact matching fault-map site establishes that distinction.

Candidate verification is not numeric-encoding approval or target acceptance.

**Why:** Isolated execution can prove the fault edge while relying on an
integration-provided fetch gate; preserved state before reset does not imply
preservation after reset. A passing candidate test must not silently enable
compiler lowering.

**How to apply:** Keep selection, exact-artifact map binding, integrated
capture/transport, and physical acceptance as distinct gates. Consult the
HARDFAULT candidate investigation in the Phase 1 docs before enabling emission.

Genesis selected the verified `0xF7000000` WORD encoding for HARDFAULT.

**Why:** Genesis approved the returned candidate and its documented limits;
selection is not permission to treat unverified target behavior as PASS.

**How to apply:** Preserve permanent non-executability. Keep compiler emission
disabled until exact-artifact maps and integration capture gates are satisfied.

Release approval may be deferred while closing the HARDFAULT investigation.

**Why:** The user explicitly approved moving forward without release approval.
This separates selecting the encoding from authorizing its use.

**How to apply:** Preserve outstanding release checks and target acceptance as
open gates, never as PASS; investigation completion must not enable emission.
