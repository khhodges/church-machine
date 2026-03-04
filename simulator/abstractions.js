class AbstractionRegistry {
    constructor() {
        this.abstractions = {};
        this.layers = {};
        this._registerAll();
    }

    createAbstraction(index, name, layer, methods, description, options) {
        options = options || {};
        const abstraction = {
            index: index,
            name: name,
            layer: layer,
            methods: methods || [],
            description: description || '',
            perms: options.perms || { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 },
            chainable: options.chainable || false,
            handler: options.handler || null,
            dispatch: {},
            faultCount: 0,
            firstActiveTime: null,
            lastFaultTime: null
        };

        for (const m of methods) {
            abstraction.dispatch[m.toUpperCase()] = null;
        }

        this.abstractions[index] = abstraction;
        if (!this.layers[layer]) this.layers[layer] = [];
        this.layers[layer].push(abstraction);

        return abstraction;
    }

    create(index, params) {
        const a = this.abstractions[index];
        if (!a) return { ok: false, fault: 'ABSTRACTION', message: `Abstraction ${index} not found` };
        return { ok: true, result: { index: index, name: a.name, layer: a.layer, methods: a.methods, perms: a.perms } };
    }

    destroy(index) {
        const a = this.abstractions[index];
        if (!a) return { ok: false, fault: 'ABSTRACTION', message: `Abstraction ${index} not found` };
        return { ok: true, result: { index: index, name: a.name }, message: `Destroy ${a.name}: Mint.Revoke invalidates GT, Memory.Free releases memory` };
    }

    call(index, methodName, sim, args) {
        return this.dispatchMethod(index, methodName, sim, args);
    }

    inspect(index) {
        const a = this.abstractions[index];
        if (!a) return { ok: false, fault: 'ABSTRACTION', message: `Abstraction ${index} not found` };
        return {
            ok: true,
            result: {
                index: a.index, name: a.name, layer: a.layer,
                methods: a.methods, description: a.description,
                perms: a.perms, chainable: a.chainable,
                faultCount: a.faultCount,
                mtbf: this.getMTBF(index)
            }
        };
    }

    reportFault(index) {
        const a = this.abstractions[index];
        if (!a) return;
        a.faultCount++;
        a.lastFaultTime = Date.now();
        if (!a.firstActiveTime) a.firstActiveTime = Date.now();
    }

    activate(index) {
        const a = this.abstractions[index];
        if (!a) return;
        if (!a.firstActiveTime) a.firstActiveTime = Date.now();
    }

    getMTBF(index) {
        const a = this.abstractions[index];
        if (!a || !a.firstActiveTime || a.faultCount === 0) return Infinity;
        const uptimeMs = Date.now() - a.firstActiveTime;
        return uptimeMs / a.faultCount;
    }

    bindMethod(index, methodName, fn) {
        const a = this.abstractions[index];
        if (!a) return false;
        a.dispatch[methodName.toUpperCase()] = fn;
        return true;
    }

    addMethod(index, name, fn) {
        const a = this.abstractions[index];
        if (!a) return false;
        const upper = name.toUpperCase();
        if (!a.methods.includes(name) && !a.methods.map(m => m.toUpperCase()).includes(upper)) {
            a.methods.push(name);
        }
        a.dispatch[upper] = fn || null;
        return true;
    }

    removeMethod(index, name) {
        const a = this.abstractions[index];
        if (!a) return false;
        const upper = name.toUpperCase();
        a.methods = a.methods.filter(m => m.toUpperCase() !== upper);
        delete a.dispatch[upper];
        return true;
    }

    getAbstraction(index) {
        return this.abstractions[index] || null;
    }

    getByName(name) {
        for (const idx in this.abstractions) {
            if (this.abstractions[idx].name === name) return this.abstractions[idx];
        }
        return null;
    }

    getLayer(layerNum) {
        return this.layers[layerNum] || [];
    }

    getAllAbstractions() {
        const result = [];
        const indices = Object.keys(this.abstractions).map(Number).sort((a, b) => a - b);
        for (const idx of indices) {
            result.push(this.abstractions[idx]);
        }
        return result;
    }

    getLayerNames() {
        return {
            0: 'Boot',
            1: 'System Services',
            2: 'Hardware Attachments',
            3: 'Mathematics',
            4: 'Lambda Calculus',
            5: 'Social Abstractions',
            6: 'IDE Abstractions',
            7: 'Internet Abstractions',
            8: 'Garbage Collection'
        };
    }

    dispatchMethod(index, methodName, sim, args) {
        const a = this.abstractions[index];
        if (!a) return { ok: false, fault: 'ABSTRACTION', message: `Abstraction ${index} not found` };
        const fn = a.dispatch[methodName.toUpperCase()];
        if (!fn) return { ok: false, fault: 'METHOD', message: `Method ${methodName} not found on ${a.name}` };
        return fn(sim, args);
    }

    count() {
        return Object.keys(this.abstractions).length;
    }

    getPolymorphicInterface() {
        return ['create', 'destroy', 'call', 'inspect'];
    }

    _registerAll() {
        this.createAbstraction(0, 'Boot.NS', 0, [],
            'Namespace root (location = NS_TABLE_BASE)',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 0 } });

        this.createAbstraction(1, 'Boot.Thread', 0, [],
            'Initial thread identity (CR8)',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 0 } });

        this.createAbstraction(2, 'Boot.CList', 0, [],
            'Boot abstraction c-list (CR6)',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(3, 'Boot.CLOOMC', 0, [],
            'Boot code entry point (CR7) — code is a DATA-domain object, accessed via X permission',
            { perms: { R: 0, W: 0, X: 1, L: 0, S: 0, E: 0 } });

        this.createAbstraction(4, 'Salvation', 1,
            ['LOAD', 'TPERM', 'LAMBDA', 'TransitionToNavana'],
            'First callable abstraction — proves CALL works, then transitions to Navana (does not RETURN)',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(5, 'Navana', 1,
            ['Init', 'Add', 'Remove', 'Abstraction.Add', 'Abstraction.Remove', 'Abstraction.Update', 'Manage', 'Monitor', 'IDS'],
            'Namespace controller — master NS writer, runs indefinitely, manages all abstractions via uploads (does not RETURN)',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(6, 'Mint', 1,
            ['Create', 'Revoke', 'Transfer'],
            'GT lifecycle — creates new GTs with bounded permissions',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(7, 'Memory', 1,
            ['Allocate', 'Free', 'Resize'],
            'Memory allocation — reserves memory regions for DATA objects (does not manage the NS table)',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(8, 'Scheduler', 1,
            ['Yield', 'Spawn', 'Wait', 'Stop'],
            'Thread scheduling — manages time slices and thread lifecycle',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(9, 'Stack', 1,
            ['Push', 'Pop', 'Peek', 'Depth'],
            'Managed call stack — hardware-enforced overflow protection',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 }, chainable: true });

        this.createAbstraction(10, 'DijkstraFlag', 1,
            ['Wait', 'Signal', 'Reset', 'Test'],
            'Dijkstra semaphore for inter-thread messaging and synchronization',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(11, 'UART', 2,
            ['Send', 'Receive', 'SetBaud'],
            'Serial communication — Tang Nano 20K BL616 bridge',
            { perms: { R: 0, W: 0, X: 0, L: 1, S: 1, E: 1 } });

        this.createAbstraction(12, 'LED', 2,
            ['Set', 'Clear', 'Toggle', 'Pattern'],
            '6 onboard LEDs — visual output for children\'s programs',
            { perms: { R: 0, W: 0, X: 0, L: 1, S: 1, E: 1 } });

        this.createAbstraction(13, 'Button', 2,
            ['Read', 'WaitPress', 'OnEvent'],
            'Push button input — user interaction',
            { perms: { R: 0, W: 0, X: 0, L: 1, S: 0, E: 1 } });

        this.createAbstraction(14, 'Timer', 2,
            ['Start', 'Stop', 'Read', 'SetAlarm'],
            'Hardware timer — delays, timeouts, scheduling support',
            { perms: { R: 0, W: 0, X: 0, L: 1, S: 1, E: 1 } });

        this.createAbstraction(15, 'Display', 2,
            ['Write', 'Clear', 'Scroll'],
            'HDMI output (Tang Nano 20K has HDMI) — text/graphics display',
            { perms: { R: 0, W: 0, X: 0, L: 1, S: 1, E: 1 } });

        this.createAbstraction(16, 'SlideRule', 3,
            ['Add', 'Sub', 'Mul', 'Div', 'Sqrt', 'Log', 'Pow', 'Sin', 'Cos', 'Tan', 'Asin', 'Acos', 'Atan', 'ToDegrees', 'ToRadians'],
            'IEEE 754 floating-point arithmetic with trigonometry and angle functions',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 }, chainable: true });

        this.createAbstraction(17, 'Abacus', 3,
            ['Add', 'Sub', 'Mul', 'Div', 'Mod', 'Abs'],
            '64-bit integer arithmetic',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 }, chainable: true });

        this.createAbstraction(18, 'Constants', 3,
            ['Pi', 'E', 'Phi', 'Zero', 'One'],
            'Read-only mathematical constants',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(19, 'Circle', 3,
            ['Area', 'Circumference'],
            'Geometry via SlideRule — delegates trig to SlideRule, computes area and circumference',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        const churchNumerals = [
            [20, 'SUCC', 'Successor function'],
            [21, 'PRED', 'Predecessor function'],
            [22, 'ADD', 'Addition'],
            [23, 'SUB', 'Subtraction'],
            [24, 'MUL', 'Multiplication'],
            [25, 'ISZERO', 'Zero test'],
            [26, 'TRUE', 'Boolean true'],
            [27, 'FALSE', 'Boolean false'],
        ];

        for (const [idx, name, desc] of churchNumerals) {
            const methods = (name === 'TRUE' || name === 'FALSE')
                ? [] : ['Apply'];
            this.createAbstraction(idx, name, 4, methods,
                `Church numeral: ${desc}`,
                { perms: { R: 0, W: 0, X: 1, L: 1, S: 0, E: 1 } });
        }

        this.createAbstraction(28, 'Family', 5,
            ['Register', 'Hello', 'Oversight'],
            'Parent-child capability binding — Hello(target_GT) sends greeting/request to any family member via their GT',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(29, 'Schoolroom', 5,
            ['Join', 'Lesson', 'Submit', 'Grade'],
            'Teacher distributes lessons, students submit work',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(30, 'Friends', 5,
            ['Request', 'Accept', 'Share', 'Revoke'],
            'Peer-to-peer capability sharing, parent-gated',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(31, 'Tunnel', 5,
            ['Connect', 'Send', 'Receive', 'Close'],
            'Outform GT encrypted tunnel (F-bit networking)',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(32, 'Negotiate', 5,
            ['Propose', 'Approve', 'Reject', 'Status'],
            'Parent-teacher joint approval for special grants',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(33, 'Editor', 6,
            ['Open', 'Save', 'Load', 'Undo'],
            'Code editor — manages source text as a DATA object',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(34, 'Assembler', 6,
            ['Assemble', 'Disassemble', 'Validate'],
            'Translates assembly to machine code',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(35, 'Debugger', 6,
            ['Step', 'Run', 'Breakpoint', 'Inspect'],
            'Single-step debugger with register/memory inspection',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(36, 'Deployer', 6,
            ['Build', 'Upload', 'Verify', 'Boot'],
            'Compiles + uploads to Tang via UART',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(37, 'Browser', 7,
            ['Navigate', 'Back', 'Bookmark', 'Search'],
            'Web browser — child LOADs site GTs from c-list',
            { perms: { R: 0, W: 0, X: 0, L: 1, S: 0, E: 1 } });

        this.createAbstraction(38, 'Messenger', 7,
            ['Send', 'Receive', 'Contacts', 'Block'],
            'Messaging — parent-approved contacts',
            { perms: { R: 0, W: 0, X: 0, L: 1, S: 0, E: 1 } });

        this.createAbstraction(39, 'Photos', 7,
            ['View', 'Share', 'Upload', 'Album'],
            'Photo sharing — child LOADs recipient GTs',
            { perms: { R: 0, W: 0, X: 0, L: 1, S: 0, E: 1 } });

        this.createAbstraction(40, 'Social', 7,
            ['Post', 'Read', 'Follow', 'Feed'],
            'Social feed — child LOADs account GTs',
            { perms: { R: 0, W: 0, X: 0, L: 1, S: 0, E: 1 } });

        this.createAbstraction(41, 'Video', 7,
            ['Watch', 'Search', 'Playlist', 'Share'],
            'Video viewing — child LOADs channel GTs',
            { perms: { R: 0, W: 0, X: 0, L: 1, S: 0, E: 1 } });

        this.createAbstraction(42, 'Email', 7,
            ['Compose', 'Read', 'Reply', 'Contacts'],
            'Email — child LOADs contact GTs',
            { perms: { R: 0, W: 0, X: 0, L: 1, S: 0, E: 1 } });

        this.createAbstraction(43, 'PAIR', 4,
            ['Apply'],
            'Church pair constructor',
            { perms: { R: 0, W: 0, X: 1, L: 1, S: 0, E: 1 } });

        this.createAbstraction(44, 'GC', 8,
            ['Scan', 'Identify', 'Clear', 'Flip'],
            'PP250 deterministic GC with bidirectional G-bit',
            { perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 }, handler: 'gc' });
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AbstractionRegistry;
}
