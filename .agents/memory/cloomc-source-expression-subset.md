---
name: CLOOMC source expression subset
description: Compiler constraints for executable CLOOMC reference models.
---

The CLOOMC source compiler accepts simple expressions and single comparisons,
but does not resolve nested `read()` calls inside arithmetic or guards joined by
`&&`/`||`. Split each read and calculation into named temporary values, split
compound guards into separate `if` statements, and construct or unpack packed
words with `bfins`/`bfext` rather than nested shifts and bitwise expressions.

**Why:** A source file can look valid alongside existing hand-authored examples
yet fail compilation with “Cannot resolve expression” or “Cannot compile
statement” errors for compound forms.

**How to apply:** Compile every newly authored CLOOMC abstraction directly
before relying on its contract. Treat it as a restricted source language rather
than general JavaScript/C syntax.