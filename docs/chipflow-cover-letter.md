# Cover Letter — CM Capability Security Extension for RISC-V

**v1.0 — 2026-04-29**
**CONFIDENTIAL**

**To:** ChipFlow Team
**From:** Kenneth James Hamer-Hodges
**Date:** February 2026
**Subject:** Collaboration Proposal — Golden Token Capability Security on RISC-V Silicon

---

Dear ChipFlow Team,

I am writing to explore a collaboration that I believe aligns naturally with ChipFlow's mission of making custom silicon accessible through Amaranth HDL.

I have designed a capability-based security architecture called the **Church-Turing Meta-Machine (CM)**, which eliminates the need for an operating system, virtual memory, privilege rings, and superuser accounts — the four architectural pillars that every major cyberattack exploits. The architecture enforces security through hardware-validated **Golden Tokens** and a single trusted gate called **mLoad**, making unauthorized access structurally impossible rather than merely difficult.

The core security architecture is implemented in **Amaranth HDL** — 16 modules, approximately 3,000 lines of synthesizable Python — covering all 11 Church (capability) instructions, the mLoad trusted gate, deterministic garbage collection, and the boot sequencer. The remaining work (Turing ALU, branch unit, and MAC hardware) is standard processor logic estimated at under 1,000 additional lines. The architecture is also validated through an interactive web-based simulator (over 40,000 lines), including a bidirectional secure messaging example ("Hello Mum / Hello Son") that achieves secure cross-machine communication using just **1 Church instruction, 3 Golden Tokens, and zero OS involvement**.

### Why ChipFlow

I am seeking a RISC-V SoC base design onto which the CM capability extensions can be integrated. Specifically:

1. **A base RV32I core with standard peripherals** (UART, memory controller, bus interconnect) — the infrastructure that ChipFlow already provides.
2. **Integration of the CM execution unit** as either a co-processor alongside the RISC-V core, or as a replacement for the RISC-V pipeline using the existing peripheral infrastructure.
3. **A path to silicon** — the ultimate goal is a capability-secure processor that can be manufactured, not just simulated.

The CM modules are written entirely in Amaranth and expose clean memory interfaces (instruction, namespace, C-List, and data) that can be adapted to Wishbone or AXI bus fabrics. The integration should be straightforward since both the ChipFlow platform and the CM design share the same toolchain.

### What Makes This Different

Traditional security is software bolted onto insecure hardware. The CM inverts this: **security is the hardware**. Every memory access, every procedure call, every capability transfer passes through mLoad's hardware validation — permission check, bounds check, MAC verification, and G-bit reset. There is no software layer to bypass, no privilege to escalate, no kernel to compromise.

The practical result is a processor that is simultaneously **more secure and faster** than conventional architectures, because the entire OS/VM/privilege security stack is replaced by a handful of microcode steps in hardware.

### Attached

Please find the accompanying **Technical Summary** document, which details:

- All 16 Amaranth modules with their interfaces and signal descriptions
- The Golden Token data structure and permission model
- Memory interface specifications
- Integration options for a RISC-V SoC base
- Resource estimates for Cyclone V / ECP5 FPGAs

I would welcome the opportunity to discuss how the CM capability extensions could be integrated with one of ChipFlow's existing RISC-V designs. I am confident this collaboration could produce the world's first capability-secure RISC-V processor in silicon.

Warm regards,

**Kenneth James Hamer-Hodges**
Architect, Church-Turing Meta-Machine

---

*Project repository and live simulator available upon request.*
---
*Confidential — Kenneth Hamer-Hodges — April 2026*
