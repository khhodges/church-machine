---
name: Python ABI dependencies
description: Mixed Python toolchains can make newly installed SDKs fail to import.
---
Check the actual serving Python version when adding packages with compiled
dependencies; do not assume it matches the package installer's interpreter.

**Why:** This workspace has both Python 3.11 and a Python 3.12 `python3`.
The App Storage SDK exposed a compiled CFFI backend installed for 3.11 that
could not load in the server's 3.12 interpreter.

**How to apply:** Verify imports using the workflow's interpreter as well as
the installer environment. Keep runtime-compatible system dependencies available;
do not silently change the entire application interpreter to fix one download.
