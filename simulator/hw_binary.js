const HW_BOOT_PROGRAM = [
    0x27440001, // PC=0  CHANGE CR8, CR8, 1
    0x070B0003, // PC=1  LOAD CR1, [CR6 + 3]  (Boot.Abstr E-GT — self-reference)
    0x07130001, // PC=2  LOAD CR2, [CR6 + 1]
    0x37100003, // PC=3  TPERM CR2, X
    0x3F100000, // PC=4  LAMBDA CR2
    0x07030006, // PC=5  LOAD CR0, [CR6 + 6]
    0x37000008, // PC=6  TPERM CR0, E
    0x17000000, // PC=7  CALL CR0 (Salvation — does not RETURN, transitions to Navana)
];

const HW_NAMESPACE = [
    0x0000FD00, 0x84000008, 0x00000000, // Slot 0: Boot.NS (NS_TABLE_BASE=0xFD00) type=01 Inform
    0x00000100, 0x84000008, 0x00000000, // Slot 1: Boot.Thread type=01 Inform
    0x00000200, 0x841000FF, 0x00000000, // Slot 2: Boot.Abstr type=01 Inform, clistCount=8, limit=0xFF
    0x00000000, 0x00000000, 0x00000000, // Slot 3: (empty)
    0x00000400, 0x84000008, 0x00000000, // Slot 4: Salvation type=01 Inform
    0x00000500, 0x84000008, 0x00000000, // Slot 5: Navana type=01 Inform
    0x00000600, 0x84000008, 0x00000000, // Slot 6: Mint type=01 Inform
    0x00000700, 0x84000008, 0x00000000, // Slot 7: Memory type=01 Inform
    0x00000800, 0x84000008, 0x00000000, // Slot 8: Scheduler type=01 Inform
    0x00000900, 0x84000008, 0x00000000, // Slot 9: Stack type=01 Inform
    0x00000A00, 0x84000008, 0x00000000, // Slot 10: DijkstraFlag type=01 Inform
    0x00000B00, 0x84000008, 0x00000000, // Slot 11: UART type=01 Inform
    0x00000C00, 0x84000008, 0x00000000, // Slot 12: LED type=01 Inform
    0x00000D00, 0x84000008, 0x00000000, // Slot 13: Button type=01 Inform
    0x00000E00, 0x84000008, 0x00000000, // Slot 14: Timer type=01 Inform
    0x00000F00, 0x84000008, 0x00000000, // Slot 15: Display type=01 Inform
    0x00001000, 0x84000008, 0x00000000, // Slot 16: SlideRule type=01 Inform
    0x00001100, 0x84000008, 0x00000000, // Slot 17: Abacus type=01 Inform
];

const HW_CLIST = [
    0x00000000, // CList[0] NULL (was Boot.CLOOMC — now merged into Boot.Abstr)
    0x00000411, // CList[1] Inform X   -> NS idx 4 (Salvation) type=01
    0x00000000, // CList[2] NULL       (SAVE target) type=00
    0x00000281, // CList[3] Inform E   -> NS idx 2 (Boot.Abstr) type=01
    0x00000681, // CList[4] Inform E   -> NS idx 6 (Mint) type=01
    0x00000721, // CList[5] Inform L   -> NS idx 7 (Memory) type=01
    0x00000481, // CList[6] Inform E   -> NS idx 4 (Salvation CALL target) type=01
    0x00000000, // CList[7] NULL type=00
];

const HW_SALVATION_CLIST = [
    0x00000511, // Slot 0: Inform X -> NS idx 5 (Navana CLOOMC) type=01
    0x00000681, // Slot 1: Inform E -> NS idx 6 (reference) type=01
    0x00000581, // Slot 2: Inform E -> NS idx 5 (Navana E-GT for CALL) type=01
];

const HW_SALVATION_CODE = [
    0x070B0000, // PC=0  LOAD CR1, [CR6 + 0]  (Navana CLOOMC)
    0x07130001, // PC=1  LOAD CR2, [CR6 + 1]  (reference)
    0x37080003, // PC=2  TPERM CR1, X
    0x3F080000, // PC=3  LAMBDA CR1            (prove Church reduction)
    0x07030002, // PC=4  LOAD CR0, [CR6 + 2]  (Navana E-GT from c-list slot 2)
    0x17000000, // PC=5  CALL CR0              (transition to Navana — does not RETURN)
];

const HW_NS_LABELS = {
    0: 'Boot.NS',
    1: 'Boot.Thread',
    2: 'Boot.Abstr',
    3: '(empty)',
    4: 'Salvation',
    5: 'Navana',
    6: 'Mint',
    7: 'Memory',
    8: 'Scheduler',
    9: 'Stack',
    10: 'DijkstraFlag',
    11: 'UART',
    12: 'LED',
    13: 'Button',
    14: 'Timer',
    15: 'Display',
    16: 'SlideRule',
    17: 'Abacus',
    18: 'Constants',
    19: 'Circle',
    20: 'SUCC',
    21: 'PRED',
    22: 'ADD',
    23: 'SUB',
    24: 'MUL',
    25: 'ISZERO',
    26: 'TRUE',
    27: 'FALSE',
    28: 'Family',
    29: 'Schoolroom',
    30: 'Friends',
    31: 'Tunnel',
    32: 'Negotiate',
    33: 'Editor',
    34: 'Assembler',
    35: 'Debugger',
    36: 'Deployer',
    37: 'Browser',
    38: 'Messenger',
    39: 'Photos',
    40: 'Social',
    41: 'Video',
    42: 'Email',
    43: 'PAIR',
    44: 'GC',
};

const TANG_NANO_20K = {
    name: 'Tang Nano 20K',
    fpga: 'GW2AR-LV18QN88C8/I7',
    family: 'Gowin GW2AR',
    clockMHz: 27,
    bsram: '41472 bits (BSRAM)',
    luts: 20736,
    uartBridge: 'BL616 USB-C',
    leds: 6,
    buttons: 2,
    hdmi: true,
    sdram: '64Mbit SDRAM',
    flash: '32Mbit NOR Flash',
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        HW_BOOT_PROGRAM, HW_NAMESPACE, HW_CLIST,
        HW_SALVATION_CLIST, HW_SALVATION_CODE, HW_NS_LABELS,
        TANG_NANO_20K
    };
}
