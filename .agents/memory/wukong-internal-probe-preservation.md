---
name: Wukong internal probe preservation
description: Why normal board RTL retains internal diagnostic attributes even without ILA insertion.
---
Keep diagnostic observations internal while retaining their synthesis attributes in the shared generated RTL, including builds without ILA insertion.

**Why:** ILA insertion is selected later in Vivado, so stripping attributes at RTL generation makes that option unreliable. Exporting observations as top-level ports is not an alternative: Vivado can assign them to unintended physical pins.

**How to apply:** Check both the external port contract and internal net preservation when changing RTL generation. Yosys can copy attributes onto aliases, so test each required net's attributes rather than an exact global attribute count. Actual post-synthesis probe availability must still fail closed in Vivado.
