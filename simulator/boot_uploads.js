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
        abstraction: 'Boot.CList',
        type: 'boot',
        index: 2,
        grants: ['E'],
        capabilities: [],
        methods: []
    },
    {
        abstraction: 'Boot.CLOOMC',
        type: 'boot',
        index: 3,
        grants: ['X'],
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
            { name: 'Init', code: [] },
            { name: 'Add', code: [] },
            { name: 'Remove', code: [] },
            { name: 'Abstraction.Add', code: [] },
            { name: 'Abstraction.Remove', code: [] },
            { name: 'Abstraction.Update', code: [] },
            { name: 'Manage', code: [] },
            { name: 'Monitor', code: [] },
            { name: 'IDS', code: [] }
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
            { name: 'Create', code: [] },
            { name: 'Revoke', code: [] },
            { name: 'Transfer', code: [] }
        ]
    },
    {
        abstraction: 'Memory',
        type: 'abstraction',
        index: 7,
        grants: ['E'],
        capabilities: [],
        methods: [
            { name: 'Allocate', code: [] },
            { name: 'Free', code: [] },
            { name: 'Resize', code: [] }
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
