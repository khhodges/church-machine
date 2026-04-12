# Production Silicon TODO

This document tracks requirements for synthesizing the Church Machine Verilog to production-ready silicon. The current implementation captures architectural concepts for simulation; these items would be needed for a real chip.

## SWITCH/CHANGE Instruction Pipeline

### 1. CR12-CR15 Register Storage Paths
**Status**: IMPLEMENTED (2026-01-28)

**Completed**:
- Added cr12_wr_en through cr15_wr_en ports in `ctmm_registers.sv`
- Added GT write logic for CR12-CR15 in register file
- Updated SWITCH routing in `ctmm_core.sv` with full case statement for all 4 targets (2-bit target field)
- All targets now functional (no more silent ignore)

**Architecture notes**:
- CR12: Data fault handler capability (system-wide, unchanged by CHANGE)
- CR13: Interrupt handler capability (system-wide, unchanged by CHANGE)
- CR14: Code register — per-thread, saved/restored by CHANGE; re-derived by cLoad on every CALL
- CR15: Namespace root — per-thread, saved/restored by CHANGE
- Note: Current implementation writes GT (Word 0) only; full capability writes via mLoad path

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
**Status**: IMPLEMENTED (2026-01-28)

**Completed**:
- `ctmm_mload.sv`: sub_index extended from 8-bit to 10-bit
- `ctmm_mload.sv`: index_reg extended from 8-bit to 10-bit
- `ctmm_mload.sv`: Updated address/bounds calculations for 10-bit width
- `ctmm_switch.sv`: Removed index[7:0] truncation, now passes full 10-bit index

### 5. MAC Validation
**Status**: Disabled (`check_mac = 1'b0`)

**Required work**:
- Implement actual MAC calculation in hardware
- Add crypto unit for HMAC-SHA256 or similar
- Wire calculated MAC comparison for LOAD operations

### 6. Type Alignment
**Status**: Mixed types in use - architectural decision needed

**Current situation**:
- `ctmm_core.sv` uses `golden_token_t` (64-bit) for CR read/write
- `ctmm_switch.sv` and `ctmm_mload.sv` use `capability_reg_t` (256-bit)
- `ctmm_registers.sv` stores `capability_reg_t` but special write ports accept `golden_token_t`
- SWITCH/CHANGE write GT (Word 0) only via special ports

**Design decision required**:
- Option A: Simplify to GT-only for SWITCH (current approach - fast path)
- Option B: Full capability writes via mLoad subroutine (complete but slower)
- Option C: Extend core to handle full capability_reg_t

**Notes**:
- Current implementation is functionally correct for GT-based security
- Full capability (Location, Limit, Seals) only needed for namespace lookups

---

*Last updated: 2026-01-28*
