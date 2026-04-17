// =============================================================================
// boot_uploads.js — Boot-Time Abstraction Upload Manifest
// =============================================================================
//
// Defines BOOT_UPLOADS: the ordered list of abstractions that are installed
// into the Namespace (NS) table when the simulator boots.  Each entry
// describes one NS slot — its name, type, NS index, and the grants /
// capabilities / methods it exposes.
//
// This file is the JS-side counterpart of hardware/boot_rom.py
// DEMO_NAMESPACE and DEMO_CLIST.  The simulator reads BOOT_UPLOADS during
// the boot sequence to populate NS[0]..NS[45] before the first user
// instruction executes.
//
// STRUCTURE OF EACH ENTRY
//   abstraction  string   Human-readable name (e.g. "Boot.Kernel")
//   type         string   "boot" for all boot-time entries
//   index        number   NS slot number (0-based; must be unique and dense)
//   grants       array    Permission tokens this abstraction may issue
//   capabilities array    GT references it holds in its c-list at boot
//   methods      array    Named entry points (each is an assembly snippet)
//
// NS SLOT LAYOUT AT BOOT  (derived from system_abstractions.js)
//   NS[0]   Boot.NS          — namespace root (protected; never GC'd)
//   NS[1]   Boot.Thread      — thread lump (256 words; holds DRs, stack, caps)
//   NS[2]   Boot.Memory      — memory allocator
//   NS[3]   Boot.Kernel      — kernel / privilege gate
//   NS[4]   Boot.Init        — initialisation sequence abstraction
//   NS[5]   Boot.Security    — capability seal / unseal
//   NS[6]   Boot.IPC         — inter-process communication
//   NS[7]   Boot.IRQ         — interrupt routing
//   NS[8]   Boot.Fault       — capability fault handler
//   NS[9]   Boot.Debug       — debugger / single-step hook
//   NS[10]  Boot.Log         — kernel log ring buffer
//   NS[11]  Boot.Clock       — real-time clock / timer
//   NS[12]  Boot.Power       — power management
//   NS[13]  Boot.Config      — persistent configuration store
//   NS[14]  Boot.Update      — firmware update gate
//   NS[15]  Boot.Reset       — controlled reset / reboot
//   NS[16+] User / system abstractions (see system_abstractions.js)
//
// HARDWARE CROSS-REFERENCE
//   hardware/boot_rom.py   DEMO_NAMESPACE — same slots in Amaranth HDL
//   hardware/boot_rom.py   DEMO_CLIST     — boot c-list contents (8 GTs)
//   simulator/simulator.js _bootStep()    — reads BOOT_UPLOADS to init NS
//   simulator/system_abstractions.js      — full method bodies for each slot
//
// =============================================================================

function detectBootUploadProfile(entry) {
    if (!entry.methods || entry.methods.length === 0) return 'IoT';
    if (typeof detectProfile === 'function') return detectProfile(entry.methods);
    if (typeof FULL_ONLY_OPCODES === 'undefined') return 'IoT';
    for (const m of entry.methods) {
        if (!m.code) continue;
        for (const word of m.code) {
            const opcode = (word >>> 27) & 0x1F;
            if (FULL_ONLY_OPCODES.includes(opcode)) return 'Full';
        }
    }
    return 'IoT';
}

function checkUploadProfile(upload, boardType) {
    const profile = upload.profile || detectBootUploadProfile(upload);
    if (profile === 'Full' && boardType === 'tang-nano-20k') {
        return {
            allowed: false,
            message: `Abstraction "${upload.abstraction || upload.name || 'unknown'}" is tagged "${profile}" (uses Full-only opcodes: LAMBDA, CHANGE, SWITCH, ELOADCALL, or XLOADLAMBDA). It cannot run on the Tang Nano 20K (IoT profile). Use the Ti60 F225 instead.`
        };
    }
    return { allowed: true };
}

const BOOT_UPLOADS = [
    {
        abstraction: 'Boot.NS',
        type: 'boot',
        index: 0,
        grants: [],
        capabilities: [],
        methods: []
    },
    {
        abstraction: 'Boot.Thread',
        type: 'boot',
        index: 1,
        grants: [],
        capabilities: [],
        methods: []
    },
    {
        abstraction: 'Boot.Abstr',
        type: 'boot',
        index: 2,
        grants: ['E'],
        capabilities: [],
        methods: []
    },
    {
        abstraction: '(empty)',
        type: 'boot',
        index: 3,
        grants: [],
        capabilities: [],
        methods: []
    },
    {
        abstraction: 'Salvation',
        type: 'abstraction',
        index: 4,
        grants: ['E'],
        capabilities: [],
        methods: [
            { name: 'LOAD', code: [0x19C00000] },
            { name: 'TPERM', code: [0x19C00000] },
            { name: 'LAMBDA', code: [0x19C00000] },
            { name: 'TransitionToNavana', code: [0x19C00000] }
        ]
    },
    {
        abstraction: 'Navana',
        type: 'abstraction',
        index: 5,
        grants: ['E'],
        capabilities: [
            { target: 7, name: 'Memory', grants: ['E'] },
            { target: 6, name: 'Mint', grants: ['E'] }
        ],
        methods: [
            { name: 'Init', code: [0x7F600001, 0x7F060000, 0x1F000000] },
            { name: 'Add', code: [0x1F000000] },
            { name: 'Remove', code: [0x7F600000, 0x7F060000, 0x1F000000] },
            { name: 'Abstraction.Add', code: [0x7F008000, 0x07030000, 0x17000000, 0x7F200000, 0x7F020000, 0x1F000000] },
            { name: 'Abstraction.Remove', code: [0x7F600000, 0x7F060000, 0x1F000000] },
            { name: 'Abstraction.Update', code: [0x1F000000] },
            { name: 'Manage', code: [0x19C00000] },
            { name: 'Monitor', code: [0x19C00000] },
            { name: 'IDS', code: [0x19C00000] }
        ]
    },
    {
        abstraction: 'Mint',
        type: 'abstraction',
        index: 6,
        grants: ['E'],
        capabilities: [
            { target: 7, name: 'Memory', grants: ['E'] }
        ],
        methods: [
            { name: 'Create', code: [0x07030000, 0x17000000, 0x7F200000, 0x7F020000, 0x1F000000] },
            { name: 'Revoke', code: [0x57638002, 0x7F260000, 0x67620327, 0x7F2E0000, 0x7F628001, 0x7F360000, 0x6F230327, 0x5F238002, 0x7F030000, 0x1F000000] },
            { name: 'Transfer', code: [0x1F000000] }
        ]
    },
    {
        abstraction: 'Memory',
        type: 'abstraction',
        index: 7,
        grants: ['E'],
        capabilities: [],
        methods: [
            { name: 'Allocate', code: [0x7F6000FF, 0x7F260000, 0x9F620008, 0x7F260000, 0x97620008, 0x7F260000, 0x57638000, 0x7F2E0000, 0x7F628000, 0x7F660000, 0x7F360000, 0x5F338000, 0x7F028000, 0x7F0A0000, 0x1F000000] },
            { name: 'Free', code: [0x5F038001, 0x7F600000, 0x7F060000, 0x1F000000] },
            { name: 'Resize', code: [0x1F000000] }
        ]
    },
    {
        abstraction: 'Scheduler',
        type: 'abstraction',
        index: 8,
        grants: ['E'],
        capabilities: [],
        methods: [
            { name: 'Yield', code: [0x19C00000] },
            { name: 'Spawn', code: [0x19C00000] },
            { name: 'Wait', code: [0x19C00000] },
            { name: 'Stop', code: [0x19C00000] }
        ]
    },
    {
        abstraction: 'Stack',
        type: 'abstraction',
        index: 9,
        grants: ['E'],
        capabilities: [],
        methods: [
            { name: 'Push', code: [0x19C00000] },
            { name: 'Pop', code: [0x19C00000] },
            { name: 'Peek', code: [0x19C00000] },
            { name: 'Depth', code: [0x19C00000] }
        ]
    },
    {
        abstraction: 'DijkstraFlag',
        type: 'abstraction',
        index: 10,
        grants: ['E'],
        capabilities: [],
        methods: [
            { name: 'Wait', code: [0x19C00000] },
            { name: 'Signal', code: [0x19C00000] },
            { name: 'Reset', code: [0x19C00000] },
            { name: 'Test', code: [0x19C00000] }
        ]
    },
    {
        abstraction: 'UART',
        type: 'boot',
        index: 11,
        grants: ['L', 'S', 'E'],
        capabilities: [],
        methods: []
    },
    {
        abstraction: 'LED',
        type: 'boot',
        index: 12,
        grants: ['L', 'S', 'E'],
        capabilities: [],
        methods: []
    },
    {
        abstraction: 'Button',
        type: 'boot',
        index: 13,
        grants: ['L', 'E'],
        capabilities: [],
        methods: []
    },
    {
        abstraction: 'Timer',
        type: 'boot',
        index: 14,
        grants: ['L', 'S', 'E'],
        capabilities: [],
        methods: []
    },
    {
        abstraction: 'Display',
        type: 'boot',
        index: 15,
        grants: ['L', 'S', 'E'],
        capabilities: [],
        methods: []
    },
    {
        abstraction: 'Loader',
        type: 'abstraction',
        index: 19,
        grants: ['E'],
        capabilities: [
            { target: 5, name: 'Navana', grants: ['E'] },
            { target: 6, name: 'Mint', grants: ['E'] },
            { target: 7, name: 'Memory', grants: ['E'] },
            { target: 11, name: 'UART', grants: ['E'] }
        ],
        methods: [
            { name: 'Load', code: [0x7F600000, 0x7F060000, 0x1F000000] },
            { name: 'Prefetch', code: [0x7F600000, 0x7F060000, 0x1F000000] },
            { name: 'Evict', code: [0x7F600000, 0x7F060000, 0x1F000000] }
        ]
    },
    {
        abstraction: 'SlideRule',
        type: 'boot',
        index: 16,
        grants: ['E'],
        capabilities: [
            { target: 18, name: 'Constants', grants: ['E'] }
        ],
        methods: [
            { name: 'Multiply', code: [
                0x7f600000, 0x7f260000, 0x7f600000, 0x7f2e0000, 0x7f600000,
                0x770e0000, 0x8d00000c, 0x7f600000, 0x87660000, 0x7f0e0000,
                0x7f600001, 0x7f2e0000, 0x7f600000, 0x770e0000, 0x8e807fff,
                0x67608001, 0x7f360000, 0x7f600001, 0x77360000, 0x88800017,
                0x7f620000, 0x7f660000, 0x7f260000, 0x97600001, 0x7f060000,
                0x9f608001, 0x7f0e0000, 0x7f600001, 0x772e0000, 0x88800021,
                0x7f600000, 0x87660000, 0x7f260000, 0x7f020000, 0x1f000000
            ]},
            { name: 'Divide', code: [
                0x7f600000, 0x770e0000, 0x88800006, 0x7f600000, 0x7f060000,
                0x1f000000, 0x7f600000, 0x7f260000, 0x7f600000, 0x77060000,
                0x8d000010, 0x7f600000, 0x87660000, 0x7f060000, 0x7f620001,
                0x7f260000, 0x7f600000, 0x770e0000, 0x8d000018, 0x7f600000,
                0x87660000, 0x7f0e0000, 0x7f620001, 0x7f260000, 0x7f600000,
                0x7f2e0000, 0x77008000, 0x8d807fff, 0x87600000, 0x7f060000,
                0x7f628001, 0x7f2e0000, 0x7f600001, 0x77260000, 0x88800026,
                0x7f600000, 0x87660000, 0x7f2e0000, 0x7f028000, 0x1f000000
            ]},
            { name: 'Sqrt', code: [
                0x7f600000, 0x77060000, 0x88800006, 0x7f600000, 0x7f060000,
                0x1f000000, 0x7f600001, 0x77060000, 0x8880000c, 0x7f600001,
                0x7f060000, 0x1f000000, 0x9f600001, 0x7f260000, 0x7f600000,
                0x7f2e0000, 0x7f600014, 0x772e0000, 0x8d007fff, 0x7f600000,
                0x7f360000, 0x7f380000, 0x773a0000, 0x8d807fff, 0x87638000,
                0x7f3e0000, 0x7f630001, 0x7f360000, 0x7f620000, 0x7f660000,
                0x7f460000, 0x9f640001, 0x7f460000, 0x7f240000, 0x7f628001,
                0x7f2e0000, 0x7f020000, 0x1f000000
            ]},
            { name: 'Mod', code: [0x19C00000] },
            { name: 'Sin', code: [0x19C00000] },
            { name: 'Cos', code: [0x19C00000] },
            { name: 'Tan', code: [0x19C00000] },
            { name: 'Asin', code: [0x19C00000] },
            { name: 'Acos', code: [0x19C00000] },
            { name: 'Atan', code: [0x19C00000] },
            { name: 'ToDegrees', code: [0x1f000000] },
            { name: 'ToRadians', code: [0x1f000000] },
            { name: 'Bernoulli', code: [0x19C00000] }
        ]
    },
    {
        abstraction: 'Abacus',
        type: 'boot',
        index: 17,
        grants: ['E'],
        capabilities: [],
        methods: [
            { name: 'Add', code: [0x7f600000, 0x7f660000, 0x7f260000, 0x7f020000, 0x1f000000] },
            { name: 'Sub', code: [0x87600000, 0x7f260000, 0x7f020000, 0x1f000000] },
            { name: 'Mul', code: [0x19C00000] },
            { name: 'Div', code: [0x19C00000] },
            { name: 'Mod', code: [0x19C00000] },
            { name: 'Abs', code: [0x19C00000] }
        ]
    },
    {
        abstraction: 'Constants',
        type: 'boot',
        index: 18,
        grants: ['E'],
        capabilities: [],
        data_words: [
            0x40490FDB,
            0x402DF854,
            0x3FCF1BBD,
            0x00000000,
            0x3F800000
        ],
        methods: [
            { name: 'Pi',   code: [0x1f000000] },
            { name: 'E',    code: [0x1f000000] },
            { name: 'Phi',  code: [0x1f000000] },
            { name: 'Zero', code: [0x1f000000] },
            { name: 'One',  code: [0x1f000000] }
        ]
    }
];
