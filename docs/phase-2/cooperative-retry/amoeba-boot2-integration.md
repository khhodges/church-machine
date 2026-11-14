# Boot2 integration work

Local candidate work only. Saved LUMPs, saved Namespace, historical images,
historical replay receipts and physical hardware remain unchanged.

## Separate receiver window

The local starter now accepts an explicitly configured Amoeba MMIO base.
The historical default remains unchanged for reproducibility. The new candidate
uses `0x40000100`–`0x4000011b`, checked against every existing Boot2 device
descriptor before preparation. Only the two private receiver/control descriptors
and their seals change; no existing device is moved.

Preparation command:

```
python docs/phase-2/cooperative-retry/qualify_amoeba_boot2.py \
  --receiver-base 0x40000100 \
  --output generated-artifacts/amoeba-remap-boot2
```

The historical preparation/evidence tests and new mapping tests passed (15).
The new runtime snapshot is `generated-artifacts/amoeba-remap-rtl`, manifest
SHA-256 `d6a098753d28e9756e1f92e389ccbc59ee68c775eba58caee1b1288a2deeb4b0`.
Replay accepts an explicit manifest pin, still verifying every snapshot file;
the historical default pin is retained.

## USER activation investigation

The qualification fixture supplied SYSTEM Thread GT `0x03000002` in the USER
home and Amoeba's private C-list. This encodes generation **256**, while Boot2's
SYSTEM Thread descriptor has generation **0**. This is a provisioning mismatch,
not permission to change the descriptor generation or bypass its check.

The opt-in `--correct-system-gt` candidate derives the private SYSTEM grants
from the retained descriptor generation. It does not rewrite hardware versions
or modify the historical default candidate. Corrected images and replay output
are kept separately in `generated-artifacts/amoeba-context-boot2`.

## Verified outcomes

- Relocated-receiver SYSTEM replay still delivers CapabilityTest exactly,
  commits its transaction and stops at the original nested absent CALL
  (`ABSENT_OUTFORM`, NIA `0x6164`). Relocation does not bypass that check.
- Corrected Alice reaches LLR, requests slot 16, receives all 128 selected
  words, publishes header last and completes the bounded observation without
  a fault. This removes the prior activation blocker; it is not concurrent
  multi-USER acceptance.
- Corrected Mallory reaches LLR, requests slot 17 and publishes all 128
  selected words. It subsequently faults BOUNDS (8) at `0x7408`, inside
  Mallory, rather than at Thread activation. No fault is skipped.
- The generation-consistency test passes independently of the replay.

## Explicit SYSTEM loading candidate

`amoeba_system_candidate.py` extracts the source from the pinned selected
CapabilityTest, appends the declared Amoeba E relocation row, and compiles a
separate local revision. Its SYSTEM Run asks Amoeba to load SelfTest and
WukongCallHome before the original register/flag setup, checks and calls.
The existing AliceRun and MalloryRun bodies are not rewritten. The original
saved source and binary are not replaced.

Only declared capability relocation words are localized after compilation.
The test verifies unchanged non-CapabilityTest target words and the old
C-list row order. It passed. Compiler warnings about unavailable exact named
CALL APIs are retained in the candidate receipt rather than suppressed.

```
python docs/phase-2/cooperative-retry/qualify_amoeba_boot2.py \
  --receiver-base 0x40000100 --correct-system-gt --system-loads \
  --output generated-artifacts/amoeba-system-loads-boot2
```

The initial startup replay requested CapabilityTest, SelfTest and WukongCallHome
in that order. It published the first two complete 1,024-word bodies exactly
and header-last. Its 60,000 execution-step budget expired after 582 of
WukongCallHome's 1,024 words had been copied, before publication, with no
runtime fault. That is incomplete observation, not a completed startup or
a loader failure. Its receipt remains `system-replay.json`.

A separate 120,000-step replay, `system-extended-replay.json`, completed all
three exact, header-last publications with no runtime fault. It then exposed
18 repeated LLR handoffs for Alice (slot 16) without any receiver request for
Alice. The restored SYSTEM continuation was inside CapabilityTest.Run, whose
old unconditional loop ignored the injected pending request.

The next local source revision clears Z before its USER CHANGE, distinguishes
ordinary yield from LLR reentry, and passes DR5's pending slot to Amoeba's
EnsureResident before continuing the original loop. Other method bodies stay
unchanged. This is dispatch at the actual SYSTEM continuation, not an automatic
hardware call to Amoeba or a new scheduler.

That revision passed its focused preparation/compiler test and completed replay
from `generated-artifacts/amoeba-system-dispatch-boot2`, with the same
120,000-step observation budget and pinned RTL. The recorder now retains
per-target execution and first RETURN observations even after the rolling
trace advances, so successful publication cannot be mistaken for a completed
application CALL.
The preparation/evidence checks total 17 passes across the unchanged suite
and the two subsequently added focused tests. This is not hardware acceptance.

## Corrected integrated replay result

The retained `system-replay.json` reports `bounded-observation`, admission
`READY`, and no runtime fault. Image SHA-256:
`fac85e6429e870cbbea1157a1357798d5e2004140b4c30885e2ca965335f22df`.

- Receiver transactions 1–4 requested CapabilityTest (10), SelfTest (6),
  WukongCallHome (7), then Alice (16), exactly once each.
- All four bodies were published with exact selected bytes and header last:
  1,024 words each for the three SYSTEM targets, 128 words for Alice.
- Alice produced one Lazy handoff at cycle 634076; SYSTEM requested her body
  at 634274 and native code published it at 660425.
- Alice subsequently retired three instructions and a RETURN at `0x7a14`,
  cycle 663164, with DR1=0. This establishes execution after loading, not
  merely a successful transfer.
- SelfTest and WukongCallHome repeatedly retired RETURN instructions.
  The retained first eight observations report DR1=0 and DR1=1 respectively.
  These register observations are not an independent verdict on every
  SelfTest branch or physical peripheral operation.
- CapabilityTest continued its SYSTEM loop (583 retired instructions);
  it did not RETURN in this observation. The other seven target bodies
  remained unwritten.

This closes the observed dispatch blocker for the bounded SYSTEM→single-Alice
path with only Amoeba code initially resident. It does not qualify simultaneous
USER scheduling, missing Mint bindings, physical peripherals, or all Boot2
applications. The separate Mallory BOUNDS fault remains unresolved.
No saved LUMP, saved Namespace, live boot image, or hardware was changed.
