---
name: ChurchAssembler Node global shim
description: compileAssembly() in CLOOMCCompiler uses typeof ChurchAssembler as a global guard; Node subprocesses must shim it before requiring the compiler.
---

## The rule

In any Node.js subprocess that calls `CLOOMCCompiler.compileAssembly()`, set the global **before** requiring the compiler:

```js
global.ChurchAssembler = require('./simulator/assembler.js');
const CLOOMCCompiler   = require('./simulator/cloomc_compiler.js');
```

**Why:** `compileAssembly()` (line 690) does:
```js
const asm = (typeof ChurchAssembler !== 'undefined') ? new ChurchAssembler() : null;
```
It checks `typeof ChurchAssembler` — a bare global lookup, not a module import.
In the browser this is satisfied by a `<script>` tag that loads assembler.js first.
In Node there is no equivalent auto-load, so unless you set `global.ChurchAssembler`,
`asm` is `null` and the method immediately returns `{ errors: [{ line:1, message: 'ChurchAssembler not available' }] }`.

The Node auto-require at line 4045 exists for a *different* internal path (not `compileAssembly`),
so relying on that does not fix the issue.

**How to apply:** Every new Node worker / script that invokes any compile method
should set `global.ChurchAssembler` as the very first require. See `server/compile_worker.js`.
