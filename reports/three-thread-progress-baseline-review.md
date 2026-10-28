# Three-Thread progress: baseline review required

Status: **incomplete integration; no candidate or hardware acceptance**.

## Exact local inputs inspected

The saved ascending design is
`server/lumps/design-drafts/ascending-v1.json`, SHA-256
`b2ffd8f970642b40d5f5ceae58d8f46bbef73085c7034cfa7833c264c9b2ab3e`.
All thirteen selected artifact files exist and match their selected SHA-256.
The selected boot entry is **ide.AmoebaStartup**, not ActorManager.

| Slot | Selected file | SHA-256 |
|---|---|---|
| 6 | ide.SelfTest.1.c01f5b7c.lump | ee0a2ff43f384fab39c9c4f46f4b869e11fa35d3d625e5811cd4f546db472ecb |
| 7 | ide.WukongCallHome.1.4d2dd0b2.lump | d7e8d3eed63a3346dd51eed9f45323e539b487702d029b74bf1970a2bec3c336 |
| 10 | ide.CapabilityTest.1.e8014e72.lump | 62ff2ef857ed86cd81416df787a8484f6f7d4379bb800f12d82ef37e0048e6f8 |
| 16 | ide.Alice.1.9d996919.lump | bf6e8a61967a81261d19da797783f5ed9762892fd00ba00fc19c618b19d24050 |
| 17 | ide.Mallory.1.3a5e7373.lump | 11341685017d1852f514d1af6fda990edf87c89cbd082be8df83ccfb8a677fb5 |
| 18 | ide.AliceDriver.1.e653d1b7.lump | a6572caf86cfbaeebfd6e71323ae5bbe8cb794af27e513f1ae6787d642222246 |
| 19 | ide.MalloryDriver.1.7c2fbe67.lump | 4207f0ff124b70e712b52e1f52f520cae272078dc9db92c0585d686cd0fd2756 |
| 21 | ide.AmoebaStartup.1.e37d50bd.lump | 96e1ef3d5659107d68290011f883ca7589446064a85a85f15d00fb6d58255d83 |

Boot.Thread is slot 2; Thread.2 and Thread.3 are slots 11 and 12.
Both worker Threads are prepared at AmoebaStartup NIA 1, with Alice and
Mallory E-GTs respectively in CR1. They are **not** prepared at their actor
drivers. ActorManager remains selected as a non-boot resident at slot 20;
it was neither deleted nor invoked by this investigation.

## Isolated replay

The existing `server.design_simulation.stage(configuration(document), document,
directory, 21)` path authenticated and localized the selections without saving
or adopting them. Its private 65,536-byte image SHA-256 was:

`1c8673dd39ebd7fd196a5e0f8d59c4119bc4f2298ebf7c187792c6f2b4d42336`.

Replay used `ChurchSimulator.fromAscendingNamespaceImage`, the original root,
`beginBoot({clearNonBootThreads:true, freshThreadSlots:[11,12]})`, three boot
steps, and a 20,000-instruction bound. No post-boot state patches, instruction
skips, runtime grants, reinitialization, or image replacements were used.
This was a baseline diagnostic, **not** the formal attack/progress acceptance.

Observed execution counts grouped by Thread slot and executing LUMP slot:

| Thread | LUMP | Instructions attempted |
|---|---|---:|
| 2 | 21 | 2 |
| 2 | 10 | 15 |
| 12 | 21 | 66 |
| 12 | 10 | 432 |
| 11 | 21 | 126 |
| 11 | 10 | 830 |
| 12 | 6 | 5,296 |
| 12 | 7 | 960 |
| 11 | 6 | 10,413 |
| 11 | 7 | 1,860 |

No actor or actor driver executed. There were zero faults. Boot.Thread yielded
at CapabilityTest NIA 15 and did not resume within this bound.
The same counts and zero faults were observed with the existing fault-entry
configuration separately pointing at AmoebaStartup and CapabilityTest before
boot. Neither experiment exercised recovery; neither handler choice is an
approved selected handler or evidence of a working restart.

The saved CapabilityTest contains CHANGE to C-list rows 9 and 8 at NIAs 15
and 16, then calls SelfTest and WCH and returns. Its saved source examples are
not an accurate substitute for these bytes. The saved WCH sends the bare
`CM:WUKONG\r\n` banner with busy polling and RETURN at NIA 60; it has no
Alice input contract. The selected AliceDriver still initializes 731 and
halts after yielding; MalloryDriver calls Steal and then halts.

## Review boundary

The current code does contain a retained-memory Boot fault-entry implementation.
The older report saying no such implementation exists is historical, not a
description of today's code. However, the saved design does not identify the
user-reported attack/restart arrangement. The private simulator's fault-handler
selection is browser-local, and cannot be inferred from the saved document.

Before changing the workload, identify the exact working saved design/image
and fault-handler selection that demonstrate the reported repeated Mallory
fault-to-Boot path. Alternatively, explicitly confirm this inspected
AmoebaStartup baseline as the starting point and review its dispatch/restart
contract. Do not silently substitute the historical ActorManager startup or
claim this zero-fault run verifies repetition.

The existing Boot fault-entry register contract has fault code, instruction
address/word, outgoing references and save status, but no wall-clock field.
WCH has LED/UART authority only. Host receipt timestamps do not establish an
FPGA clock or a program-readable retained last-fault timestamp. A clock or
host-to-board interface requires the separate review specified in the scenario.
No timestamp interface or bridge annotation was added.

All executable sources, selected artifacts, Namespace documents, Boot.Thread,
runtime semantics, workflows, installed images and hardware remain unchanged.
Alice continuity, diagnostic serialization, repeated denials, retained
last-fault reporting, RTL and physical acceptance remain **unverified**.
