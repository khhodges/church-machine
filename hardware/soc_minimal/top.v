// hardware/soc_minimal/top.v
//
// Top-level Verilog for the Sapphire SoC minimal UART gate test.
// Device: Efinix Ti60F225   Clock: 25 MHz (no PLL)   Baud: 115200
//
// NOTE: sapphire.v and sapphire_define.vh must be copied into this
// directory by the user before synthesis — see BUILD_SOC.md.
//
// The FIRMWARE_INIT_FILE parameter tells the Sapphire SoC to pre-load
// its on-chip ROM from firmware.hex at elaboration time ($readmemh).
// Efinity requires firmware.hex to be in the project working directory
// (hardware/soc_minimal/) when you open and compile the project.

`default_nettype none

module top (
    input  wire clk,           // 25 MHz crystal — GPIOL_P_18 via CLKMUX_T
    output wire uart_tx,       // GPIOL_02 → FT4232H interface 2 → ttyUSB2
    input  wire uart_rx,       // GPIOL_01 ← FT4232H interface 2
    input  wire push_button,   // GPIOT_N_06, active-low, weak pull-up
    output wire led0,          // GPIOR_P_07  on = SoC out of reset
    output wire led1,          // GPIOR_P_08  reserved (off)
    output wire led2            // GPIOR_P_09  reserved (off)
);

    // ----------------------------------------------------------------
    // Internal signals
    // ----------------------------------------------------------------
    wire system_reset;         // active-HIGH reset driven by Sapphire SoC

    // ----------------------------------------------------------------
    // Sapphire SoC instantiation
    //
    // Port list from sapphire_tmpl.v (Efinix IP 2025.2).
    // SPI and APB slave ports are not used in this minimal design.
    // JTAG ports are tied off (no JTAG debugging).
    // ----------------------------------------------------------------
    sapphire #(
        .FIRMWARE_INIT_FILE("firmware.hex")
    ) u_sapphire (
        // Clocks and resets
        .io_systemClk           (clk),
        .io_asyncReset          (1'b0),
        .io_systemReset         (system_reset),

        // UART0 — wired to FT4232H interface 2 (ttyUSB2)
        .system_uart_0_io_txd   (uart_tx),
        .system_uart_0_io_rxd   (uart_rx),

        // SPI0 — not used; tie all inputs/outputs to safe values
        .system_spi_0_io_data_0_read        (1'b0),
        .system_spi_0_io_data_0_write       (),
        .system_spi_0_io_data_0_writeEnable (),
        .system_spi_0_io_data_1_read        (1'b0),
        .system_spi_0_io_data_1_write       (),
        .system_spi_0_io_data_1_writeEnable (),
        .system_spi_0_io_data_2_read        (1'b0),
        .system_spi_0_io_data_2_write       (),
        .system_spi_0_io_data_2_writeEnable (),
        .system_spi_0_io_data_3_read        (1'b0),
        .system_spi_0_io_data_3_write       (),
        .system_spi_0_io_data_3_writeEnable (),
        .system_spi_0_io_sclk_write         (),
        .system_spi_0_io_ss                 (),       // SPI not used — leave unconnected

        // APB slave 0 — not used; always-ready, no error, no read data
        .io_apbSlave_0_PADDR    (),
        .io_apbSlave_0_PENABLE  (),
        .io_apbSlave_0_PSEL     (),
        .io_apbSlave_0_PWRITE   (),
        .io_apbSlave_0_PWDATA   (),
        .io_apbSlave_0_PREADY   (1'b1),
        .io_apbSlave_0_PSLVERROR(1'b0),
        .io_apbSlave_0_PRDATA   (32'h0),

        // JTAG — tied off (not used)
        .jtagCtrl_enable  (1'b0),
        .jtagCtrl_tdi     (1'b0),
        .jtagCtrl_capture (1'b0),
        .jtagCtrl_shift   (1'b0),
        .jtagCtrl_update  (1'b0),
        .jtagCtrl_reset   (1'b1),   // 1 = TAP not in reset; 0 freezes io_systemReset HIGH
        .jtagCtrl_tdo     (),
        .jtagCtrl_tck     (1'b0)
    );

    // ----------------------------------------------------------------
    // LED logic
    //   led0 = on when the SoC is out of reset (confirms boot)
    //   led1, led2 = reserved, off
    // ----------------------------------------------------------------
    assign led0 = ~system_reset;
    assign led1 = 1'b0;
    assign led2 = 1'b0;

endmodule

`default_nettype wire
