---
name: CLOOMC language detection
description: Language probes must disregard comments and run specific recognizers before broad fallbacks.
---

CLOOMC language detection must ignore all accepted comment syntaxes before
looking for language markers, and specific language detectors must run before
broad fallback detectors.

**Why:** A CLOOMC `//` comment containing the word `pure` was mistaken for a
Haskell marker, causing a valid abstraction to compile as an empty Haskell
program without errors.

**How to apply:** When adding a source-language detector or security
documentation to a CLOOMC file, test that comments cannot alter detected
language and that the expected abstraction still emits its methods.