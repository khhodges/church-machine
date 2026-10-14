---
name: CM KISS and hard-fault default
description: Prefer first-fault detection and correction over recovery strategies or hidden continuation mechanisms.
---

KISS is a confirmed standing CM design rule, not a pending review proposal.
The user directs that faults default to a hard fault rather than initiating
new recovery strategies.

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
