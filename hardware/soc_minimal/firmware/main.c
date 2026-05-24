/*
 * hardware/soc_minimal/firmware/main.c
 *
 * Bare-metal RISC-V firmware for the Sapphire SoC minimal UART gate test.
 * Sends "CHURCH Ti60 v1.0\r\n" over UART0 on boot, then loops forever.
 *
 * Target: Efinix Ti60F225, Sapphire SoC, 25 MHz, 115200 baud
 * No libc, no OS.
 *
 * Sapphire SoC UART0 register map (SpinalHDL UART, standard Efinix addresses):
 *   0xF0010000 + 0x00  TX/RX data  (write = transmit byte)
 *   0xF0010000 + 0x04  Status      (bit 0 = TX not full / ready to accept byte)
 *
 * If sapphire_define.vh shows a different UART0 base, update UART_BASE below.
 */

#define UART_BASE   0xF0010000UL
#define UART_DATA   (*(volatile unsigned int *)(UART_BASE + 0x00))
#define UART_STATUS (*(volatile unsigned int *)(UART_BASE + 0x04))
#define UART_TX_READY (UART_STATUS & 1u)

static void uart_putc(char c)
{
    while (!UART_TX_READY)
        ;
    UART_DATA = (unsigned int)(unsigned char)c;
}

static void uart_puts(const char *s)
{
    while (*s)
        uart_putc(*s++);
}

int main(void)
{
    uart_puts("CHURCH Ti60 v1.0\r\n");
    for (;;)
        ;
    return 0;
}
