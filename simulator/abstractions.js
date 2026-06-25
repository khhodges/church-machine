class AbstractionRegistry {
    constructor() {
        this.abstractions = {};
        this.layers = {};
        this._registerAll();
        this._loadStats();
    }

    _statsKey() {
        return 'church_abstraction_stats';
    }

    _saveStats() {
        try {
            const data = {};
            for (const idx in this.abstractions) {
                const a = this.abstractions[idx];
                data[idx] = {
                    invokeCount: a.invokeCount,
                    faultCount: a.faultCount,
                    firstActiveTime: a.firstActiveTime,
                    lastFaultTime: a.lastFaultTime
                };
            }
            localStorage.setItem(this._statsKey(), JSON.stringify(data));
        } catch (e) {}
    }

    _loadStats() {
        try {
            const raw = localStorage.getItem(this._statsKey());
            if (!raw) return;
            const data = JSON.parse(raw);
            for (const idx in data) {
                const a = this.abstractions[idx];
                if (!a) continue;
                const saved = data[idx];
                if (saved.invokeCount != null) a.invokeCount = saved.invokeCount;
                if (saved.faultCount != null) a.faultCount = saved.faultCount;
                if (saved.firstActiveTime != null) a.firstActiveTime = saved.firstActiveTime;
                if (saved.lastFaultTime != null) a.lastFaultTime = saved.lastFaultTime;
            }
        } catch (e) {}
    }

    createAbstraction(index, name, layer, methods, description, options) {
        options = options || {};
        const abstraction = {
            index: index,
            name: name,
            layer: layer,
            methods: methods || [],
            description: description || '',
            author: options.author || null,
            version: options.version || null,
            perms: options.perms || { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 },
            chainable: options.chainable || false,
            handler: options.handler || null,
            // freedNSSlot: true means this abstraction exists only for UI/doc purposes;
            // its NS slot was freed (Abstract GTs replaced it) and _getAbstractionCatalog
            // must emit null for it so _initNamespaceTable does not create a physical entry.
            freedNSSlot: options.freedNSSlot || false,
            // parent: index of the abstraction this one inherits from (null = no parent).
            // dispatchMethod() walks the parent chain when a method is not found locally.
            parent: (options.parent !== undefined && options.parent !== null) ? options.parent : null,
            // capabilities: static C-List definition — array of {name, target, grants} objects.
            // Populated from BOOT_UPLOADS after registry init (app-shell.js) or by the
            // CLOOMC++ compiler for user-authored abstractions.
            capabilities: options.capabilities || [],
            dispatch: {},
            invokeCount: 0,
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

    // ── Method inheritance helpers ─────────────────────────────────────────────

    // Walk the parent chain and return the first abstraction that has a bound
    // (non-null) dispatch entry for methodName, or null if none exists.
    _resolveMethod(index, methodName) {
        const upper = methodName.toUpperCase();
        let visited = new Set();
        let current = index;
        while (current !== null && current !== undefined) {
            if (visited.has(current)) break;  // cycle guard
            visited.add(current);
            const a = this.abstractions[current];
            if (!a) break;
            if (Object.prototype.hasOwnProperty.call(a.dispatch, upper) && a.dispatch[upper] !== null) {
                return { abstraction: a, fn: a.dispatch[upper] };
            }
            current = a.parent;
        }
        return null;
    }

    // Return all method names visible on this abstraction: own methods first,
    // then any parent methods not already shadowed.  Each entry is
    //   { name, own: bool, from: abstractionName }
    getAllMethods(index) {
        const seen = new Set();
        const result = [];
        let visited = new Set();
        let current = index;
        while (current !== null && current !== undefined) {
            if (visited.has(current)) break;
            visited.add(current);
            const a = this.abstractions[current];
            if (!a) break;
            const own = (current === index);
            for (const m of a.methods) {
                const upper = m.toUpperCase();
                if (!seen.has(upper)) {
                    seen.add(upper);
                    result.push({ name: m, own, from: a.name });
                }
            }
            current = a.parent;
        }
        return result;
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
        const parentAbs = (a.parent !== null) ? this.abstractions[a.parent] : null;
        return {
            ok: true,
            result: {
                index: a.index, name: a.name, layer: a.layer,
                methods: a.methods, description: a.description,
                perms: a.perms, chainable: a.chainable,
                parent: a.parent,
                parentName: parentAbs ? parentAbs.name : null,
                allMethods: this.getAllMethods(index),
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
        this._saveStats();
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
        // Walk the parent chain to find the first bound handler.
        const resolved = this._resolveMethod(index, methodName);
        if (!resolved) {
            const allNames = this.getAllMethods(index).map(m => m.name).join(', ');
            return { ok: false, fault: 'METHOD', message: `Method ${methodName} not found on ${a.name} (available: ${allNames || 'none'})` };
        }
        a.invokeCount++;
        if (!a.firstActiveTime) a.firstActiveTime = Date.now();
        this._saveStats();
        return resolved.fn(sim, args);
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
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 0 } });

        this.createAbstraction(1, 'Boot.Thread', 0, ['run'],
            'Thread stack for the boot thread (loaded into CR12, privileged)',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 0 } });

        // Slot 2 freed — Startup.Config removed. Hardware ISA owns M-state per CR register;
        // Thread.CR[0] is pre-populated by the boot image; CALL CR0 drops M automatically.

        this.createAbstraction(3, 'LED flash', 0, ['Run'],
            'LED flash — combined code (CR14) + c-list (CR6) in one slot; Run flashes the on-board LED to confirm hardware is alive',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(4, 'Salvation', 1,
            ['Create', 'Release', 'Find', 'Transfer', 'Validate', 'Audit',
             '_reserved_6', '_reserved_7', '_reserved_8', '_reserved_9',
             '_reserved_10', '_reserved_11', '_reserved_12', '_reserved_13', 'main'],
            'Golden Token guardian — issues, revokes, transfers, and audits GTs across the entire system. Every operation requires a PassKey GT that identifies the caller and bills resource usage against it.',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(5, 'Navana', 1,
            ['Create', 'Release', 'Find', 'Update', 'Manage', 'Monitor', 'IDS', 'main'],
            'Namespace slot guardian — allocates, releases, and resolves NS slots; keeps the namespace table consistent. Callers supply a PassKey GT to authenticate and bill slot operations. Runs indefinitely (does not RETURN).',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(6, 'Mint', 1,
            ['Encode', 'Revoke', 'Transfer', 'Create', 'main'],
            'GT issuance — encodes GTs with bounded permissions (domain purity + E-isolation enforced); Create is the legacy alias for Encode',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(7, 'Memory', 1,
            ['Create', 'Release', 'Find', 'Resize', 'Claim', 'main'],
            'Physical RAM zone guardian — allocates and releases memory regions (lumps) within the namespace RAM zone. Every operation requires a PassKey GT to authenticate the caller and bill memory usage against it.',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(8, 'Scheduler', 1,
            ['Yield', 'Spawn', 'Wait', 'Stop', 'pause', 'IRQ'],
            'Thread scheduling — manages time slices, thread lifecycle, and hardware timer interrupts (Task #1077)',
            { author: 'SIPantic', version: '1.1.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(9, 'Stack', 1,
            ['Push', 'Pop', 'Peek', 'Depth'],
            'Managed call stack — hardware-enforced overflow protection',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 }, chainable: true });

        this.createAbstraction(10, 'DijkstraFlag', 1,
            ['Wait', 'Signal', 'Reset', 'Test'],
            'Dijkstra semaphore for inter-thread messaging and synchronization',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(11, 'UART', 2,
            ['Send', 'Receive', 'SetBaud'],
            'Serial communication — Tang Nano 20K BL616 bridge',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 }, freedNSSlot: true });

        this.createAbstraction(12, 'LED', 2,
            ['Set', 'Clear', 'Toggle', 'State'],
            '6 onboard LEDs — visual output for children\'s programs. LED identity is the capability offset (0\u20135) in the C-list; no DR arguments. DR0 return: \u22650 success, <0 failure.',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 }, freedNSSlot: true });

        this.createAbstraction(13, 'Button', 2,
            ['Read', 'WaitPress', 'OnEvent'],
            'Push button input — user interaction',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 }, freedNSSlot: true });

        this.createAbstraction(14, 'Timer', 2,
            ['Start', 'Stop', 'Read', 'SetAlarm'],
            'Hardware timer — delays, timeouts, scheduling support',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 }, freedNSSlot: true });

        this.createAbstraction(15, 'Display', 2,
            ['Write', 'Clear', 'Scroll'],
            'HDMI output (Tang Nano 20K has HDMI) — text/graphics display',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(16, 'SlideRule', 3,
            ['Multiply', 'Divide', 'Sqrt', 'Mod', 'Sin', 'Cos', 'Tan', 'Asin', 'Acos', 'Atan', 'ToDegrees', 'ToRadians', 'Bernoulli', 'Abs', 'Pow', 'Min', 'Max', 'GCD', 'Factorial', 'Log2', 'Atan2', 'Signum'],
            'Arithmetic, trigonometry, angle functions, and Bernoulli numbers — DR3 selects method',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 }, chainable: true });

        this.createAbstraction(17, 'Abacus', 3,
            ['Add', 'Sub', 'Mul', 'Div', 'Mod', 'Abs'],
            '32-bit integer arithmetic',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 }, chainable: true });

        this.createAbstraction(18, 'Constants', 3,
            ['Pi', 'E', 'Phi', 'Zero', 'One', 'Add'],
            'Read-only mathematical constants + user-defined constant pool (14 slots)',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(19, 'Loader', 1,
            ['Load', 'Prefetch', 'Evict'],
            'Lazy load — fault-driven on-demand abstraction loading. Catches NULL_CAP on manifest-registered slots, fetches and installs the lump, retries the faulting CALL transparently.',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

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
            const isBool = (name === 'TRUE' || name === 'FALSE');
            const methods = isBool ? [] : ['Apply'];
            // Boolean values (TRUE/FALSE) are pure lambda values → {L:1}.
            // Numeric combinators (SUCC..ISZERO) are executable functions → {X:1}.
            // Both are single-perm; neither mixes Turing and Church domains.
            const perms = isBool
                ? { R: 0, W: 0, X: 0, L: 1, S: 0, E: 0 }
                : { R: 0, W: 0, X: 1, L: 0, S: 0, E: 0 };
            this.createAbstraction(idx, name, 4, methods,
                `Church numeral: ${desc}`,
                { author: 'SIPantic', version: '1.0.0', perms });
        }

        this.createAbstraction(28, 'Family', 5,
            ['Register', 'Hello', 'Oversight'],
            'Parent-child capability binding — Hello(target_GT) sends greeting/request to any family member via their GT',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(29, 'Schoolroom', 5,
            ['Join', 'Lesson', 'Submit', 'Grade'],
            'Teacher distributes lessons, students submit work',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(30, 'Friends', 5,
            ['Request', 'Accept', 'Share', 'Revoke'],
            'Peer-to-peer capability sharing, parent-gated',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(31, 'Tunnel', 1,
            ['Register', 'Send', 'Receive', 'Fault', 'Fetch', 'Call'],
            'Resident I/O channel — FPGA\u2194IDE host over UART; self-identifying media channel (FourCC type tags: TEXT \u00b7 VOIC \u00b7 LUMP \u00b7 GTKN \u00b7 \u2026); Register replaces the hardwired call-home boot step (B:02\u00BD); Call(GT) forwards through the tunnel to a remote capability',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(32, 'Keystone', 5,
            ['Init', 'Connect', 'Hello'],
            'Application namespace — first boot-resident application_namespace lump (NS[32], token 00002000). Connect(mum_identity_word) verifies Mum\'s Ed25519 identity and issues an Outform E-GT into c-list slot 1. Hello() forwards a CALL through the Tunnel to Mum.Greet(); returns FAULT_NO_CONTACT (0xDEAD0001) if Connect has not been called.',
            { author: 'SIPantic', version: '1.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(33, 'Editor', 6,
            ['Open', 'Save', 'Load', 'Undo'],
            'Code editor — manages source text as a DATA object',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(34, 'Assembler', 6,
            ['Assemble', 'Disassemble', 'Validate'],
            'Translates assembly to machine code',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(35, 'Debugger', 6,
            ['Step', 'Run', 'Breakpoint', 'Inspect'],
            'Single-step debugger with register/memory inspection',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(36, 'Deployer', 6,
            ['Build', 'Upload', 'Verify', 'Boot'],
            'Compiles + uploads to Tang via UART',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(37, 'Browser', 7,
            ['Navigate', 'Back', 'Bookmark', 'Search'],
            'Web browser — child LOADs site GTs from c-list',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(38, 'Messenger', 7,
            ['Send', 'Receive', 'Contacts', 'Block'],
            'Messaging — parent-approved contacts',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(39, 'Photos', 7,
            ['View', 'Share', 'Upload', 'Album'],
            'Photo sharing — child LOADs recipient GTs',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(40, 'Social', 7,
            ['Post', 'Read', 'Follow', 'Feed'],
            'Social feed — child LOADs account GTs',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(41, 'Video', 7,
            ['Watch', 'Search', 'Playlist', 'Share'],
            'Video viewing — child LOADs channel GTs',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(42, 'Email', 7,
            ['Compose', 'Read', 'Reply', 'Contacts'],
            'Email — child LOADs contact GTs',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(43, 'PAIR', 4,
            ['Apply'],
            'Church pair constructor',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 1, L: 0, S: 0, E: 0 } });

        this.createAbstraction(44, 'GC', 8,
            ['Scan', 'Identify', 'Clear', 'Flip'],
            'PP250 deterministic GC with bidirectional G-bit',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 }, handler: 'gc' });

        this.createAbstraction(45, 'Thread', 1,
            ['switchTo', 'Kill', 'Compile'],
            'Thread Abstraction \u2014 switch execution to a named thread, terminate a thread, or compile a new thread with a given start abstraction',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(46, 'Circle', 3,
            ['Area', 'Circumference'],
            'Geometry via SlideRule — declares own Area and Circumference methods; inherits all SlideRule maths (Multiply, Sqrt, Sin, Cos, \u2026) from parent SlideRule',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 }, parent: 16 });

        this.createAbstraction(47, 'Billing', 1,
            ['Open', 'Charge', 'Reissue', 'Close', 'Balance'],
            'Per-account Passkey P-GT quota enforcer — issues system P-GT at boot; all TuringMemory allocations are charged against the active account',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(48, 'TuringMemory', 1,
            ['AllocCode', 'FreeCode'],
            'Domain-separated code allocation — validates P-GT quota via Billing.Charge then allocates via PhysicalPool; issues R+X (no W) GTs for code immutability',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        this.createAbstraction(49, 'ChurchMemory', 1,
            ['AllocAbstract', 'Free'],
            'Abstract handle issuance — tracks per-NS-slot reference counts for abstract (Church-domain) capability handles',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });

        // NS slot 50 — Scheduler IRQ thread (Task #1077)
        // Fixed boot-image slot. Invoked as a hidden ELOADCALL by the simulator
        // when the hardware ALARM fires or a fault escalates to Tier 2.
        // Not directly callable by user programs; reserved for simulator internals.
        this.createAbstraction(50, 'Scheduler.IRQ.Thread', 9,
            [],
            'Hardware interrupt entry point — wakes sleeping threads on ALARM fire and handles Tier 2 fault recovery (Task #1077)',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 0 } });

        // Ethernet — token 00003300 (XC7A100T-only)
        // Identity: token 00003300.  The NS slot below (51) is the loader's initial
        // assignment and is NOT a stable identity — callers must hold a GT, not a slot index.
        // Application LUMP in the minimal three-LUMP ROM image for the QMTECH Wukong board.
        // Provides raw Ethernet frame send/receive (no TCP/IP); the Locator uses it to
        // fetch all remaining abstractions from the IDE/Mum Tunnel on demand over Ethernet,
        // replacing UART as the lazy-load transport.  Chainable: false — callers hold an
        // E-only GT; the device GT is internal to the abstraction's c-list.
        this.createAbstraction(51, 'Ethernet', 2,
            ['Send', 'Receive', 'Connect', 'Status'],
            'Raw Ethernet frame transport — XC7A100T lazy-load channel. Send(dataGT, byteLen), Receive() \u2192 (dataGT, byteLen), Connect(ipv4, port), Status() \u2192 0=down/1=up/2=busy. Application LUMP in the 3-LUMP XC7A100T ROM image; Locator fetches all other abstractions through it.',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 }, profile: 'XC7A100T' });

        // NS slot 52 — EventRouter
        // Canonical multi-method abstraction demonstrating the dispatch-table layout:
        //   public methods  → dispatch entry = lump-word offset of body (non-zero)
        //   private helpers → dispatch entry = 0 (PRIVATE_METHOD fault on external CALL)
        // Private helpers are reachable only via intra-LUMP BRANCH from public methods.
        this.createAbstraction(52, 'EventRouter', 6,
            ['Add', 'Remove', 'Resolve', 'List', 'Methods'],
            'Event-to-handler routing table — maps event Golden Tokens to handler capabilities. Private helpers (FindEvent, BindEvent, UnbindEvent, AllBoundEvents) enforce internal access control; their dispatch entries are 0 and external CALLs fault with PRIVATE_METHOD.',
            { author: 'SIPantic', version: '1.0.0', perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 } });
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AbstractionRegistry;
}

// Cache-busting guard: force navigation to the versioned simulator URL if on the plain
// /simulator/ path.  This file is always revalidated via ETag so even a long-cached tab
// will execute this code and be redirected to the versioned URL.
(function _simulatorCacheBust() {
    if (typeof window === 'undefined' || !window.location) return;
    var _VER = 'r20260429e';
    var _path = window.location.pathname;
    if (_path.indexOf('/simulator/') === 0 && !_path.startsWith('/simulator/~/' + _VER)) {
        window.location.replace('/simulator/~/' + _VER + (window.location.hash || ''));
    }
})();

// Failsafe: inject "Turing DR Test ✦" tab if missing from HTML.
(function _ensureTuringDRTab() {
    if (typeof document === 'undefined') return;
    function _inject() {
        if (document.querySelector('[data-example="led_turing_full"]')) return;
        var anchor = document.querySelector('[data-example="turing_test"]');
        if (!anchor) return;
        var btn = document.createElement('button');
        btn.className = 'example-tab';
        btn.setAttribute('data-example', 'led_turing_full');
        btn.setAttribute('data-tooltip', 'Turing DR Test \u2014 Full visual ISA test across all DR0\u2013DR15 registers');
        btn.style.color = '#4ade80';
        btn.onclick = function() { if (typeof loadExample === 'function') loadExample('led_turing_full'); };
        btn.textContent = 'Turing DR Test \u2736';
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _inject);
    } else {
        _inject();
    }
})();
