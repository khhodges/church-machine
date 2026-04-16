/*
 * Church Machine — BL702 firmware for Tang Nano 20K IoT
 * =======================================================
 *
 * Role: USB-to-UART bridge between host PC and the Gowin GW2AR-18 FPGA
 *       running the Pure Church Lambda Machine.
 *
 * At power-up the BL702 reads its factory-burned 8-byte eFuse chip ID
 * (unique per die, set by Bouffalo Lab during manufacturing) and transmits
 * the 23-byte Church Machine call-home packet over USB CDC before switching
 * into its normal role as a transparent UART ↔ USB bridge.
 *
 * Build: Using Bouffalo Lab BL_MCU_SDK (see CMakeLists_bl702.txt in this dir)
 *   git clone https://github.com/bouffalolab/bl_mcu_sdk
 *   cd bl_mcu_sdk
 *   cmake -DCMAKE_TOOLCHAIN_FILE=cmake/toolchain/riscv32-unknown-elf-gcc.cmake \
 *         -DCHIP=bl702 -DBOARD=bl702_iot \
 *         -DAPP_DIR=<path-to-this-file> -DAPP=bl702_firmware \
 *         -Bbuild -G Ninja
 *   ninja -C build
 *   # Flash via:  blisp --chip bl70x --port /dev/ttyUSB0 write build/bl702_firmware.bin
 *
 * Pin connections (BL702 ↔ Gowin GW2AR-18 on Tang Nano 20K IoT):
 *   BL702 GPIO14 (UART0 TX) -> FPGA UART RX
 *   BL702 GPIO15 (UART0 RX) <- FPGA UART TX
 *
 * Call-home packet layout (23 bytes):
 *   [0..1]   0xCE 0x11          magic
 *   [2]      0x01               board type: TN20K-IoT
 *   [3]      FW_MAJOR           firmware version major
 *   [4]      FW_MINOR           firmware version minor
 *   [5..8]   build_sig[4]       zero (future use)
 *   [9..16]  uid[8]             8-byte BL702 eFuse die unique ID
 *   [17]     0x00               boot reason: cold
 *   [18]     0x00               last fault code: none
 *   [19..22] 0x00000000         fault NIA: none
 *
 * ACK from host bridge: 2 bytes 0xCE 0x22 (ignored; bridge loop starts regardless).
 */

#include <stdint.h>
#include <string.h>

#include "bflb_platform.h"
#include "hal_uart.h"
#include "hal_usb.h"
#include "usbd_cdc.h"
#include "hal_efuse.h"

#define FW_MAJOR        1
#define FW_MINOR        0
#define BOARD_TYPE_IOT  0x01

#define CALLHOME_MAGIC_0  0xCE
#define CALLHOME_MAGIC_1  0x11
#define CALLHOME_PKT_LEN  23

#define CALLHOME_ACK_0    0xCE
#define CALLHOME_ACK_1    0x22

#define FPGA_UART_ID    0
#define FPGA_BAUD       115200

#define USB_ATTACH_DELAY_MS  200
#define BRIDGE_BUF_SIZE      256

static uint8_t uart_rx_buf[BRIDGE_BUF_SIZE];
static uint8_t usb_rx_buf[BRIDGE_BUF_SIZE];

/* ── eFuse chip ID ────────────────────────────────────────────────────────── */

/*
 * read_bl702_chip_id — fill uid[8] with the BL702 die unique ID.
 *
 * The BL702 stores a 64-bit factory-programmed unique ID in eFuse.
 * EF_Ctrl_Read_Chip_ID() reads it via the eFuse controller peripheral.
 * The value is stable across reboots and power cycles; it cannot be changed
 * without Bouffalo Lab's production tooling.
 *
 * SDK header: drivers/bl702_driver/hal_drv/inc/hal_efuse.h
 * HAL function: EF_Ctrl_Read_Chip_ID(uint8_t chipid[8])
 */
static void read_bl702_chip_id(uint8_t uid[8])
{
    EF_Ctrl_Read_Chip_ID(uid);
}

/* ── Call-home packet ─────────────────────────────────────────────────────── */

static void send_callhome_packet(void)
{
    uint8_t uid[8];
    uint8_t pkt[CALLHOME_PKT_LEN];

    read_bl702_chip_id(uid);

    pkt[0]  = CALLHOME_MAGIC_0;
    pkt[1]  = CALLHOME_MAGIC_1;
    pkt[2]  = BOARD_TYPE_IOT;
    pkt[3]  = FW_MAJOR;
    pkt[4]  = FW_MINOR;
    pkt[5]  = 0x00;                /* build_sig[0] */
    pkt[6]  = 0x00;                /* build_sig[1] */
    pkt[7]  = 0x00;                /* build_sig[2] */
    pkt[8]  = 0x00;                /* build_sig[3] */
    memcpy(&pkt[9], uid, 8);       /* uid[8]: BL702 eFuse die ID */
    pkt[17] = 0x00;                /* boot_reason: cold */
    pkt[18] = 0x00;                /* last_fault: none */
    pkt[19] = 0x00;                /* fault_nia[3] MSB */
    pkt[20] = 0x00;
    pkt[21] = 0x00;
    pkt[22] = 0x00;                /* fault_nia[0] LSB */

    /*
     * Wait for the USB host CDC driver to enumerate and attach.
     * Without this delay the packet bytes are dropped before the host
     * opens the port.
     */
    bflb_platform_delay_ms(USB_ATTACH_DELAY_MS);

    usbd_ep_write(CDC_IN_EP, pkt, CALLHOME_PKT_LEN, NULL);
}

/* ── UART ↔ USB transparent bridge ───────────────────────────────────────── */

static void bridge_init(void)
{
    uart_init_cfg_t uart_cfg = {
        .id         = FPGA_UART_ID,
        .baudrate   = FPGA_BAUD,
        .data_bits  = UART_DATA_BITS_8,
        .stop_bits  = UART_STOP_BITS_1,
        .parity     = UART_PARITY_NONE,
        .tx_pin     = 14,   /* GPIO14 on Tang Nano 20K IoT */
        .rx_pin     = 15,   /* GPIO15 on Tang Nano 20K IoT */
        .flow_ctrl  = UART_FLOWCTRL_NONE,
    };
    uart_init(&uart_cfg);
}

static void bridge_task(void)
{
    /* USB CDC → FPGA UART */
    uint32_t usb_len = usbd_ep_read(CDC_OUT_EP, usb_rx_buf, BRIDGE_BUF_SIZE, NULL);
    if (usb_len > 0) {
        uart_write(FPGA_UART_ID, usb_rx_buf, usb_len);
    }

    /* FPGA UART → USB CDC */
    uint32_t uart_len = uart_read(FPGA_UART_ID, uart_rx_buf, BRIDGE_BUF_SIZE);
    if (uart_len > 0) {
        usbd_ep_write(CDC_IN_EP, uart_rx_buf, uart_len, NULL);
    }
}

/* ── Entry point ──────────────────────────────────────────────────────────── */

int main(void)
{
    bflb_platform_init(0);

    /* Initialise USB CDC device */
    usb_init();

    /* Set up FPGA UART */
    bridge_init();

    /* Send call-home packet while USB host attaches */
    send_callhome_packet();

    /* Transparent bridge loop */
    while (1) {
        bridge_task();
    }

    return 0;
}
