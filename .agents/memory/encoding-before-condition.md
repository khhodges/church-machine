---
name: Encoding validity before conditions
description: User-agreed review rule forbidding false predicates from hiding invalid encodings.
---

The user agreed that invalid/reserved instruction encodings must cause an
INVALID_OP hard fault regardless of flags. Validate encoding after authorized
fetch and before condition evaluation; only valid instructions may be skipped.
Skipping does not authorize operand access or target-capability validation.

**Why:** The user rejected a condition-first interpretation that allowed
malformed instructions to escape hard faults when their predicate was false.

**How to apply:** Preserve this ordering in ISA review and later conformance
work. The agreement authorized updating the red-text review, not the master
ISA, compiler, simulator or hardware. Do not claim current implementation
conformance without checking it. For marked data, payload bits are not a
condition field; distinguish execution from an authorized data read.
