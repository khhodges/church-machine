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

## Exact-source recompilation

`python3 scripts/prepare_phase1_candidates.py` recovers source only from the
hash-matched selected binaries and invokes the current compiler. Each run creates
an ignored `generated-artifacts/phase1-candidates-*` directory containing recovered
source, a report and any successful **unapproved** candidates. It neither signs
new authority nor publishes, selects or installs an artifact.

The initial attempt failed compilation for all three selected executables:
SelfTest's embedded source has no declared abstraction identity; WukongCallHome
and CapabilityTest use unqualified identities and capability names that the
current canonical-dot-name compiler rejects. Their exact source was retained,
not silently renamed or replaced with catalog source.

This is an additional source-update prerequisite, not evidence that binding
alone will make the three artifacts executable. The declarations and dependency
identities must be made explicit before recompilation; candidate revisions then
need actual linking and execution checks.

The Mint and pkverify source drafts intentionally contain unresolved TODO
branches. Their protected-context, Lambda and result-delivery interfaces remain
proposals requiring implementation approval. nstab denotes the restricted table
RW view, not an independent callable service. Existing Alice/Mallory lab code
does not by itself authorize provisioning them in this approved Namespace.

## Approved candidate naming and subsequent compilation

On 2026-10-17 the user explicitly approved `ide.*` candidate identities,
unchanged slots/display labels, and isolated implementation of the protected
Mint interfaces. This supersedes the implementation-approval blocker above;
it does not establish working Mint, allow live replacement, or authorize
hardware changes.

The preparation script now retains both the recovered original source and the
qualified candidate source with separate hashes. Only identifier declarations
and dependency tokens change. Selected SelfTest also needs its omitted outer
abstraction/SELF declaration restored around its existing method body.

All three selected sources now compile successfully into **unapproved**
`ide.SelfTest`, `ide.WukongCallHome` and `ide.CapabilityTest` candidates.
Tests verify the exact input hashes, compiler-owned SELF, qualified dependency
names, executable methods and unchanged original bytes/profile. These outputs
are not signed admission records, localized executable images, or replacements
for the approved selections.

Protected Mint runtime implementation, private credential provisioning, complete
linking and the integrated 17-entry runtime acceptance remain outstanding.
