# Integrated boot-path evidence

2026-10-17. This is isolated machine-path evidence, **not acceptance of the
approved 17-entry profile**, an operational Mint, or physical hardware.

## Reproduction

```sh
node tests/boot/test_compact_boot_flow.js
node simulator/test_round_robin_threads.js
```

The first test builds an authenticated disposable image through the production
boot-image generator, loads it into the simulator, performs canonical boot,
and retires LOAD → CALL → callee IADD → RETURN → LOAD → caller IADD.
It checks both capability identity and memory-derived C-list placement, callee
and caller effects, no faults, and no intervening CHANGE or register repair.
Its SelfTest-named executable is a synthetic fixture, not the selected SelfTest.
The fixture generator checks that generation changes neither selected input
files nor its configuration.

The Thread regression independently exercises CALL → CHANGE → RETURN using
three disposable Threads. Neither test substitutes for the approved profile.

## Causes corrected

- The generator used obsolete low-five-bit operand decoding to erase SelfTest's
  C-list. Approved header/body content is now retained rather than repaired.
- The generator overwrote saved row 1 with the boot-entry GT. Initial entry
  selection no longer replaces an approved continuation capability.
- Boot erased CR6.M after the root CALL; it now retains CALL's L authority.
- Selector-zero CALL started at logical PC 1 although fetch is base + 1 + PC.
  It now starts at logical zero and executes the first code word.

## Exact-profile readiness

Read-only binding inspection used `tests/fixtures/phase1_namespace_target.json`
and the corresponding workspace LUMP bytes, through
`server.namespace_binding_report.binding_report`. This is the frozen approved
profile, not a claim about every possible newer design draft.

| Slots | Entries | Current blocker |
|---|---|---|
| 6, 7, 10 | SelfTest, WukongCallHome, CapabilityTest | Selected bytes lack authenticated dot-name relocation contracts required by the current linker |
| 9, 14–17 | ide.Mint, nstab, pkverify, ide.Alice, ide.Mallory | No exact saved artifact selection in the frozen profile |

The other nine entries are Namespace, Thread and device entries; their presence
is not evidence of integrated operation. No different selections, invented GT
grants or success stubs were substituted. A complete 17-entry execution remains
blocked, including Mint's real allocation → issued CR-held GT → authorized use
path. Saved Namespace state, selected artifacts and hardware were not changed.
