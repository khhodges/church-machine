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

**Why:** A stale address map paired a BRANCH label with a DWRITE word/effect,
making the branch appear to write an LED.

**How to apply:** At every trace ingestion or rendering boundary, treat
address metadata and word-derived metadata as separate evidence until their
instruction identity is validated. Never resolve a conflict by preferring
pieces from both sources.