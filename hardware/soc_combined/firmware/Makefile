# hardware/soc_combined/firmware/Makefile
#
# Build bare-metal RISC-V firmware for the combined Sapphire SoC + Church
# Machine bitstream on the Ti60F225.
#
# Produces:
#   firmware.hex   — plain 32-bit word-per-line hex (kept for reference)
#   firmware.bin   — raw binary
#   ../EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol{0..3}.bin
#                  — byte-lane split $readmemb files consumed by sapphire.v
#
# sapphire.v uses $readmemb (NOT $readmemh / FIRMWARE_INIT_FILE) to
# initialise the on-chip ROM.  The four symbol files must sit in the same
# directory as sapphire.v (hardware/soc_combined/) when Efinity synthesises.
#
# Toolchain:
#   riscv-none-embed-gcc from the Efinity RISC-V IDE 2025.2 installation.
#   Override TOOLCHAIN on the command line if installed elsewhere, e.g.:
#     make TOOLCHAIN=/opt/riscv/bin

TOOLCHAIN ?= $(HOME)/efinity/efinity-riscv-ide-2025.2/toolchain/bin
CC        := $(TOOLCHAIN)/riscv-none-embed-gcc
OBJCOPY   := $(TOOLCHAIN)/riscv-none-embed-objcopy

# -B$(TOOLCHAIN): tell collect2 to search the Efinity toolchain bin dir first
# for auxiliary programs (ld, as, etc.) so riscv-none-embed-ld is used instead
# of any system riscv64-linux-gnu-ld that may be in PATH.
CFLAGS := -march=rv32im -mabi=ilp32 -O0 -nostdlib -ffreestanding \
          -Wall -Wextra -B$(TOOLCHAIN)

SRCS   := crt0.S main.c
TARGET := firmware

# Directory that contains sapphire.v — the symbol files go here
DESTDIR := ..

# Sapphire ROM depth: 512 KB / 4 bytes = 131072 words
ROM_WORDS := 131072

SYM_PREFIX := $(DESTDIR)/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol
SYM0 := $(SYM_PREFIX)0.bin
SYM1 := $(SYM_PREFIX)1.bin
SYM2 := $(SYM_PREFIX)2.bin
SYM3 := $(SYM_PREFIX)3.bin

.PHONY: all clean

all: $(TARGET).hex $(SYM0) $(SYM1) $(SYM2) $(SYM3)

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

# Generate four byte-lane $readmemb files for sapphire.v.
# Each file has ROM_WORDS lines; each line is an 8-bit binary string.
# symbol0=bits[7:0], symbol1=bits[15:8], symbol2=bits[23:16], symbol3=bits[31:24]
# Words beyond the firmware image are zero-padded.
$(SYM0) $(SYM1) $(SYM2) $(SYM3): $(TARGET).bin
        python3 -c "\
import struct; \
ROM = $(ROM_WORDS); \
data = open('$(TARGET).bin','rb').read(); \
pad = (4 - len(data) % 4) % 4; \
data += b'\x00' * pad; \
words = [struct.unpack_from('<I',data,i)[0] for i in range(0,len(data),4)]; \
words += [0] * (ROM - len(words)); \
words = words[:ROM]; \
lanes = [[], [], [], []]; \
[[ lanes[l].append(format((w >> (l*8)) & 0xFF, '08b')) for l in range(4)] for w in words]; \
names = ['$(SYM0)','$(SYM1)','$(SYM2)','$(SYM3)']; \
[open(names[l],'w').write('\n'.join(lanes[l]) + '\n') for l in range(4)]; \
print(f'Wrote $(ROM_WORDS) words -> 4 symbol files in $(DESTDIR)/')"

clean:
        rm -f $(TARGET).elf $(TARGET).bin $(TARGET).hex
        rm -f $(SYM0) $(SYM1) $(SYM2) $(SYM3)
