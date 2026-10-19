# Selected ascending-design WukongCallHome repair

## Reviewed change

The selected `WukongCallHome.1.7084172e.lump` (revision 20, SHA-256
`549aa4138bf722b48c2ff304ec628af0139d70685ea99e66dfb3200ad0055738`)
contains three zero C-list words and no authenticated portable binding contract.
Its SELF was therefore neither a destination GT nor the compiler's authenticated
SELF placeholder. The preparation rejection was correct. Changing the slot or
sequence cannot repair this artifact.

The intended destination remains NS[7], generation 0, E-only Inform SELF
`0x4a000007`. The selected `ide.CapabilityTest` revision 2 explicitly calls
`ide.WukongCallHome`, not the historical bare name.

Recovered the source embedded in the exact selected artifact (source SHA-256
`8c92a82112d7ee758e95d7602ce61ae41546e5dedb14eafbbdb36f3ffcbd1d08`).
Changed only the declared names and their references:

- `WukongCallHome` → `ide.WukongCallHome`
- `LED0` → `ide.LED_DEV`
- `UART_TX` → `ide.UART_DEV`

The normal assembly compiler, save plan, approval intent and Save LUMP routes
produced `ide.WukongCallHome.1.8d0a25eb.lump`, revision 1 of the canonical
dot-name, SHA-256
`6af835f829b21b37e2074fcb0cb45a8d77e9c18e4cde1b653c5dd7d16d091f89`.
All 75 instruction words match the historical selected artifact exactly.
The new artifact has compiler-owned SELF and signed symbolic dependency
metadata. No old artifact bytes, Namespace generations, installed image,
CapabilityTest v2 bytes or hardware were changed.

## Selection and merge behavior

`python3 -m server.wukong_callhome_selection` replays this reviewed selection
through authenticated admission and `DesignStore.save` (including fresh binding
reports and fingerprint CAS). It is also called by post-merge setup because
saved design drafts are environment-local and ignored by Git.

It acts only on the exact reviewed draft fingerprint
`2031d8312cc5aac28084ec51b3b9ea72316daf2040d15f6da5fcdb4b16d38a13`.
Absent, updated or independently edited drafts are not modified. Only slot 7's
name and exact artifact selection change. No startup repair, default selection,
activation or hardware operation was added.

## Observed acceptance evidence

On 2026-10-19, the actual saved design after selection had fingerprint
`8d8a59f8429e42cca116ca65ed6323876a0fc44aa062d23129d3a447fd58fc8f`.
The ordinary selected-design prepare, approve and activate endpoints each
returned HTTP 200. The prepared private ascending image SHA-256 was
`67f449864d4b01547f18975805d7ecb781cef94ce31c330cb8aa98182bfd6839`.
Installation and hardware programming remained disallowed.

Loading those exact activated bytes into `Simulator.fromAscendingNamespaceImage`
and starting the entry Thread succeeded. Stepping executed the selected
NS[10] code, then hard-faulted on step 2, PC 1, physical word 770:

> LOAD: referenced unresolved symbolic C-list row 1; runtime binding is disabled.

CapabilityTest v2's authenticated API identifies row 1 as `ide.SelfTest`.
The saved design deliberately has no SelfTest member. The fresh binding report
independently marks that reference unresolved, while row 7
`ide.WukongCallHome` binds to `0x4a000007`. WukongCallHome's SELF also binds to
that same GT. MMIO and Thread symbolic dependencies remain unresolved as shown
in the binding report; none were granted authority by shorthand name or slot.

This is the next independently demonstrated dependency error, not a successful
run of the complete program. No SelfTest was auto-added, no admission check was
bypassed, and no legacy boot image was substituted.
