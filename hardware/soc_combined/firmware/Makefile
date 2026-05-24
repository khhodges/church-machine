# hardware/soc_combined/firmware/Makefile
#
# Build bare-metal RISC-V firmware for the combined Sapphire SoC + Church
# Machine bitstream on the Ti60F225.
#
# Produces firmware.hex (plain 32-bit word-per-line hex) for $readmemh
# initialisation of the Sapphire SoC on-chip ROM.
#
# NOTE: Efinity synthesis requires plain hex (one 32-bit word per line),
# NOT Intel HEX format.  The build generates a .bin then converts it.
#
# Toolchain:
#   riscv-none-embed-gcc from the Efinity RISC-V IDE 2025.2 installation.
#   Override TOOLCHAIN on the command line if installed elsewhere, e.g.:
#     make TOOLCHAIN=/opt/riscv/bin

TOOLCHAIN ?= $(HOME)/efinity/efinity-riscv-ide-2025.2/toolchain/bin
CC        := $(TOOLCHAIN)/riscv-none-embed-gcc
OBJCOPY   := $(TOOLCHAIN)/riscv-none-embed-objcopy

CFLAGS := -march=rv32im -mabi=ilp32 -O2 -nostdlib -ffreestanding \
          -Wall -Wextra

SRCS   := crt0.S main.c
TARGET := firmware

.PHONY: all clean

all: $(TARGET).hex

$(TARGET).elf: $(SRCS) link.ld
        $(CC) $(CFLAGS) -T link.ld -o $@ $(SRCS)

$(TARGET).bin: $(TARGET).elf
        $(OBJCOPY) -O binary $< $@

$(TARGET).hex: $(TARGET).bin
        python3 -c "\
import struct, sys; \
data = open('$(TARGET).bin','rb').read(); \
pad = (4 - len(data) % 4) % 4; \
data += b'\x00' * pad; \
[print(f'{struct.unpack_from(\"<I\",data,i)[0]:08x}') for i in range(0,len(data),4)]" \
        > $@

clean:
        rm -f $(TARGET).elf $(TARGET).bin $(TARGET).hex
