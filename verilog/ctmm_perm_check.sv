// ============================================================================
// CTMM Permission Checker - Hardware Permission Validation
// ============================================================================
// Combinational module: checks GT permissions, bounds, version, and seal.
// Single fault_type output for fail-safe security.
// ============================================================================

module ctmm_perm_check
    import ctmm_pkg::*;
(
    // Permission check request
    input  golden_token_t gt_in,          // Golden Token to check
    input  logic [5:0]    required_perms, // Required permission mask
    input  logic          check_valid,    // Enable all checks

    // Bounds checking
    input  logic [15:0]   access_index,   // Index being accessed
    input  logic [15:0]   limit,          // Namespace slot count limit
    input  logic          check_bounds,   // Enable bounds check

    // Version (gt_seq) checking
    input  logic [6:0]    stored_gt_seq,  // GT sequence from namespace seals
    input  logic          check_version,  // Enable version check

    // Seal (CRC-16) checking
    input  logic [15:0]   calculated_seal, // CRC-16 computed by caller
    input  logic [15:0]   stored_seal,    // Seal from namespace entry
    input  logic          check_seal,     // Enable seal check

    // Domain purity check (TPERM)
    input  logic          check_domain_purity,

    // Results
    output logic          perm_granted,
    output logic          bounds_ok,
    output logic          version_ok,
    output logic          seal_valid,
    output logic          domain_purity_ok,
    output logic          all_checks_pass,
    output fault_type_t   fault_type,
    output logic          fault_valid
);

    // ========================================================================
    // Permission Check
    // ========================================================================

    logic [5:0] gt_perms;
    logic       is_null_gt;
    logic       perms_match;

    assign gt_perms    = gt_in.perms;
    assign is_null_gt  = (gt_in.gt_type == GT_TYPE_NULL);
    assign perms_match = ((gt_perms & required_perms) == required_perms);
    assign perm_granted = !is_null_gt && perms_match;

    // ========================================================================
    // Domain Purity (TPERM restriction)
    // ========================================================================

    logic has_turing_perms;
    logic has_church_perms;
    assign has_turing_perms  = |(gt_perms & DATA_PERMS);
    assign has_church_perms  = |(gt_perms & CAP_PERMS);
    assign domain_purity_ok  = !(has_turing_perms && has_church_perms);

    // ========================================================================
    // Bounds, Version, Seal Checks
    // ========================================================================

    assign bounds_ok  = !check_bounds  || (access_index < limit);
    assign version_ok = !check_version || (gt_in.gt_seq == stored_gt_seq);
    assign seal_valid = !check_seal    || (calculated_seal == stored_seal);

    // ========================================================================
    // Combined Result
    // ========================================================================

    assign all_checks_pass = perm_granted && bounds_ok && version_ok && seal_valid;

    // ========================================================================
    // Fault Detection
    // ========================================================================

    always_comb begin
        fault_valid = 1'b0;
        fault_type  = FAULT_NONE;

        if (check_valid) begin
            if (is_null_gt) begin
                fault_valid = 1'b1;
                fault_type  = FAULT_NULL_CAP;
            end else if (!perms_match) begin
                fault_valid = 1'b1;
                if      ((required_perms & PERM_MASK_R) && !(gt_perms & PERM_MASK_R))
                    fault_type = FAULT_PERM_R;
                else if ((required_perms & PERM_MASK_W) && !(gt_perms & PERM_MASK_W))
                    fault_type = FAULT_PERM_W;
                else if ((required_perms & PERM_MASK_X) && !(gt_perms & PERM_MASK_X))
                    fault_type = FAULT_PERM_X;
                else if ((required_perms & PERM_MASK_L) && !(gt_perms & PERM_MASK_L))
                    fault_type = FAULT_PERM_L;
                else if ((required_perms & PERM_MASK_S) && !(gt_perms & PERM_MASK_S))
                    fault_type = FAULT_PERM_S;
                else if ((required_perms & PERM_MASK_E) && !(gt_perms & PERM_MASK_E))
                    fault_type = FAULT_PERM_E;
                else
                    fault_type = FAULT_PERM_R;
            end else if (check_bounds && !bounds_ok) begin
                fault_valid = 1'b1;
                fault_type  = FAULT_BOUNDS;
            end else if (check_version && !version_ok) begin
                fault_valid = 1'b1;
                fault_type  = FAULT_VERSION;
            end else if (check_seal && !seal_valid) begin
                fault_valid = 1'b1;
                fault_type  = FAULT_SEAL;
            end else if (check_domain_purity && !domain_purity_ok) begin
                fault_valid = 1'b1;
                fault_type  = FAULT_DOMAIN_PURITY;
            end
        end
    end

endmodule
