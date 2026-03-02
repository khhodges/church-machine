const HW_BOOT_PROGRAM = [
    0x27440001, // PC=0  CHANGE CR8, CR8, 1  (simulator-only; hardware omits when ENABLE_CHANGE_SWITCH=False)
    0x070B0000, // PC=1  LOAD CR1, [CR6 + 0]
    0x07130001, // PC=2  LOAD CR2, [CR6 + 1]
    0x37100003, // PC=3  TPERM CR2, X
    0x3F100000, // PC=4  LAMBDA CR2
    0x07030006, // PC=5  LOAD CR0, [CR6 + 6]
    0x37000008, // PC=6  TPERM CR0, E
    0x17000000, // PC=7  CALL CR0
    0x073B0001, // PC=8  LOAD CR7, [CR6 + 1]
    0x37380003, // PC=9  TPERM CR7, X
    0x3F380000, // PC=10 LAMBDA CR7
    0x1F028000, // PC=11 RETURN CR5
    0x0F308002, // PC=12 SAVE [CR6 + 2], CR1
];

const HW_NAMESPACE = [
    0x0000FD00, 0x80000008, 0x00000000, // Slot 0: Boot.NS (NS_TABLE_BASE=0xFD00)
    0x00000100, 0x80000008, 0x00000000, // Slot 1: Thread
    0x00000200, 0x80000008, 0x00000000, // Slot 2: Boot.Abstraction
    0x00000300, 0x80000008, 0x00000000, // Slot 3: Boot.CLOOMC
    0x00000400, 0x80000008, 0x00000000, // Slot 4: Abstraction 4
    0x00000500, 0x80000008, 0x00000000, // Slot 5: Abstraction 5
    0x00000600, 0x80000008, 0x00000000, // Slot 6: Abstraction 6
    0x00000700, 0x80000008, 0x00000000, // Slot 7: Abstraction 7
    0x00000800, 0x80000008, 0x00000000, // Slot 8: Abstraction 8
    0x00000900, 0x80000008, 0x00000000, // Slot 9: Abstraction 9
    0x00000A00, 0x80000008, 0x00000000, // Slot 10: Abstraction 10
    0x00000B00, 0x80000008, 0x00000000, // Slot 11: Abstraction 11
    0x00000C00, 0x80000008, 0x00000000, // Slot 12: Abstraction 12
    0x00000D00, 0x80000008, 0x00000000, // Slot 13: Abstraction 13
    0x00000E00, 0x80000008, 0x00000000, // Slot 14: Abstraction 14
    0x00000F00, 0x80000008, 0x00000000, // Slot 15: Abstraction 15
];

const HW_CLIST = [
    0x00000314, // CList[0] Inform RX  → NS idx 3 (Boot.CLOOMC)
    0x00000410, // CList[1] Inform X   → NS idx 4 (LAMBDA target)
    0x00000002, // CList[2] NULL       (SAVE target)
    0x00000280, // CList[3] Inform E   → NS idx 2 (Boot.Abstraction)
    0x00000580, // CList[4] Inform E   → NS idx 5
    0x00000620, // CList[5] Inform L   → NS idx 6
    0x00000480, // CList[6] Inform E   → NS idx 4 (CALL target)
    0x00000002, // CList[7] NULL
];

const HW_NS_LABELS = {
    0: 'Boot.NS',
    1: 'Boot.Thread',
    2: 'Boot.Abstraction',
    3: 'Boot.CLOOMC',
    4: 'Slot 4',
    5: 'Slot 5',
    6: 'Slot 6',
    7: 'Slot 7',
    8: 'Slot 8',
    9: 'Slot 9',
    10: 'Slot 10',
    11: 'Slot 11',
    12: 'Slot 12',
    13: 'Slot 13',
    14: 'Slot 14',
    15: 'Slot 15',
};
