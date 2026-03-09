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
    }
];
