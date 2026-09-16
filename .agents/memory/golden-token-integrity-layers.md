---
name: Golden Token integrity layers
description: Distinguishes cryptographic GT authenticity, FPGA storage fault protection, transport checks, and runtime authorization.
---

Protect Golden Tokens in layers: Trusted Home IDE seals establish authenticity
before Mint; sideband ECC protects stored and transferred 32-bit GT values from
accidental corruption; runtime ISA checks enforce dynamic authority.

**Why:** Current Ti60/Wukong GT, CR, Namespace, C-list, pipeline, and DMEM
interfaces are 32-bit with no verified parity/ECC sideband. Namespace
integrity32 is a semantic seal and UART CRC is transport detection; neither is
SECDED. Embedding invented parity bits in the architectural GT would change the
ISA without providing cryptographic authenticity.

**How to apply:** Preserve the 32-bit GT encoding. If hardware ECC is added,
store sideband SECDED (for example 32 data plus 7 check bits), decode before
semantic/permission checks, correct and scrub single-bit errors, and fault
closed on uncorrectable errors. Cover DMEM, Namespace/C-list words, CR storage,
GT-bearing latches, and transfer framing. Report ECC as unsupported until the
FPGA memory implementation and fault path actually provide it.
