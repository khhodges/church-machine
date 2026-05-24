// hardware/soc_combined/apb3_cm_bridge.v
//
// APB3 slave bridge — Sapphire SoC ↔ Church Machine
//
// Connects to io_apbSlave_0 on the Sapphire SoC.  The SoC firmware uses
// this bridge to control and monitor the Church Machine core.
//
// Register map (word-addressed; PADDR bits [5:2] = register index)
//
//  Offset  Name        Access  Description
//  0x00    CTRL        R/W     [0] cm_pb — Church Machine push-button drive.
//                              1 = button released (idle, default after reset).
//                              0 = button pressed (active-low on CM input).
//                              Hold 0 for ≥ 1 s (25 000 000 cycles @ 25 MHz) to
//                              latch the CM into free-run mode.  A brief pulse
//                              (< 1 s) triggers single-step.
//  0x04    STATUS      RO      [0] boot_complete — CM boot sequence finished.
//                              [1] fault_valid   — CM raised a fault this cycle.
//                              [2] fault_latched — sticky; any past fault.
//  0x08    NIA         RO      [31:0] next instruction address (CM program counter).
//  0x0C    FAULT       RO      [4:0] fault code from CM.
//
// All other addresses alias to zero on read; writes are ignored.
//
// APB3 signals used:
//   PSEL, PENABLE, PWRITE, PADDR[5:2], PWDATA[31:0]
//   PRDATA[31:0], PREADY, PSLVERROR
//
// PREADY is always asserted (zero-wait-state slave).
// PSLVERROR is never asserted.
//
// Device: Efinix Ti60F225   Clock: 25 MHz
//

`default_nettype none

module apb3_cm_bridge #(
    parameter CLK_FREQ = 25_000_000   // system clock in Hz (for documentation)
) (
    input  wire        clk,
    input  wire        rst_n,         // active-low reset (tie to ~system_reset)

    // APB3 slave port (connected to Sapphire io_apbSlave_0)
    input  wire [31:0] PADDR,
    input  wire        PENABLE,
    input  wire        PSEL,
    input  wire        PWRITE,
    input  wire [31:0] PWDATA,
    output reg  [31:0] PRDATA,
    output wire        PREADY,
    output wire        PSLVERROR,

    // Church Machine control outputs
    output reg         cm_push_button,  // drives push_button on church_ti60f225
                                        // 1 = released (default), 0 = pressed

    // Church Machine status inputs
    input  wire        cm_boot_complete,
    input  wire        cm_fault_valid,
    input  wire [31:0] cm_nia,
    input  wire [4:0]  cm_fault
);

    // ----------------------------------------------------------------
    // APB3 housekeeping — always-ready, never-error slave
    // ----------------------------------------------------------------
    assign PREADY    = 1'b1;
    assign PSLVERROR = 1'b0;

    // Active transfer: PSEL & PENABLE (setup phase gated by PENABLE)
    wire apb_write = PSEL & PENABLE & PWRITE;
    wire apb_read  = PSEL & ~PWRITE;   // read data valid on PSEL (before PENABLE)

    // Register index from address bits [5:2]
    wire [3:0] reg_idx = PADDR[5:2];

    // ----------------------------------------------------------------
    // Sticky fault latch — set on any fault_valid pulse, cleared only
    // by reset (not software-clearable in this revision).
    // ----------------------------------------------------------------
    reg fault_latched;
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            fault_latched <= 1'b0;
        else if (cm_fault_valid)
            fault_latched <= 1'b1;
    end

    // Latch fault code at the moment of fault
    reg [4:0] fault_code_r;
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            fault_code_r <= 5'h0;
        else if (cm_fault_valid)
            fault_code_r <= cm_fault;
    end

    // ----------------------------------------------------------------
    // Write path — CTRL register only
    // ----------------------------------------------------------------
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            cm_push_button <= 1'b1;   // released / idle
        end else if (apb_write) begin
            case (reg_idx)
                4'h0: cm_push_button <= PWDATA[0];  // CTRL
                default: ;
            endcase
        end
    end

    // ----------------------------------------------------------------
    // Read path
    // ----------------------------------------------------------------
    always @(*) begin
        case (reg_idx)
            4'h0: PRDATA = {31'h0, cm_push_button};                  // CTRL
            4'h1: PRDATA = {29'h0, fault_latched,
                            cm_fault_valid, cm_boot_complete};        // STATUS
            4'h2: PRDATA = cm_nia;                                    // NIA
            4'h3: PRDATA = {27'h0, fault_code_r};                    // FAULT
            default: PRDATA = 32'h0;
        endcase
    end

endmodule

`default_nettype wire
