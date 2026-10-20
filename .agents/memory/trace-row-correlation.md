---
name: Trace row correlation
description: Rule for combining hardware retirement addresses, instruction words, disassembly, and effects in one displayed row.
---

Hardware trace rows may combine NIA-backed symbols with a hardware-observed
instruction word only when the mapped word and observed word match. A word
derived from the same NIA map is not independent evidence and must never
self-validate. An unknown address may
still show word-derived disassembly, but it must remain visibly unlabelled; a
conflict must discard the address label rather than imply that both facts
describe one instruction.

Generated instruction comments must distinguish static semantics from recorded
execution. Never recompute a historical instruction using current registers.
Use exact occurrence-bound operands when available; otherwise show symbolic
semantics, not inferred values.

**Why:** Re-evaluating an already executed in-place addition displayed
4096+4096=8192 even though the actual instruction computed 0+4096=4096,
misleading diagnosis of M-bit authorization.

**How to apply:** Apply the same evidence rule to disassembly, fault history,
pipeline explanations, and hardware views. Hardware comments must never borrow
software simulator register values.

Fault navigation must retain the header-inclusive LUMP offset and captured raw
word. Never use the global last-assembly line map for a different opened LUMP;
prefer a highlighted exact instruction when editable source cannot be verified.

**Why:** A fault link opened the LUMP without its instruction offset, while the
source shortcut could select a line from an unrelated compilation.

**How to apply:** Await editor navigation, check the opened owner and instruction
bytes, then scroll and highlight. Select source only with a byte-validated map;
preserve divergent drafts and report unavailable mappings explicitly.

**Why:** A stale address map paired a BRANCH label with a DWRITE word/effect,
making the branch appear to write an LED.

**How to apply:** At every trace ingestion or rendering boundary, treat
address metadata and word-derived metadata as separate evidence until their
instruction identity is validated. Never resolve a conflict by preferring
pieces from both sources.

Active simulation inspection must resolve the admitted artifact binding before
consulting legacy Namespace or repository metadata. A missing exact catalog
match means revision metadata is unavailable, not permission to choose “latest.”

**Why:** A legacy CapabilityTest assignment made inspection select v44 while
the selected simulation continued executing ide.CapabilityTest bytes. Namespace
slot numbers and historical lookup tokens alone did not distinguish the artifacts.

**How to apply:** Match filename, binary hash and token together; pass that exact
identity through editor navigation instead of reducing it to a token-only open.

Fault descriptions must follow the failed instruction and its captured operand
pet names, not apply a generic caller-to-callee formula to every fault.

**Why:** The user rejected a DWRITE report saying “From NS[10].Run -> To
unknown.unknown” instead of identifying the actual capability.

**How to apply:** Capture names from the executed artifact's declarations and
fault-time GTs. Retain CR numbers for inspection and the unmodified diagnostic
reason; only actual transfers should describe a destination method.