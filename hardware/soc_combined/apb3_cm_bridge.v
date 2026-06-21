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
//  0x10    UID_LO      R/W     [31:0] lower 32 bits of 64-bit device UID.
//                              Written by firmware at boot (e.g. board serial or
//                              a per-device compile-time constant).  Reads back
//                              the last written value.  Reset value: 0x00000000.
//  0x14    UID_HI      R/W     [31:0] upper 32 bits of 64-bit device UID.
//                              Written by firmware at boot.  Reset value: 0x00000000.
//  0x18    FAULT_GT    RO      [31:0] GT word0 of the capability that caused the
//                              fault.  Latched on fault_valid; held until next
//                              boot_start pulse (FAULT_RST).  Requires Track 4-C
//                              bitstream; reads 0x00000000 on earlier bitstreams.
//  0x1C    FAULT_INSTR RO      [31:0] instruction word at the faulting NIA.
//                              Latched on fault_valid; held until FAULT_RST.
//  0x20    FAULT_CR14  RO      [31:0] CR14 word0 at fault time (active abstraction
//                              GT; bits[15:0] = NS slot).  Reserved in current
//                              bitstream; reads 0x00000000.
//  0x24    FAULT_STAGE RO      [3:0] pipeline stage that detected the fault:
//                              0=Fetch/BOUNDS 1=Decode 2=PermCheck 3=Lambda
//                              4=TPERM 5=Call 6=Return 7=DataRW/Other.
//  0x28    FAULT_RST   WO      Write 1 to clear fault_latched and all fault
//                              capture registers atomically.  Used by firmware
//                              after logging a fault to re-arm fault detection.
//  0x2C    RELAY_DATA  WO      Write a byte (bits[7:0]) to begin serialising
//                              it on relay_tx at 57,600 baud (434 cycles/bit
//                              at 25 MHz).  Silently dropped while relay is
//                              busy — always check RELAY_READY first.
//  0x30    RELAY_READY RO      [0] = 1 when shift register is idle and ready
//                              for the next byte.  0 while transmitting.
//
// Together UID_HI:UID_LO form a 64-bit value printed as 16 hex digits in every
// CALLHOME JSON packet so the IDE can distinguish multiple boards of the same
// model.  The firmware writes these registers once during initialisation before
// starting the CM boot-wait loop.
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
    input  wire [4:0]  cm_fault,

    // GT fault telemetry inputs (Track 4-C — latched by core on fault_valid)
    input  wire [31:0] cm_fault_gt,    // +0x18 FAULT_GT
    input  wire [31:0] cm_fault_instr, // +0x1C FAULT_INSTR
    input  wire [31:0] cm_fault_cr14,  // +0x20 FAULT_CR14
    input  wire [3:0]  cm_fault_stage, // +0x24 FAULT_STAGE

    // UART-TX relay (internal — OR-gated with cm_uart_rx in top.v)
    output wire        relay_tx        // serialised lump bytes at 57,600 baud
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
    // Sticky fault latch — set on any fault_valid pulse, cleared by
    // reset or by a write-1-to-clear to FAULT_RST (offset 0x28).
    // ----------------------------------------------------------------
    reg fault_latched;
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            fault_latched <= 1'b0;
        else if (apb_write && reg_idx == 4'hA && PWDATA[0])
            fault_latched <= 1'b0;       // FAULT_RST write-1-to-clear
        else if (cm_fault_valid)
            fault_latched <= 1'b1;
    end

    // Latch fault code at the moment of fault; cleared by FAULT_RST
    reg [4:0] fault_code_r;
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            fault_code_r <= 5'h0;
        else if (apb_write && reg_idx == 4'hA && PWDATA[0])
            fault_code_r <= 5'h0;        // FAULT_RST write-1-to-clear
        else if (cm_fault_valid)
            fault_code_r <= cm_fault;
    end

    // ----------------------------------------------------------------
    // GT fault telemetry latches (+0x18..+0x24)
    // Inputs cm_fault_gt/instr/cr14/stage are already latched by the
    // CM core on fault_valid; we simply register them here for timing
    // safety across the APB3 boundary.
    // ----------------------------------------------------------------
    reg [31:0] fault_gt_r;
    reg [31:0] fault_instr_r;
    reg [31:0] fault_cr14_r;
    reg [3:0]  fault_stage_r;
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            fault_gt_r    <= 32'h0;
            fault_instr_r <= 32'h0;
            fault_cr14_r  <= 32'h0;
            fault_stage_r <= 4'h0;
        end else if (apb_write && reg_idx == 4'hA && PWDATA[0]) begin
            fault_gt_r    <= 32'h0;       // FAULT_RST clears all capture regs
            fault_instr_r <= 32'h0;
            fault_cr14_r  <= 32'h0;
            fault_stage_r <= 4'h0;
        end else if (cm_fault_valid) begin
            fault_gt_r    <= cm_fault_gt;
            fault_instr_r <= cm_fault_instr;
            fault_cr14_r  <= cm_fault_cr14;
            fault_stage_r <= cm_fault_stage;
        end
    end

    // ----------------------------------------------------------------
    // 64-bit software-writable device UID register
    //
    // The SoC firmware writes UID_LO then UID_HI during initialisation
    // before waiting for CM boot_complete.  The IDE reads the values
    // back via the CALLHOME JSON line emitted by the firmware's monitor
    // loop.  Two boards configured with different UIDs will appear as
    // distinct entries in the IDE Dashboard device list.
    // ----------------------------------------------------------------
    reg [31:0] uid_lo_r;
    reg [31:0] uid_hi_r;

    // ----------------------------------------------------------------
    // Write path — CTRL, UID_LO, UID_HI registers
    // ----------------------------------------------------------------
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            cm_push_button <= 1'b1;   // released / idle
            uid_lo_r       <= 32'h0;
            uid_hi_r       <= 32'h0;
        end else if (apb_write) begin
            case (reg_idx)
                4'h0: cm_push_button <= PWDATA[0];  // CTRL
                4'h4: uid_lo_r       <= PWDATA;     // UID_LO  (offset 0x10)
                4'h5: uid_hi_r       <= PWDATA;     // UID_HI  (offset 0x14)
                default: ;
            endcase
        end
    end

    // ----------------------------------------------------------------
    // UART-TX relay — streams bytes to cm_uart_rx at 57,600 baud
    //
    // 10-bit frame: start(0) + data[7:0] LSB-first + stop(1)
    // Bit period = CLK_FREQ / 57_600 = 434 cycles at 25 MHz
    // relay_tx idles HIGH; OR-gated with cm_uart_rx pin in top.v
    // ----------------------------------------------------------------
    localparam BAUD_DIV = CLK_FREQ / 57_600;   // 434 at 25 MHz

    reg [9:0]  relay_shift;      // {stop=1, data[7:0], start=0}, shift right
    reg [8:0]  relay_baud_cnt;   // 0 .. BAUD_DIV-1 (needs 9 bits for 434)
    reg [3:0]  relay_bit_cnt;    // 0 .. 9 (10 bits per frame)
    reg        relay_busy;

    assign relay_tx = relay_busy ? relay_shift[0] : 1'b1;

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            relay_shift    <= 10'h3FF;
            relay_baud_cnt <= 9'h0;
            relay_bit_cnt  <= 4'h0;
            relay_busy     <= 1'b0;
        end else if (apb_write && reg_idx == 4'hB && !relay_busy) begin
            // RELAY_DATA write — load 10-bit frame and begin transmission
            relay_shift    <= {1'b1, PWDATA[7:0], 1'b0};
            relay_baud_cnt <= 9'h0;
            relay_bit_cnt  <= 4'h0;
            relay_busy     <= 1'b1;
        end else if (relay_busy) begin
            if (relay_baud_cnt == BAUD_DIV - 1) begin
                relay_baud_cnt <= 9'h0;
                relay_shift    <= {1'b1, relay_shift[9:1]};   // shift right, fill 1
                if (relay_bit_cnt == 4'd9) begin
                    relay_busy <= 1'b0;                        // stop bit done
                end else begin
                    relay_bit_cnt <= relay_bit_cnt + 4'h1;
                end
            end else begin
                relay_baud_cnt <= relay_baud_cnt + 9'h1;
            end
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
            4'h4: PRDATA = uid_lo_r;                                  // UID_LO
            4'h5: PRDATA = uid_hi_r;                                  // UID_HI
            4'h6: PRDATA = fault_gt_r;                                // FAULT_GT   (+0x18)
            4'h7: PRDATA = fault_instr_r;                             // FAULT_INSTR (+0x1C)
            4'h8: PRDATA = fault_cr14_r;                              // FAULT_CR14  (+0x20)
            4'h9: PRDATA = {28'h0, fault_stage_r};                   // FAULT_STAGE (+0x24)
            4'hC: PRDATA = {31'h0, ~relay_busy};                     // RELAY_READY (+0x30)
            default: PRDATA = 32'h0;
        endcase
    end

endmodule

`default_nettype wire
