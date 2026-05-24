# hardware/soc_minimal/firmware/Makefile
#
# Build bare-metal RISC-V firmware for the Sapphire SoC UART gate test.
# Produces firmware.hex (Intel HEX) for $readmemh initialisation of the
# Sapphire SoC on-chip ROM.
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

$(TARGET).hex: $(TARGET).elf
	$(OBJCOPY) -O ihex $< $@

clean:
	rm -f $(TARGET).elf $(TARGET).hex
