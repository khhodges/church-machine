# Production Silicon TODO

This document tracks requirements for synthesizing the CTMM Verilog to production-ready silicon. The current implementation captures architectural concepts for simulation; these items would be needed for a real chip.

## SWITCH/CHANGE Instruction Pipeline

### 1. CR9-CR14 Register Storage Paths
**Status**: Not implemented (targets silently ignored)

**Required work**:
- Add dedicated storage for CR9 (Interrupt), CR10 (DFault), CR11-CR14 (reserved)
- Wire write enables (`cr9_wr_en`, `cr10_wr_en`, etc.) in `ctmm_registers.sv`
- Route SWITCH target decoding for values 1-6 in `ctmm_core.sv`
- Define fault behavior if targeting unimplemented registers

**Architecture notes**:
- CR9: Interrupt handler capability
- CR10: Data fault handler capability  
- CR11-CR14: Reserved for future expansion

### 2. Memory Latency Handling for I=1 Mode
**Status**: Assumes single-cycle memory access

**Required work**:
- Add stall signal when `clist_rd_en` is asserted
- Implement handshake or valid signal from memory interface
- Hold execution until `clist_rd_data` is valid before writing CR8/CR15
- Consider adding pipeline registers for memory read path

**Affected instructions**:
- `SWITCH CRn[idx], target` (I=1 mode)
- `CHANGE CRn[idx]` (I=1 mode)
- `LOAD CRn[idx], CRd` (similar timing requirements)

### 3. Dedicated Execution Pipeline Stage
**Status**: SWITCH/CHANGE share always_comb block with boot sequence

**Required work**:
- Create separate execution stage for Church instructions (parallel to LOAD/SAVE)
- Implement proper write arbitration with priority encoding
- Add pipeline registers between decode and execute stages
- Handle data hazards (e.g., SWITCH followed by instruction using new CR8)

**Design considerations**:
- Boot writes happen only during boot states
- Runtime writes happen only after `boot_complete`
- Currently mutually exclusive by design, but explicit arbitration is cleaner

## Other Production Requirements

### 4. mLoad 10-bit Index Extension
**Status**: Index truncated to 8-bit in some modules

**Required work**:
- Verify all C-List index paths support full 10-bit range
- Update `ctmm_switch.sv` if integrated (currently uses 8-bit)
- Update `ctmm_mload.sv` for full index width

### 5. MAC Validation
**Status**: Disabled (`check_mac = 1'b0`)

**Required work**:
- Implement actual MAC calculation in hardware
- Add crypto unit for HMAC-SHA256 or similar
- Wire calculated MAC comparison for LOAD operations

### 6. Type Alignment
**Status**: `ctmm_switch.sv` uses `capability_reg_t` (256-bit), core uses `golden_token_t` (64-bit)

**Required work**:
- Decide on canonical capability representation
- Either simplify `ctmm_switch.sv` to use `golden_token_t`
- Or extend register file to support full `capability_reg_t`

---

*Last updated: 2026-01-28*
